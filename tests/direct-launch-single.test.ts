import { expect, it } from 'vitest'
import { AddressLookupTableAccount, ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { buildDirectLaunchInstructions, LaunchLookupTableRequiredError } from '../src/lib/launch/instructions'

it('measures lock mode packing with all eligible accounts compressed', async () => {
  const input = {
    payer: Keypair.generate().publicKey, mintKeypair: Keypair.generate(), name: 'N'.repeat(32), symbol: 'S'.repeat(10), metadataUri: ('https://vanity-production-2bbb.up.railway.app/api/assets/' + 'a'.repeat(64) + '.json').padEnd(126, 'a'),
    totalSupply: '0.001', decimals: 6, liquidityTokenPercent: 80, liquiditySol: '1', network: 'mainnet-beta' as const, now: 1800000000, lockUntil: 1800604800,
    mintRentLamports: 5000000, wrappedSolRentLamports: 2039280, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 42,
    lockFees: { creationFeeSol: 160000000, streamflowLockFee: 0.5, partnerFee: 0 },
    singleTransactionRequired: true,
    priorityFeeSol: 0.00003,
  }
  let requirement: LaunchLookupTableRequiredError | undefined
  try { await buildDirectLaunchInstructions(input) } catch (error) { if (error instanceof LaunchLookupTableRequiredError) requirement = error; else throw error }
  expect(requirement).toBeDefined()
  const lookup = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, addresses: requirement!.addresses } })
  const plan = await buildDirectLaunchInstructions({ ...input, ...requirement!.resumeInput, lookupTables: [lookup] })
  expect(plan.transactions).toHaveLength(1)
  expect(plan.transactions[0].serialize().length).toBeLessThanOrEqual(1232)
  expect(plan.requiresAtomicBundle).toBe(false)
  expect(plan.summary.jitoTipLamports).toBe('0')
  expect(plan.summary.lockRoundingFeeTokenAmount).toBe('1')
  const lock = plan.instructionGroups.flat().find(ix => ix.programId.toBase58() === 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m')!
  const roundingTransfer = plan.instructionGroups.flat().find(ix => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 12)!
  expect(roundingTransfer.keys[2].pubkey.equals(lock.keys[4].pubkey)).toBe(true)
  expect(requirement!.addresses.length).toBeLessThanOrEqual(20)
  expect(Object.getOwnPropertyDescriptor(requirement, 'resumeInput')?.enumerable).toBe(false)
  console.log(JSON.stringify({ singleBytes: plan.transactions[0].serialize().length, signatures: plan.transactions[0].signatures.length, lookupAddresses: requirement!.addresses.length }))
})

it('cannot downgrade a lock to a bundle and accepts a public IPFS metadata URI', async () => {
  let requirement: LaunchLookupTableRequiredError | undefined
  try {
    await buildDirectLaunchInstructions({
      payer: Keypair.generate().publicKey, mintKeypair: Keypair.generate(), name: 'Locked', symbol: 'LOCK', metadataUri: 'ipfs://bafybeigdyrzt',
      totalSupply: '1000000', decimals: 6, liquidityTokenPercent: 80, liquiditySol: '1', network: 'mainnet-beta', now: 1800000000, lockUntil: 1800604800,
      mintRentLamports: 2000000, wrappedSolRentLamports: 2039280, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 42,
      lockFees: { creationFeeSol: 160000000, streamflowLockFee: 0.5, partnerFee: 0 }, singleTransactionRequired: false,
    })
  } catch (error) { if (error instanceof LaunchLookupTableRequiredError) requirement = error; else throw error }
  expect(requirement).toBeDefined()
})

it('packs Instant LP plus immutable metadata into one transaction with full hosted metadata', async () => {
  const input = {
    payer: Keypair.generate().publicKey, mintKeypair: Keypair.generate(), name: 'N'.repeat(32), symbol: 'S'.repeat(10),
    metadataUri: ('https://vanity-production-2bbb.up.railway.app/api/assets/' + 'a'.repeat(64) + '.json').padEnd(126, 'a'),
    totalSupply: '1000000', decimals: 6, liquidityTokenPercent: 80, liquiditySol: '1', network: 'mainnet-beta' as const,
    now: 1800000000, lockUntil: null, singleTransactionRequired: true, priorityFeeSol: 0.00003,
    mintRentLamports: 1461600, wrappedSolRentLamports: 2039280,
    blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 42,
  }
  let requirement: LaunchLookupTableRequiredError | undefined
  try { await buildDirectLaunchInstructions(input) } catch (error) { if (error instanceof LaunchLookupTableRequiredError) requirement = error; else throw error }
  expect(requirement).toBeDefined()
  const lookup = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, addresses: requirement!.addresses } })
  const plan = await buildDirectLaunchInstructions({ ...input, ...requirement!.resumeInput, lookupTables: [lookup] })
  expect(plan.transactions).toHaveLength(1)
  expect(plan.transactions[0].serialize().length).toBeLessThanOrEqual(1232)
  expect(plan.requiresAtomicBundle).toBe(false)
  expect(plan.lockAddress).toBeNull()
  expect(plan.summary.developerLocked).toBe(false)
  expect(plan.summary.jitoTipLamports).toBe('0')
  expect(plan.summary.lockFeeSol).toBe('0')
  expect(plan.summary.lockFeeTokenAmount).toBe('0')
  expect(plan.summary.platformFeeBps).toBe(0)
  expect(plan.summary.liquidityTokenAmount).toBe('800000000000')
  expect(plan.summary.developerTokenAmount).toBe('200000000000')
  expect(plan.instructionGroups.flat().some(ix => ix.programId.toBase58() === 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m')).toBe(false)
  expect(requirement!.addresses.length).toBeLessThanOrEqual(20)
  const message = TransactionMessage.decompile(plan.transactions[0].message, { addressLookupTableAccounts: [lookup] })
  expect(message.instructions[0].programId.equals(ComputeBudgetProgram.programId)).toBe(true)
  expect(plan.transactions[0].signatures[0].every(byte => byte === 0)).toBe(true)
  console.log(JSON.stringify({ instantLpSingleBytes: plan.transactions[0].serialize().length, signatures: plan.transactions[0].signatures.length, lookupAddresses: requirement!.addresses.length }))
})
