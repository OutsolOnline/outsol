import { afterEach, expect, it, vi } from 'vitest'
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { assertSubmissionSigner, sendAndConfirmTransaction } from '../src/lib/transactions/send'
import { createJitoTipTransaction, submitAtomicBundle } from '../src/lib/bundler/jito'
import { executeBundleLaunch } from '../src/lib/bundler/api'
import { useBundlerStore } from '../src/stores/bundlerStore'
import { consumerLaunchPlan } from './helpers/consumerLaunchPlan'

const builders = vi.hoisted(() => ({ create: vi.fn(), buy: vi.fn(), sell: vi.fn() }))
// These cases exercise cancellation boundaries. Chain-state verification has
// separate mismatch/recovery tests; this transport fixture confirms the route.
vi.mock('../src/lib/creatorFeeRecovery', () => ({ verifyCreatorFeeRoutingOnChain: async () => {} }))
vi.mock('../src/lib/pumpfun/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/pumpfun/api')>(),
  buildCreateTransaction: builders.create,
  buildNativeBuyTransaction: builders.buy,
  buildSellTransaction: builders.sell,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function transaction(payer: PublicKey, mint?: PublicKey) {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [mint
    ? SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, lamports: 0, space: 0, programId: SystemProgram.programId })
    : SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })] }).compileToV0Message())
}
function configuration() {
  const base = useBundlerStore.getState()
  const creator = Keypair.generate()
  return { ...base, tokenName: 'Cancel Test', tokenSymbol: 'CANCEL', tokenImage: new Blob(['image'], { type: 'image/png' }) as File,
    creatorPrivateKey: bs58.encode(creator.secretKey), mintMode: 'random' as const, bundleWallets: [], sniperMode: 'after_confirm' as const,
    autoSellEnabled: false, devBuyAmount: 0, bundleMode: 'sniper' as const }
}
function workingRpc() {
  vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000_000_000_000)
  const send = vi.spyOn(Connection.prototype, 'sendRawTransaction').mockImplementation(async bytes => bs58.encode(VersionedTransaction.deserialize(new Uint8Array(bytes)).signatures[0]))
  vi.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] })
  builders.create.mockImplementation(params => consumerLaunchPlan({ ...params, metadataUri: 'https://example.com/meta.json' }, Keypair.generate().publicKey.toBase58()))
  return send
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); builders.create.mockReset(); builders.buy.mockReset(); builders.sell.mockReset() })

it('does not broadcast an already-cancelled transaction and reports it unsent', async () => {
  const key = Keypair.generate(); const tx = transaction(key.publicKey); tx.sign([key])
  const controller = new AbortController(); controller.abort()
  const send = vi.fn()
  const result = await sendAndConfirmTransaction({ sendRawTransaction: send } as unknown as Connection, tx, { signal: controller.signal, timeoutMs: 20, pollIntervalMs: 1 })
  expect(send).not.toHaveBeenCalled()
  expect(result.status).toBe('failed')
  expect(result.submitted).toBe(false)
})
it('passes the reviewed tip budget to a potentially split launch in sequential mode', async () => {
  workingRpc()
  await executeBundleLaunch({ ...configuration(), jitoTip:0.00007 }, () => {})
  expect(builders.create.mock.calls[0][0].jitoTipLamports).toBe(70000)
})

it('preserves the original signature as unknown when cancelled after broadcasting', async () => {
  const key = Keypair.generate(); const tx = transaction(key.publicKey); tx.sign([key])
  const controller = new AbortController()
  const result = await sendAndConfirmTransaction({ sendRawTransaction: async () => { controller.abort(); return bs58.encode(tx.signatures[0]) } } as unknown as Connection, tx, { signal: controller.signal, timeoutMs: 20, pollIntervalMs: 1 })
  expect(result.status).toBe('unknown')
  expect(result.submitted).toBe(true)
  expect(result.signature).toBe(bs58.encode(tx.signatures[0]))
})

