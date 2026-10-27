import { expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { checkLaunchExpiry } from '../src/lib/launchExpiry'
const record = { mode: 'standard' as const, mint: Keypair.generate().publicKey.toBase58(), payer: Keypair.generate().publicKey.toBase58(), blockhash: 'hash', signatures: ['sig'], submittedAt: 'now', expiresAfterBlockHeight: 260 }
const rpc = (height: number, account: object | null = null) => ({ getBlockHeight: async () => height, isBlockhashValid: async () => ({ value: false }), getSignatureStatuses: async () => ({ value: [null] }), getAccountInfo: async () => account }) as any
it('does not release a fresh confirmed hash merely because it is absent from the finalized bank', async () => {
  expect((await checkLaunchExpiry(rpc(100), record)).expired).toBe(false)
})
it('releases only after the conservative finalized boundary and no token or successful transaction exists', async () => {
  expect((await checkLaunchExpiry(rpc(261), record)).expired).toBe(true)
  expect((await checkLaunchExpiry(rpc(261, { owner: 'program' }), record)).expired).toBe(false)
})
