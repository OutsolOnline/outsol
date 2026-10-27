import { PublicKey } from '@solana/web3.js'
import { ACCOUNT_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { withTimeout } from './transactions/http'

export type InspectorProgram = 'spl-token' | 'token-2022'
export type AccountRentStatus = 'potential' | 'has-balance' | 'frozen' | 'uninitialized' | 'native' | 'different-close-authority' | 'extension-review'

export interface InspectedTokenAccount {
  address: string
  mint: string
  amount: string
  decimals: number
  balance: string
  state: 'initialized' | 'frozen' | 'uninitialized'
  isNative: boolean
  closeAuthority: string
  lamports: bigint
  rentStatus: AccountRentStatus
}

export interface TokenAccountInventory {
  program: InspectorProgram
  accounts: InspectedTokenAccount[]
  emptyAccountCount: number
  potentialAccountCount: number
  potentialRentLamports: bigint | null
  rejectedCount: number
  omittedCount: number
}

export interface WalletInspection {
  address: string
  balanceLamports: bigint | null
  standard: TokenAccountInventory | null
  token2022: TokenAccountInventory | null
  warnings: string[]
  scannedAt: number
}

/** Deliberately exposes read methods only; no signer or transaction is accepted. */
export interface InspectorConnection {
  getBalance(address: PublicKey, commitment: 'confirmed'): Promise<unknown>
  getParsedTokenAccountsByOwner(address: PublicKey, filter: { programId: PublicKey }, commitment: 'confirmed'): Promise<unknown>
  getMinimumBalanceForRentExemption(size: number, commitment: 'confirmed'): Promise<unknown>
}

const MAX_ACCOUNTS_PER_PROGRAM = 1_000
const MAX_U64 = 18_446_744_073_709_551_615n
const amountPattern = /^(0|[1-9]\d{0,19})$/

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account data')
  return value as Record<string, unknown>
}

function exactLamports(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid lamports')
  return BigInt(value)
}

function rawAmount(value: unknown): string {
  if (typeof value !== 'string' || !amountPattern.test(value) || BigInt(value) > MAX_U64) throw new Error('Invalid token amount')
  return value
}

/** Token decimals are a u8. Formatting never converts a token amount to Number. */
export function formatTokenAmount(amount: string, decimals: number): string {
  const raw = rawAmount(amount)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token decimals')
  if (raw === '0' || decimals === 0) return raw
  const padded = raw.padStart(decimals + 1, '0')
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`
}

/** SOL totals can exceed a single u64 after summing account reserves. */
export function formatInspectorSol(lamports: bigint): string {
  if (lamports < 0n) throw new Error('Invalid lamports')
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${lamports / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`
}

export function validateInspectorAddress(input: string): PublicKey {
  const value = input.trim()
  if (value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) throw new Error('Enter a valid public Solana address (32–44 base58 characters).')
  try {
    const address = new PublicKey(value)
    if (address.toBase58() !== value) throw new Error('Noncanonical address')
    return address
  } catch { throw new Error('Enter a valid public Solana address (32–44 base58 characters).') }
}

function accountAddress(value: unknown): string {
  if (value instanceof PublicKey) return value.toBase58()
  if (typeof value !== 'string') throw new Error('Invalid account address')
  return validateInspectorAddress(value).toBase58()
}

function parseAccount(value: unknown, wallet: string, program: InspectorProgram): InspectedTokenAccount {
  const entry = record(value)
  const address = accountAddress(entry.pubkey)
  const account = record(entry.account)
  const expectedProgram = program === 'spl-token' ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
  if (accountAddress(account.owner) !== expectedProgram.toBase58() || account.executable !== false) throw new Error('Unexpected account program')
  const lamports = exactLamports(account.lamports)
  const data = record(account.data)
  if (!Number.isSafeInteger(data.space) || (data.space as number) < ACCOUNT_SIZE || (data.space as number) > 65_536) throw new Error('Invalid account size')
  if (program === 'spl-token' && data.space !== ACCOUNT_SIZE) throw new Error('Unexpected SPL account size')
  const parsed = record(data.parsed)
  if (parsed.type !== 'account') throw new Error('Unexpected parsed account type')
  const info = record(parsed.info)
  const owner = accountAddress(info.owner)
  if (owner !== wallet) throw new Error('Unexpected account owner')
  const mint = accountAddress(info.mint)
  const tokenAmount = record(info.tokenAmount)
  const amount = rawAmount(tokenAmount.amount)
  const decimals = tokenAmount.decimals
  if (typeof decimals !== 'number') throw new Error('Invalid decimals')
  const balance = formatTokenAmount(amount, decimals)
  const state = info.state
  if (state !== 'initialized' && state !== 'frozen' && state !== 'uninitialized') throw new Error('Unexpected token state')
  if (typeof info.isNative !== 'boolean') throw new Error('Invalid native state')
  // An unset SPL close authority falls back to the token account owner.
  const closeAuthority = info.closeAuthority == null ? owner : accountAddress(info.closeAuthority)
  let rentStatus: AccountRentStatus = 'potential'
  if (program === 'token-2022') rentStatus = 'extension-review'
  else if (amount !== '0') rentStatus = 'has-balance'
  else if (state === 'frozen') rentStatus = 'frozen'
  else if (state !== 'initialized') rentStatus = 'uninitialized'
  else if (info.isNative) rentStatus = 'native'
  else if (closeAuthority !== wallet) rentStatus = 'different-close-authority'
  return { address, mint, amount, decimals, balance, state, isNative: info.isNative, closeAuthority, lamports, rentStatus }
}

