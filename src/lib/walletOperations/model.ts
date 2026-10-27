import { PublicKey } from '@solana/web3.js'

export const MAX_RECIPIENTS = 8
export const MAX_U64 = 18446744073709551615n
export interface WalletRecipientInput { address: string; amount: string }
export type WalletOperationInput = { payer: string; priorityFeeSol: string } & (
  { kind: 'sol'; recipients: WalletRecipientInput[] } |
  { kind: 'token'; mint: string; sourceAccount?: string; recipients: WalletRecipientInput[] } |
  { kind: 'close'; accounts: string[] }
)
export interface WalletOperationRecipient { address: string; rawAmount: string; tokenAccount?: string }
export interface WalletOperationIntent {
  kind: 'sol' | 'token' | 'close'; payer: string; priorityLamports: string
  recipients?: WalletOperationRecipient[]; mint?: string; sourceAccount?: string; tokenProgram?: string; decimals?: number
  closeAccounts?: { address: string; mint: string; tokenProgram: string }[]
}
export function publicAddress(value: unknown, wallet = false): string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new Error('Enter a valid Solana address.')
  const key = new PublicKey(value)
  if (key.toBase58() !== value || (wallet && !PublicKey.isOnCurve(key.toBytes()))) throw new Error('Use a Solana wallet address as the recipient.')
  return value
}
export function parseExactUnits(value: string, decimals: number, allowZero = false): bigint {
  if (typeof value !== 'string' || value.length > 280 || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('Enter an exact decimal amount, without spaces or exponent notation.')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) throw new Error(`This amount supports at most ${decimals} decimal places.`)
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (raw > MAX_U64 || (!allowZero && raw === 0n)) throw new Error('The amount must be positive and fit the token limit.')
  return raw
}
export function formatUnits(raw: string | bigint, decimals: number): string {
  const value = BigInt(raw), negative = value < 0n, digits = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : ''
  return `${negative ? '-' : ''}${decimals ? digits.slice(0, -decimals) : digits}${fraction ? `.${fraction}` : ''}`
}
export function normalizeOperationInput(input: WalletOperationInput): WalletOperationInput {
  if (!input || !['sol', 'token', 'close'].includes(input.kind)) throw new Error('Choose a wallet operation.')
  const payer = publicAddress(input.payer, true)
  const priority = parseExactUnits(input.priorityFeeSol, 9, true)
  if (priority > 10000000n) throw new Error('Priority fee must be between 0 and 0.01 SOL.')
  const base = { payer, priorityFeeSol: input.priorityFeeSol }
  if (input.kind === 'close') {
    if (!Array.isArray(input.accounts) || !input.accounts.length || input.accounts.length > 8) throw new Error('Select between one and eight empty token accounts.')
    const accounts = input.accounts.map(value => publicAddress(value))
    if (new Set(accounts).size !== accounts.length || accounts.includes(payer)) throw new Error('Each selected token account must be distinct.')
    return { ...base, kind: 'close', accounts }
  }
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > MAX_RECIPIENTS) throw new Error('Add between one and eight recipients.')
  const recipients = input.recipients.map(value => {
    if (!value || typeof value.amount !== 'string') throw new Error('Enter an amount for every recipient.')
    const address = publicAddress(value.address, true)
    if (address === payer) throw new Error('Choose a recipient different from your sending wallet.')
    if (input.kind === 'sol') parseExactUnits(value.amount, 9)
    else if (value.amount.length > 280 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.amount) || !/[1-9]/.test(value.amount)) throw new Error('Enter a positive exact token amount.')
    return { address, amount: value.amount }
  })
  if (new Set(recipients.map(value => value.address)).size !== recipients.length) throw new Error('Each recipient must have a distinct wallet address.')
  if (input.kind === 'sol') return { ...base, kind: 'sol', recipients }
  return { ...base, kind: 'token', recipients, mint: publicAddress(input.mint), ...(input.sourceAccount ? { sourceAccount: publicAddress(input.sourceAccount) } : {}) }
}
