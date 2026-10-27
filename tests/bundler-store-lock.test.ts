import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { persistBundleCheckpoint, BUNDLE_RECEIPT_KEY } from '../src/lib/bundler/pending'
import type {WalletLibraryState} from '../src/stores/walletLibraryStore'

const execute = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/bundler/api', () => ({ executeBundleLaunch: execute, validatePrivateKey: vi.fn(), getBalance: vi.fn() }))
let store: typeof import('../src/stores/bundlerStore').useBundlerStore
let storage: Storage
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

beforeEach(async () => {
  vi.resetModules(); execute.mockReset()
  const values = new Map<string, string>()
  storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size } }
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => unknown) => callback({}) } })
  store = (await import('../src/stores/bundlerStore')).useBundlerStore
  store.setState({ tokenName: 'Shared lock', tokenSymbol: 'LOCK', tokenImage: new Blob(['image']) as File, creatorPublicKey: Keypair.generate().publicKey.toBase58(), isExecuting: false, result: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bundle UI entry uses the shared transaction lock', () => {
  it('selects managed public references without copying private keys into the bundle state',async()=>{
    const library=(await import('../src/stores/walletLibraryStore')).useWalletLibraryStore
    const creator=Keypair.generate(),buyer=Keypair.generate()
    library.setState({hydrated:true,storageUnavailable:false,revision:1,groups:[{id:'launch-group',name:'Launch',walletIds:['creator','buyer'],createdAt:'now',updatedAt:'now'}],wallets:[{id:'creator',name:'Creator',publicKey:creator.publicKey.toBase58(),createdAt:'now'},{id:'buyer',name:'Buyer',publicKey:buyer.publicKey.toBase58(),createdAt:'now'}],getKeypair:((id:string)=>id==='creator'?creator:buyer) as WalletLibraryState['getKeypair']})
    store.getState().selectManagedGroup('launch-group','creator')
    expect(store.getState().creatorPrivateKey).toBe('')
    expect(store.getState().creatorPublicKey).toBe(creator.publicKey.toBase58())
    expect(store.getState().bundleWallets[0].libraryWalletId).toBe('buyer')
    expect(store.getState().bundleWallets.every(wallet=>wallet.privateKey==='')).toBe(true)
    expect(JSON.stringify(store.getState())).not.toContain(bs58.encode(creator.secretKey))
    expect(JSON.stringify(store.getState())).not.toContain(bs58.encode(buyer.secretKey))
  })
  it('does not build or send when another tab holds the lock', async () => {
    vi.stubGlobal('navigator', { locks: { request: async (name: string, options: unknown, callback: (lock: null) => unknown) => { expect(name).toBe('vanity-launch-submission'); expect(options).toEqual({ ifAvailable: true }); return callback(null) } } })
    await store.getState().executeLaunch()
    expect(execute.mock.calls.length).toBe(0)
    expect(store.getState().isExecuting).toBe(false)
    expect(store.getState().statusMessage).toMatch(/another tab/i)
  })

  it('holds the lock through scheduled work and cancellation cleanup', async () => {
    let held = false
    const started = deferred(), cleanup = deferred()
    let signal: AbortSignal | undefined
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => { held = true; try { return await callback({}) } finally { held = false } } } })
    execute.mockImplementation(async (_config, _progress, options) => { signal = options.signal; expect(held).toBe(true); started.resolve(); await cleanup.promise; expect(held).toBe(true); return { success: false, status: 'failed', error: 'Cancelled', submittedSignatures: [] } })
    const task = store.getState().executeLaunch()
    await started.promise
    expect(held).toBe(true)
    expect(store.getState().isExecuting).toBe(true)
    store.getState().cancelPendingActions()
    expect(signal?.aborted).toBe(true)
    expect(held).toBe(true)
    cleanup.resolve(); await task
    expect(held).toBe(false)
    expect(store.getState().isExecuting).toBe(false)
  })

  it.each(['launch', 'trade', 'wallet'])('checks a pending %s record under the lock before building', async kind => {
    const payer = Keypair.generate().publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58(), blockhash = Keypair.generate().publicKey.toBase58()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => {
      if (kind === 'launch') storage.setItem('vanity-pending-launch', JSON.stringify({ mode: 'standard', mint, payer, signatures: ['saved'], blockhash, submittedAt: new Date().toISOString() }))
      if (kind === 'trade') storage.setItem('vanity-trade-pending', JSON.stringify({ action: 'buy', mint, payer, signature: 'saved', blockhash, submittedAt: new Date().toISOString(), maxBuyLamports: '1', maxSellRaw: '0' }))
      if (kind === 'wallet') storage.setItem('vanity-wallet-operation-pending-v1', JSON.stringify({ kind: 'sol', payer, priorityLamports: '0', recipients: [{ address: mint, rawAmount: '1' }], signature: bs58.encode(new Uint8Array(64).fill(1)), blockhash, lastValidBlockHeight: 100, submittedAt: new Date().toISOString() }))
      return callback({})
    } } })
    await store.getState().executeLaunch()
    expect(execute.mock.calls.length).toBe(0)
    expect(store.getState().statusMessage).toMatch(/pending|confirmation/i)
  })

  it('blocks a fresh unknown bundle from another tab even when this tab has stale in-memory state', async () => {
    const signature = bs58.encode(new Uint8Array(64).fill(5))
    const receipt = { success: false, status: 'unknown' as const, mintAddress: Keypair.generate().publicKey.toBase58(), createSignature: signature, submittedSignatures: [signature] }
    persistBundleCheckpoint(receipt, storage)
    store.getState().setTokenName('Editing in an older tab')
    expect(store.getState().result).toBeNull()
    await store.getState().executeLaunch()
    expect(execute.mock.calls.length).toBe(0)
    expect(store.getState().statusMessage).toMatch(/bundle.*pending/i)
    expect(store.getState().result?.submittedSignatures).toEqual([signature])
  })

  it('preserves unreadable persisted evidence and refuses to execute', async () => {
    storage.setItem(BUNDLE_RECEIPT_KEY, '{broken')
    await store.getState().executeLaunch()
    expect(execute.mock.calls.length).toBe(0)
    expect(storage.getItem(BUNDLE_RECEIPT_KEY)).toBe('{broken')
    expect(store.getState().statusMessage).toMatch(/cannot be read/i)
  })
})