export function parseTokenAccountInventory(response: unknown, walletAddress: string, program: InspectorProgram, reserveLamports: bigint | null): TokenAccountInventory {
  const wallet = validateInspectorAddress(walletAddress).toBase58()
  if (reserveLamports !== null && (reserveLamports <= 0n || reserveLamports > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('Invalid rent reserve')
  const values = record(response).value
  if (!Array.isArray(values)) throw new Error('Token account response was not an inventory')
  const accounts: InspectedTokenAccount[] = []
  const seen = new Set<string>()
  let rejectedCount = 0
  for (const value of values.slice(0, MAX_ACCOUNTS_PER_PROGRAM)) {
    try {
      const account = parseAccount(value, wallet, program)
      if (seen.has(account.address)) throw new Error('Duplicate token account')
      seen.add(account.address)
      accounts.push(account)
    } catch { rejectedCount++ }
  }
  const potentialAccounts = accounts.filter(account => account.rentStatus === 'potential')
  return {
    program,
    accounts,
    emptyAccountCount: accounts.filter(account => account.amount === '0').length,
    potentialAccountCount: potentialAccounts.length,
    potentialRentLamports: reserveLamports === null ? null : potentialAccounts.reduce((sum, account) => sum + (account.lamports < reserveLamports ? account.lamports : reserveLamports), 0n),
    rejectedCount,
    omittedCount: Math.max(0, values.length - MAX_ACCOUNTS_PER_PROGRAM),
  }
}

/** All reads are independent. One provider failure does not erase successful reads. */
export async function inspectWallet(connection: InspectorConnection, input: string): Promise<WalletInspection> {
  const owner = validateInspectorAddress(input)
  const address = owner.toBase58()
  const [balanceRead, standardRead, token2022Read, rentRead] = await Promise.allSettled([
    withTimeout(Promise.resolve().then(() => connection.getBalance(owner, 'confirmed'))),
    withTimeout(Promise.resolve().then(() => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'))),
    withTimeout(Promise.resolve().then(() => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'))),
    withTimeout(Promise.resolve().then(() => connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, 'confirmed'))),
  ])
  const warnings: string[] = []
  let balanceLamports: bigint | null = null
  let reserveLamports: bigint | null = null
  try {
    if (balanceRead.status !== 'fulfilled') throw new Error('Unavailable balance')
    balanceLamports = exactLamports(balanceRead.value)
  } catch { warnings.push('SOL balance could not be read precisely. Try another scan.') }
  try {
    if (rentRead.status !== 'fulfilled') throw new Error('Unavailable reserve')
    reserveLamports = exactLamports(rentRead.value)
    if (reserveLamports === 0n) throw new Error('Invalid rent reserve')
  } catch {
    reserveLamports = null
    warnings.push('The current account rent reserve is unavailable; no rent amount is estimated.')
  }
  const readInventory = (read: PromiseSettledResult<unknown>, program: InspectorProgram): TokenAccountInventory | null => {
    const label = program === 'spl-token' ? 'Standard SPL' : 'Token-2022'
    try {
      if (read.status !== 'fulfilled') throw new Error('Unavailable token inventory')
      const inventory = parseTokenAccountInventory(read.value, address, program, reserveLamports)
      if (inventory.rejectedCount) warnings.push(`${label}: ${inventory.rejectedCount} invalid or duplicate account response(s) were excluded.`)
      if (inventory.omittedCount) warnings.push(`${label}: ${inventory.omittedCount} account(s) exceeded the 1,000-account scan limit. Counts and rent reflect only validated accounts shown.`)
      return inventory
    } catch {
      warnings.push(`${label} inventory could not be read. These accounts are missing from this scan.`)
      return null
    }
  }
  const standard = readInventory(standardRead, 'spl-token')
  const token2022 = readInventory(token2022Read, 'token-2022')
  if (balanceLamports === null && standard === null && token2022 === null) throw new Error('The wallet could not be scanned. Check the connection and try again.')
  return { address, balanceLamports, standard, token2022, warnings, scannedAt: Date.now() }
}
