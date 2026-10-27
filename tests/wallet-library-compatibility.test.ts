import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'

const passphrase = 'a private compatibility test passphrase'
let values: Map<string, string>

beforeEach(() => {
  vi.resetModules()
  values = new Map()
  vi.stubGlobal('window', {
    location: { origin: 'https://outsol.example' },
    addEventListener: vi.fn(),
  })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  vi.stubGlobal('navigator', {
    locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) },
  })
})

afterEach(() => vi.unstubAllGlobals())

async function wallets() {
  const { usePlatformWalletStore: legacy } = await import('../src/stores/walletStore')
  const { useWalletLibraryStore: library } = await import('../src/stores/walletLibraryStore')
  await legacy.getState().generateWallet(passphrase)
  const legacyAddress = legacy.getState().getPublicKey()!
  const legacySecret = legacy.getState().secretKeyBase58!
  const legacyBackup = values.get('platform-wallet-vault')!
  await library.getState().ready()
  const [managed] = await library.getState().createWallets({ count: 1, prefix: 'Launch signer', passphrase })
  library.getState().selectWallet(managed.id)
  return { legacy, library, managed, legacyAddress, legacySecret, legacyBackup }
}

describe('managed wallet compatibility with existing launch and trade callers', () => {
  it('signs with the selected managed wallet and never falls back to an unlocked previous wallet', async () => {
    const { legacy, library, managed, legacyAddress, legacySecret } = await wallets()
    expect(legacy.getState().getPublicKey()).toBe(managed.publicKey)
    expect(legacy.getState().getSelectedAddress()).toBe(managed.publicKey)
    expect(legacy.getState().secretKeyBase58).toBe(legacySecret)

    const payer = new PublicKey(managed.publicKey)
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: payer,
      recentBlockhash: legacyAddress,
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(legacyAddress), lamports: 1 })],
    }).compileToV0Message())
    await legacy.getState().signTransaction(transaction)
    expect(transaction.signatures[0].some(byte => byte !== 0)).toBe(true)

    library.getState().lockWallets([managed.id])
    expect(legacy.getState().getSelectedAddress()).toBe(managed.publicKey)
    expect(legacy.getState().getPublicKey()).toBeNull()
    expect(legacy.getState().getKeypair()).toBeNull()
    await expect(legacy.getState().signTransaction(transaction)).rejects.toThrow(/unlock/i)
    library.getState().selectWallet(null)
    expect(legacy.getState().getPublicKey()).toBe(legacyAddress)
  })

  it('notifies existing subscribers and invalidates the managed signing key after external storage changes', async () => {
    const { legacy, managed, legacySecret, legacyBackup } = await wallets()
    const before = legacy.getState().libraryRevision
    const { useWalletLibraryStore: library } = await import('../src/stores/walletLibraryStore')
    const notified = vi.fn()
    const unsubscribe = legacy.subscribe(notified)
    await library.getState().renameWallet(managed.id, 'Reviewed signer')
    expect(legacy.getState().libraryRevision).toBeGreaterThan(before)
    expect(notified).toHaveBeenCalled()
    unsubscribe()

    const record = JSON.parse(values.get('outsol-wallet-library-v1')!)
    record.revision++
    values.set('outsol-wallet-library-v1', JSON.stringify(record))
    expect(legacy.getState().getSelectedAddress()).toBe(managed.publicKey)
    expect(legacy.getState().getKeypair()).toBeNull()
    expect(legacy.getState().getPublicKey()).toBeNull()
    expect(legacy.getState().secretKeyBase58).toBe(legacySecret)
    expect(values.get('platform-wallet-vault')).toBe(legacyBackup)
    expect(values.get('outsol-wallet-library-v1')).not.toContain(legacySecret)
  })

  it('locks every managed signer and the previous signer without deleting either encrypted backup', async () => {
    const { legacy, library, managed, legacyBackup } = await wallets()
    const libraryBackup = values.get('outsol-wallet-library-v1')
    expect(library.getState().getKeypair(managed.id)).not.toBeNull()
    legacy.getState().lockWallet()
    expect(library.getState().unlockedIds).toEqual([])
    expect(library.getState().getKeypair(managed.id)).toBeNull()
    expect(legacy.getState().secretKeyBase58).toBeNull()
    expect(legacy.getState().getSelectedAddress()).toBe(managed.publicKey)
    library.getState().selectWallet(null)
    expect(legacy.getState().getKeypair()).toBeNull()
    expect(values.get('platform-wallet-vault')).toBe(legacyBackup)
    expect(values.get('outsol-wallet-library-v1')).toBe(libraryBackup)
  })
})
