import { describe, expect, it } from 'vitest'
import { Keypair, PublicKey, TransactionMessage, SystemProgram, ComputeBudgetProgram, ComputeBudgetInstruction } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT, decodeInitializeMintInstruction, decodeMintToInstruction, decodeSetAuthorityInstruction } from '@solana/spl-token'
import { buildStreamflowLockInstruction, allocateLockReserve } from '../src/lib/launch/instructions'
import { buildWithSyntheticLookupTables as buildDirectLaunchInstructions } from './direct-launch-helpers'
import { CreateMetadataAccountV3Struct, PROGRAM_ID as METAPLEX_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata'

const payer = Keypair.generate().publicKey
const mintKeypair = Keypair.generate()
const blockhash = Keypair.generate().publicKey.toBase58()
const base = {
  payer, mintKeypair, name: 'Fair Coin', symbol: 'FAIR', metadataUri: 'https://example.com/token.json',
  totalSupply: '1000000', decimals: 6, liquidityTokenPercent: 80, liquiditySol: '1',
  network: 'mainnet-beta' as const, now: 1800000000, lockUntil: 1800604800,
  mintRentLamports: 5000000, wrappedSolRentLamports: 2039280,
  blockhash, lastValidBlockHeight: 42,
  lockFees: { creationFeeSol: 160000000, streamflowLockFee: 0.5, partnerFee: 0 },
}

describe('direct mint, pool and lock transaction instructions', () => {
  it('mints fixed supply, disables freeze/mint/metadata authority, and pairs the exact requested pool amounts', async () => {
    const plan = await buildDirectLaunchInstructions(base)
    const ixs = plan.instructionGroups.flat()
    const init = ixs.find(ix => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 0)!
    expect(decodeInitializeMintInstruction(init, TOKEN_PROGRAM_ID).data.freezeAuthority).toBeNull()
    const mint = ixs.find(ix => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 7)!
    expect(decodeMintToInstruction(mint, TOKEN_PROGRAM_ID).data.amount.toString()).toBe('1000000000000')
    const revoke = ixs.find(ix => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 6)!
    expect(decodeSetAuthorityInstruction(revoke, TOKEN_PROGRAM_ID).data.newAuthority).toBeNull()
    const metadataInit = ixs.find(ix => ix.programId.equals(METAPLEX_PROGRAM_ID))!
    expect(metadataInit.keys[4].pubkey.equals(PublicKey.default)).toBe(true)
    expect(CreateMetadataAccountV3Struct.deserialize(metadataInit.data)[0].createMetadataAccountArgsV3.isMutable).toBe(false)
    const pool = ixs.find(ix => ix.data.subarray(0, 8).equals(Buffer.from([175, 175, 109, 31, 13, 152, 155, 237])))!
    const mintAIsToken = pool.keys[4].pubkey.equals(mintKeypair.publicKey)
    expect(pool.data.readBigUInt64LE(mintAIsToken ? 8 : 16).toString()).toBe('800000000000')
    expect(pool.data.readBigUInt64LE(mintAIsToken ? 16 : 8).toString()).toBe('1000000000')
    expect(pool.data.readBigUInt64LE(24).toString()).toBe('0')
    expect(pool.keys[mintAIsToken ? 15 : 16].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true)
    expect(pool.keys[mintAIsToken ? 16 : 15].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true)
    expect(plan.summary.liquidityTokenAmount).toBe('800000000000')
    expect(plan.summary.developerTokenAmount).toBe('199004975125')
    expect(plan.summary.lockFeeTokenAmount).toBe('995024875')
    expect(plan.summary.platformFeeBps).toBe(0)
    expect(plan.transactions.length).toBeLessThanOrEqual(5)
    for (const tx of plan.transactions) expect(tx.serialize().length).toBeLessThanOrEqual(1232)
    expect(plan.requiresAtomicBundle).toBe(false)
    for (const tx of plan.transactions) {
      const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures)
      expect(signers[0].equals(payer)).toBe(true)
    }
  })

  it('encodes an all-at-cliff lock with no cancellation, transfer, top-up, pause or rate-update power', async () => {
    const result = await buildStreamflowLockInstruction({ payer, mint: mintKeypair.publicKey, amountRaw: BigInt('123456'), unlockDate: 1800604800, network: 'mainnet-beta', metadataKeypair: Keypair.generate() })
    const data = result.instruction.data
    expect(data.readBigUInt64LE(8).toString()).toBe('1800604800')
    expect(data.readBigUInt64LE(16).toString()).toBe('123456')
    expect(data.readBigUInt64LE(40).toString()).toBe('1800604800')
    expect(data.readBigUInt64LE(48).toString()).toBe('123456')
    expect([...data.subarray(56, 62)]).toEqual([0, 0, 0, 0, 0, 0])
    expect([...data.subarray(134, 138)]).toEqual([1, 0, 1, 0])
    expect(result.instruction.keys[15].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true)
    expect(result.instruction.keys[3].isSigner).toBe(true)
  })

  it('keeps the developer allocation liquid when no lock was requested', async () => {
    const plan = await buildDirectLaunchInstructions({ ...base, lockUntil: undefined, lockFees: undefined })
    expect(plan.lockAddress).toBeNull()
    expect(plan.summary.developerTokenAmount).toBe('200000000000')
    expect(plan.summary.lockFeeTokenAmount).toBe('0')
    expect(plan.summary.lockFeeSol).toBe('0')
  })

  it('uses the SDK classic lock route with a locally signed metadata account for launch plans', async () => {
    const plan = await buildDirectLaunchInstructions(base)
    const ixs = plan.instructionGroups.flat()
    const lock = ixs.find(ix => ix.programId.toBase58() === 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m')!
    expect(lock.keys[3].isSigner).toBe(true)
    expect(plan.signers.some(signer => signer.publicKey.equals(lock.keys[3].pubkey))).toBe(true)
  })

  it('rejects expired locks and metadata too large to produce bounded transactions', async () => {
    await expect(buildDirectLaunchInstructions({ ...base, lockUntil: base.now })).rejects.toThrow(/future/)
    await expect(buildDirectLaunchInstructions({ ...base, metadataUri: 'https://example.com/' + 'x'.repeat(3000) })).rejects.toThrow(/metadata/i)
  })

  it('rejects a pool too small to leave the creator any LP tokens after the protocol minimum', async () => {
    let message = ''
    try { await buildDirectLaunchInstructions({ ...base, totalSupply: '2', decimals: 0, liquidityTokenPercent: 50, liquiditySol: '0.000000001', lockUntil: undefined }) }
    catch (error) { message = (error as Error).message }
    expect(message).toMatch(/liquidity/i)
  })

  it('uses SDK-compatible fee arithmetic and accounts for every reserve atomic unit', () => {
    expect(allocateLockReserve(BigInt(1000), 0.5)).toEqual({ netRaw: BigInt(996), protocolFeeRaw: BigInt(4), roundingFeeRaw: BigInt(0) })
    expect(allocateLockReserve(BigInt(200), 0.5)).toEqual({ netRaw: BigInt(199), protocolFeeRaw: BigInt(0), roundingFeeRaw: BigInt(1) })
  })

  it('embeds exactly one disclosed Jito tip before packing and applies the total priority budget', async () => {
    const plan = await buildDirectLaunchInstructions({ ...base, lockUntil: undefined, jitoTipLamports: 15000, priorityFeeSol: 0.00003 })
    const instructions = plan.transactions.flatMap(tx => TransactionMessage.decompile(tx.message).instructions)
    const tip = instructions.filter(ix => ix.programId.equals(SystemProgram.programId) && ix.keys[1]?.pubkey.toBase58() === '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5')
    expect(tip).toHaveLength(1)
    expect(tip[0].data.readBigUInt64LE(4).toString()).toBe('15000')
    expect(plan.summary.jitoTipLamports).toBe('15000')
    expect(BigInt(plan.summary.priorityFeeLamports)).toBeGreaterThan(BigInt(0))
    expect(BigInt(plan.summary.priorityFeeLamports)).toBeLessThanOrEqual(BigInt(30000))
    const prices = instructions.filter(ix => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3)
    expect(prices).toHaveLength(plan.transactions.length)
    expect(plan.transactions.length).toBeLessThanOrEqual(5)
    for (const tx of plan.transactions) expect(tx.serialize().length).toBeLessThanOrEqual(1232)
  })

  it('rejects unsafe Jito or priority-fee values before building', async () => {
    const errorFor = async (input: Parameters<typeof buildDirectLaunchInstructions>[0]) => {
      try { await buildDirectLaunchInstructions(input); return '' } catch (error) { return (error as Error).message }
    }
    expect(await errorFor({ ...base, lockUntil: undefined, jitoTipLamports: 999 })).toMatch(/Jito/)
    expect(await errorFor({ ...base, priorityFeeSol: Number.NaN })).toMatch(/priority/i)
  })
})
