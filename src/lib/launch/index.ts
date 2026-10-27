import type { AccountInfo, Connection } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { AddressLookupTableAccount, AddressLookupTableProgram, Keypair, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { CpmmConfigInfoLayout, CpmmPoolInfoLayout, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2'
import { WITHDRAWOR_PUBLIC_KEY, PARTNER_ORACLE_PROGRAM_ID, ICluster } from '@streamflow/stream'
import { PROGRAM_ID as METAPLEX_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata'
import { buildDirectLaunchInstructions, getDirectMintSpace, getDirectPrograms } from './instructions'
import type { DirectLaunchInput, DirectLaunchPlan, LockFees } from './instructions'
import { calculateDirectAllocations } from './allocations'

export type { DirectLaunchInput, DirectLaunchPlan, DirectLaunchSummary, LaunchNetwork } from './instructions'
export { LaunchLookupTableRequiredError } from './instructions'
export { calculateDirectAllocations } from './allocations'

const GENESIS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
}
const BPF_LOADERS = ['BPFLoaderUpgradeab1e11111111111111111111111', 'BPFLoader2111111111111111111111111111111111']

export function assertUsableLookupTable(table: AddressLookupTableAccount | null, currentSlot: number): asserts table is AddressLookupTableAccount {
  if (!table) throw new Error('Launch lookup table is unavailable')
  if (!table.isActive()) throw new Error('Launch lookup table is not active')
  if (table.state.lastExtendedSlot >= currentSlot) throw new Error('Wait for the next slot after extending the launch lookup table')
  if (!table.state.addresses.length) throw new Error('Launch lookup table contains no addresses')
}

/** Reject absent or replacement program accounts; canonical IDs come only from pinned SDKs. */
export function assertTrustedProgram(account: AccountInfo<Buffer> | null, label: string): asserts account is AccountInfo<Buffer> {
  if (!account || !account.executable || !BPF_LOADERS.includes(account.owner.toBase58())) throw new Error(`${label} program is unavailable or has an unexpected owner`)
}

/** Oracle is a Borsh vector of 60-byte records followed by account padding. No fallback fees. */
export function readStreamflowLockFees(data: Buffer): LockFees {
  if (data.length < 4) throw new Error('Streamflow fee oracle is malformed')
  const count = data.readUInt32LE(0)
  if (count === 0 || count > Math.floor((data.length - 4) / 60)) throw new Error('Streamflow fee oracle is incomplete')
  const matches: LockFees[] = []
  for (let index = 0; index < count; index++) {
    const offset = 4 + index * 60
    if (!new PublicKey(data.subarray(offset, offset + 32)).equals(WITHDRAWOR_PUBLIC_KEY)) continue
    const creationFeeSol = data.readUInt32LE(offset + 32)
    const streamflowLockFee = Number(data.readFloatLE(offset + 44).toFixed(4))
    if (!Number.isFinite(streamflowLockFee) || streamflowLockFee < 0 || streamflowLockFee > 100) throw new Error('Streamflow lock fee is invalid')
    matches.push({ creationFeeSol, streamflowLockFee, partnerFee: 0 })
  }
  if (matches.length !== 1) throw new Error('Streamflow lock fees cannot be established from the live oracle')
  return matches[0]
}

/**
 * Read-only preparation. The returned transactions must be reviewed, fully signed, and
 * simulated together before an atomic submission. Never send these sequentially.
 */
export async function buildDirectLaunchPlan(input: DirectLaunchInput & { connection: Connection }): Promise<DirectLaunchPlan> {
  const { connection } = input
  calculateDirectAllocations(input.totalSupply, input.decimals, input.liquidityTokenPercent, input.liquiditySol)
  const mintKeypair = input.mintKeypair ?? Keypair.generate()
  const programs = getDirectPrograms(input.network)
  const configId = getCpmmPdaAmmConfigId(programs.cpmm, 0).publicKey
  const locking = input.lockUntil != null
  const single = locking || input.singleTransactionRequired === true
  const addresses = [programs.cpmm, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, configId, mintKeypair.publicKey]
  if (locking) addresses.push(programs.streamflow, programs.feeOracle)
  if (single) addresses.push(METAPLEX_PROGRAM_ID)
  const [genesis, accounts, latestBlockhash, slot] = await Promise.all([
    connection.getGenesisHash(),
    connection.getMultipleAccountsInfo(addresses, 'confirmed'),
    connection.getLatestBlockhash('confirmed'),
    connection.getSlot('confirmed'),
  ])
  if (genesis !== GENESIS[input.network]) throw new Error('The RPC network does not match the selected launch network')
  let lookupTables = input.lookupTables
  if (lookupTables?.length) {
    const tableAccounts = await connection.getMultipleAccountsInfo(lookupTables.map(table => table.key), 'confirmed')
    lookupTables = tableAccounts.map((account, index) => {
      if (!account || !account.owner.equals(AddressLookupTableProgram.programId)) throw new Error('Launch lookup table has an unexpected owner')
      const table = new AddressLookupTableAccount({ key: input.lookupTables![index].key, state: AddressLookupTableAccount.deserialize(account.data) })
      assertUsableLookupTable(table, slot)
      return table
    })
  }
  assertTrustedProgram(accounts[0], 'Raydium CPMM')
  assertTrustedProgram(accounts[1], 'SPL Token')
  assertTrustedProgram(accounts[2], 'Token-2022')
  if (single) assertTrustedProgram(accounts[locking ? 7 : 5], 'Metaplex Metadata')
  const config = accounts[3]
  if (!config || !config.owner.equals(programs.cpmm) || config.data.length !== CpmmConfigInfoLayout.span || !config.data.subarray(0, 8).equals(Buffer.from([218, 244, 33, 104, 203, 203, 43, 111]))) throw new Error('Raydium pool configuration is unavailable or invalid')
  const poolConfig = CpmmConfigInfoLayout.decode(config.data)
  if (poolConfig.disableCreatePool || poolConfig.index !== 0) throw new Error('Raydium pool creation is currently disabled for this configuration')
  if (accounts[4] !== null) throw new Error('This mint address already exists; generate a fresh mint')
  let lockFees: LockFees | undefined
  if (locking) {
    assertTrustedProgram(accounts[5], 'Streamflow')
    const oracle = accounts[6]
    const cluster = input.network === 'devnet' ? ICluster.Devnet : ICluster.Mainnet
    if (!oracle || !oracle.owner.equals(new PublicKey(PARTNER_ORACLE_PROGRAM_ID[cluster]))) throw new Error('Streamflow fee oracle has an unexpected owner')
    lockFees = readStreamflowLockFees(oracle.data)
  }
  const now = await connection.getBlockTime(slot)
  if (now === null) throw new Error('Unable to establish chain time for this launch')
  const { rentSpace, metadataRentSpace } = getDirectMintSpace(input, mintKeypair.publicKey)
  // Raydium observation account size from its published on-chain ObservationState::LEN.
  const rentSizes = [rentSpace, 165, 170, 82, CpmmPoolInfoLayout.span, 4075, 1104, metadataRentSpace]
  const rents = await Promise.all(rentSizes.map(size => connection.getMinimumBalanceForRentExemption(size, 'confirmed')))
  // Include WSOL account rent. Bundle mode later closes its isolated account;
  // single mode retains the ordinary wallet ATA and its existing balance.
  // Token-2022 ATA rent (170) is an upper bound for vaults with this metadata-only mint.
  const accountRentEstimate = rents[0] + rents[1] * 3 + rents[2] * 2 + rents[3] + rents[4] + rents[5]
    + (locking ? rents[6] + rents[2] * (input.lockRecipient && !input.lockRecipient.equals(input.payer) ? 4 : 3) : 0)
    + (metadataRentSpace ? rents[7] : 0)
  const plan = await buildDirectLaunchInstructions({
    ...input, lookupTables, mintKeypair, now, mintRentLamports: rents[0], wrappedSolRentLamports: rents[1], ...latestBlockhash,
    lockFees, poolCreationFeeLamports: poolConfig.createPoolFee.toString(), estimatedRentAndNetworkFeeLamports: String(accountRentEstimate),
  })
  const networkFees = await Promise.all(plan.transactions.map(tx => connection.getFeeForMessage(tx.message, 'confirmed')))
  if (networkFees.some(fee => fee.value === null)) throw new Error('Unable to establish the network fee for the prepared launch')
  const feeTotal = networkFees.reduce((sum, fee) => sum + BigInt(fee.value!), BigInt(0))
  const rentAndFees = BigInt(accountRentEstimate) + feeTotal
  plan.summary.estimatedRentAndNetworkFeeLamports = rentAndFees.toString()
  plan.summary.estimatedTotalSolLamports = (BigInt(plan.summary.liquiditySolLamports) + BigInt(plan.summary.lockFeeSol) + BigInt(plan.summary.poolCreationFeeLamports) + rentAndFees + BigInt(plan.summary.jitoTipLamports)).toString()
  const balance = await connection.getBalance(input.payer, 'confirmed')
  if (BigInt(balance) < BigInt(plan.summary.estimatedTotalSolLamports)) throw new Error('Insufficient SOL for liquidity, third-party charges and account rent')
  // instructionGroups are internal construction details and must not escape review state.
  const { instructionGroups: _groups, ...publicPlan } = plan
  return publicPlan
}
