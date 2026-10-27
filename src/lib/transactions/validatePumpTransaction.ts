import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { withTimeout } from './http'
import {creatorVaultPda} from '@pump-fun/pump-sdk'
export interface PumpTransactionPolicy {
  action: 'create' | 'buy' | 'sell'
  payer: PublicKey | string
  mint: PublicKey | string
  maxSolLamports: bigint
  maxPriorityFeeLamports?: bigint
  expectedMetadata?: { name: string; symbol: string; uri: string }
  expectedCreator?: PublicKey|string
  expectedBuyCreator?: PublicKey|string
  expectedCreateFlags?: {mayhem:false;cashback:false;creatorFeeBps:0n;holderReward:boolean}
}
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
const METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const discriminator = {
  create: Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]),
  createV2: Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]),
  buy: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  buyExact: Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]),
  sell: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
}
const pda = (seed: string, ...keys: PublicKey[]) => PublicKey.findProgramAddressSync([Buffer.from(seed), ...keys.map(key => key.toBuffer())], PUMP)[0]

/** Fail closed on transaction formats outside the supported official SOL curve instructions.
 * maxSolLamports bounds the trade's encoded max SOL input. Official program rent,
 * network fees and bounded priority fees are separate costs shown in the quote.
 */
export function validatePumpTransaction(tx: VersionedTransaction, policy: PumpTransactionPolicy, lookupTables: AddressLookupTableAccount[] = []): void {
  const payer = new PublicKey(policy.payer)
  const mint = new PublicKey(policy.mint)
  if (policy.maxSolLamports < 0n) throw new Error('Invalid spend budget')
  if (!tx.message.staticAccountKeys[0].equals(payer)) throw new Error('Unexpected transaction fee payer')
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures)
  const expected = policy.action === 'create' ? [payer, mint] : [payer]
  if (signers.length !== expected.length || signers.some(signer => !expected.some(key => signer.equals(key)))) throw new Error('Unexpected required transaction signer')
  if (tx.message.addressTableLookups.length > 0 && lookupTables.length === 0) throw new Error('Address lookup tables must be resolved before signing')
  const { instructions } = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookupTables })
  let creates = 0
  let buys = 0
  let sells = 0
  let spend = 0n
  let computeLimit = 1_400_000n
  let computePrice = 0n
  const computeKinds = new Set<number>()
  for (const ix of instructions) {
    const data = ix.data
    const account = (index: number) => {
      if (!ix.keys[index]) throw new Error('Missing required instruction account')
      return ix.keys[index].pubkey
    }
    const requireAccount = (index: number, key: PublicKey, label: string) => {
      if (!account(index).equals(key)) throw new Error(`Unexpected ${label} account`)
    }
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const kind = data[0]
      if (computeKinds.has(kind)) throw new Error('Duplicate compute budget setting')
      computeKinds.add(kind)
      if (kind === 2 && data.length === 5) {
        computeLimit = BigInt(data.readUInt32LE(1))
        if (computeLimit < 1n || computeLimit > 1_400_000n) throw new Error('Invalid compute limit')
      } else if (kind === 3 && data.length === 9) computePrice = data.readBigUInt64LE(1)
      else if (kind === 1 && data.length === 5 && data.readUInt32LE(1) <= 262_144) { /* bounded heap request */ }
      else throw new Error('Unsupported compute budget instruction')
      continue
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (!(data.length === 0 || (data.length === 1 && [0, 1].includes(data[0])))) throw new Error('Unsupported associated token instruction')
      requireAccount(0, payer, 'ATA fee payer')
      requireAccount(2, payer, 'ATA owner')
      requireAccount(3, mint, 'ATA mint')
      requireAccount(4, SystemProgram.programId, 'ATA system program')
      const tokenProgram = account(5)
      if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('Unsupported token program')
      requireAccount(1, getAssociatedTokenAddressSync(mint, payer, false, tokenProgram), 'user token account')
      continue
    }
    if (ix.programId.equals(SystemProgram.programId)) throw new Error('Unexpected System transfer or account instruction')
    if (!ix.programId.equals(PUMP)) throw new Error(`Unsupported transaction program: ${ix.programId.toBase58()}`)
    const kind = data.subarray(0, 8)
    const isCreate = kind.equals(discriminator.create)
    const isCreateV2 = kind.equals(discriminator.createV2)
    if (isCreate || isCreateV2) {
      if (policy.action !== 'create' || ++creates !== 1) throw new Error('Unexpected Pump create instruction')
      requireAccount(0, mint, 'mint')
      requireAccount(1, pda('mint-authority'), 'mint authority')
      requireAccount(2, pda('bonding-curve', mint), 'bonding curve')
      requireAccount(4, pda('global'), 'global')
      requireAccount(isCreateV2 ? 5 : 7, payer, 'creator payer')
      requireAccount(isCreateV2 ? 6 : 8, SystemProgram.programId, 'system program')
      requireAccount(isCreateV2 ? 8 : 10, ASSOCIATED_TOKEN_PROGRAM_ID, 'associated token program')
      requireAccount(isCreateV2 ? 14 : 12, pda('__event_authority'), 'event authority')
      requireAccount(isCreateV2 ? 15 : 13, PUMP, 'Pump program')
      const tokenProgram = account(isCreateV2 ? 7 : 9)
      if (!tokenProgram.equals(isCreateV2 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)) throw new Error('Unexpected mint token program')
      requireAccount(3, getAssociatedTokenAddressSync(mint, pda('bonding-curve', mint), true, tokenProgram), 'curve token account')
      if (isCreate) {
        requireAccount(5, METADATA, 'metadata program')
        requireAccount(6, PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA.toBuffer(), mint.toBuffer()], METADATA)[0], 'metadata')
      }
      let offset = 8
      const values = [32, 10, 200].map(max => {
        if (offset + 4 > data.length) throw new Error('Malformed token metadata')
        const length = data.readUInt32LE(offset); offset += 4
        if (length < 1 || length > max || offset + length > data.length) throw new Error('Invalid token metadata length')
        const value = data.subarray(offset, offset + length).toString('utf8'); offset += length
        return value
      })
      if (offset + 32 > data.length || !new PublicKey(data.subarray(offset, offset + 32)).equals(new PublicKey(policy.expectedCreator??payer))) throw new Error('Unexpected metadata creator')
      offset += 32
      if (isCreateV2) {
        const flags=policy.expectedCreateFlags??{mayhem:false,cashback:false,creatorFeeBps:0n,holderReward:false}
        if(data.length!==offset+11)throw new Error('Unsupported create_v2 trailing flags')
        if(data[offset]!==0||flags.mayhem!==false)throw new Error('Mayhem launches are not supported')
        if(data[offset+1]!==0||flags.cashback!==false)throw new Error('Pump no longer permits new cashback coins (CashbackDeprecated, 6082)')
        if(data.readBigUInt64LE(offset+2)!==0n||flags.creatorFeeBps!==0n)throw new Error('Unexpected configurable creator fee')
        if(data[offset+10]!==Number(flags.holderReward))throw new Error('Unexpected holder rewards flag')
      } else if(data.length!==offset)throw new Error('Unexpected legacy create extension')
      if (policy.expectedMetadata && values.some((value, i) => value !== [policy.expectedMetadata!.name, policy.expectedMetadata!.symbol, policy.expectedMetadata!.uri][i])) throw new Error('Token metadata differs from the launch plan')
      continue
    }
    const isBuy = kind.equals(discriminator.buy)
    const isBuyExact = kind.equals(discriminator.buyExact)
    const isSell = kind.equals(discriminator.sell)
    if (!(isBuy || isBuyExact || isSell) || data.length < 24) throw new Error('Unsupported Pump instruction format')
    if (isSell ? policy.action !== 'sell' : policy.action === 'sell') throw new Error('Pump trade action differs from the launch plan')
    if (isSell) sells++; else buys++
    requireAccount(0, pda('global'), 'global')
    requireAccount(2, mint, 'mint')
    requireAccount(3, pda('bonding-curve', mint), 'bonding curve')
    requireAccount(6, payer, 'trade payer')
    requireAccount(7, SystemProgram.programId, 'system program')
    requireAccount(10, pda('__event_authority'), 'event authority')
    requireAccount(11, PUMP, 'Pump program')
    const tokenProgram = account(isSell ? 9 : 8)
    if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('Unsupported token program')
    requireAccount(4, getAssociatedTokenAddressSync(mint, pda('bonding-curve', mint), true, tokenProgram), 'curve token account')
    requireAccount(5, getAssociatedTokenAddressSync(mint, payer, false, tokenProgram), 'user token account')
    if(policy.expectedBuyCreator)requireAccount(isSell?8:9,creatorVaultPda(new PublicKey(policy.expectedBuyCreator)),'creator vault')
    if (!isSell) spend += data.readBigUInt64LE(isBuyExact ? 8 : 16)
  }
  if (spend > policy.maxSolLamports) throw new Error('Transaction spend exceeds the approved SOL ceiling')
  if ((computeLimit * computePrice + 999_999n) / 1_000_000n > (policy.maxPriorityFeeLamports ?? 10_000_000n)) throw new Error('Transaction priority fee exceeds the approved ceiling')
  if (policy.action === 'create' && (creates !== 1 || buys > 1 || sells !== 0)) throw new Error('Transaction does not contain the expected token creation')
  if (policy.action === 'buy' && (buys !== 1 || creates !== 0 || sells !== 0)) throw new Error('Transaction does not contain exactly one expected buy')
  if (policy.action === 'sell' && (sells !== 1 || creates !== 0 || buys !== 0)) throw new Error('Transaction does not contain exactly one expected sell')
}

export async function validatePumpTransactionWithLookupTables(connection: Connection, tx: VersionedTransaction, policy: PumpTransactionPolicy): Promise<void> {
  const tables = await Promise.all(tx.message.addressTableLookups.map(async lookup => {
    const result = await withTimeout(connection.getAddressLookupTable(lookup.accountKey))
    if (!result.value) throw new Error('Required address lookup table is missing')
    return result.value
  }))
  validatePumpTransaction(tx, policy, tables)
}