it.each([undefined, 'a-different-wallet'])('does not broadcast when the wallet becomes unavailable during the final RPC wait (%s)', async current => {
  const key = Keypair.generate(); const tx = transaction(key.publicKey); tx.sign([key])
  let liveSigner: string | undefined = key.publicKey.toBase58()
  const finalRpc = deferred<void>()
  const send = vi.fn()
  const execution = (async () => {
    await finalRpc.promise
    return sendAndConfirmTransaction({ sendRawTransaction: send } as unknown as Connection, tx, {
      onBroadcast: () => assertSubmissionSigner(key.publicKey.toBase58(), () => liveSigner),
    })
  })()
  liveSigner = current; finalRpc.resolve()
  const result = await execution
  expect(result.submitted).toBe(false)
  expect(result.error).toMatch(/wallet.*locked|wallet.*disconnected/i)
  expect(send).not.toHaveBeenCalled()
})

it('does not send a Jito bundle when cancellation occurs during its prerequisite simulation', async () => {
  const signer = Keypair.generate()
  const tx = createJitoTipTransaction(signer.publicKey, Keypair.generate().publicKey.toBase58(), 30_000); tx.sign([signer])
  const simulation = deferred<Response>(); const started = deferred<void>(); let sends = 0
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    if (JSON.parse(String(init.body)).method === 'simulateBundle') { started.resolve(); return simulation.promise }
    sends++; return Response.json({ result: 'should-not-submit' })
  })
  const controller = new AbortController()
  const execution = submitAtomicBundle({ rpcEndpoint: 'https://rpc.invalid' } as Connection, [tx], { signal: controller.signal, timeoutMs: 50, pollIntervalMs: 1 })
  await started.promise; controller.abort()
  simulation.resolve(Response.json({ result: { value: { summary: 'succeeded', transactionResults: [{ err: null }] } } }))
  const result = await execution
  expect(sends).toBe(0)
  expect(result.status).toBe('failed')
  expect(result.submitted).toBe(false)
})

it('does not sign or submit a create transaction built after cancellation', async () => {
  const send = workingRpc(); const started = deferred<void>(); const release = deferred<void>()
  builders.create.mockImplementation(async params => { started.resolve(); await release.promise; return consumerLaunchPlan({ ...params, metadataUri: 'https://example.com/meta.json' }, Keypair.generate().publicKey.toBase58()) })
  const controller = new AbortController()
  const execution = executeBundleLaunch(configuration(), () => {}, { signal: controller.signal })
  await started.promise; controller.abort(); release.resolve()
  const result = await execution
  expect(send).not.toHaveBeenCalled()
  expect(result.status).toBe('failed')
  expect(result.submittedSignatures).toEqual([])
})

it('retains the sent create receipt while cancelling a buy that is still being built', async () => {
  const send = workingRpc(); const started = deferred<void>(); const release = deferred<void>()
  const key = Keypair.generate()
  builders.buy.mockImplementation(async () => { started.resolve(); await release.promise; return transaction(key.publicKey) })
  const config = configuration()
  const wallet = { ...useBundlerStore.getState().bundleWallets[0], privateKey: bs58.encode(key.secretKey), buyAmount: 0.01, mode: 'sniper' as const, sellEnabled: false }
  const controller = new AbortController()
  const execution = executeBundleLaunch({ ...config, bundleWallets: [wallet] }, () => {}, { signal: controller.signal })
  await started.promise; controller.abort(); release.resolve()
  const result = await execution
  expect(send).toHaveBeenCalledTimes(1)
  expect(result.status).toBe('partial')
  expect(result.submittedSignatures).toEqual([result.createSignature])
})

it('does not submit a scheduled sell built after cancellation', async () => {
  const send = workingRpc(); const started = deferred<void>(); const release = deferred<void>()
  const config = { ...configuration(), devBuyAmount: 0.01, autoSellEnabled: true, autoSellTriggerType: 'time' as const, autoSellDelay: 1 }
  const creator = Keypair.fromSecretKey(bs58.decode(config.creatorPrivateKey))
  builders.sell.mockImplementation(async () => { started.resolve(); await release.promise; return { success: true, transaction: transaction(creator.publicKey) } })
  const controller = new AbortController()
  const execution = executeBundleLaunch(config, () => {}, { signal: controller.signal })
  await started.promise; controller.abort(); release.resolve()
  const result = await execution
  expect(send).toHaveBeenCalledTimes(1)
  expect(result.status).toBe('partial')
  expect(result.submittedSignatures).toEqual([result.createSignature])
})
