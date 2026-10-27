import { beforeEach, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

let values: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  values = new Map()
  vi.stubGlobal('window', { location: { origin: 'https://vanity.example' } })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

it('persists ciphertext, locks secret memory, and unlocks only with the passphrase', async () => {
  const { usePlatformWalletStore: store } = await import('../src/stores/walletStore')
  await store.getState().generateWallet('a long test passphrase')
  const secret = store.getState().secretKeyBase58!
  const address = store.getState().getPublicKey()
  expect(values.get('platform-wallet-vault')).not.toContain(secret)
  store.getState().lockWallet()
  expect(store.getState().getKeypair()).toBeNull()
  expect(await store.getState().unlockWallet('incorrect passphrase')).toBe(false)
  expect(await store.getState().unlockWallet('a long test passphrase')).toBe(true)
  expect(store.getState().getPublicKey()).toBe(address)
})

it('retains an old plaintext wallet until encryption succeeds, then deletes the old entry', async () => {
  const secret = bs58.encode(Keypair.generate().secretKey)
  const legacy = JSON.stringify({ state: { secretKeyBase58: secret }, version: 0 })
  values.set('platform-wallet', legacy)
  const { usePlatformWalletStore: store } = await import('../src/stores/walletStore')
  store.getState().hydrateWallet()
  expect(store.getState().needsMigration).toBe(true)
  expect(store.getState().getKeypair()).toBeNull()
  expect(values.get('platform-wallet')).toBe(legacy)
  expect(await store.getState().encryptWallet('short')).toBe(false)
  expect(values.get('platform-wallet')).toBe(legacy)
  expect(await store.getState().encryptWallet('a long test passphrase')).toBe(true)
  expect(values.has('platform-wallet')).toBe(false)
  expect(store.getState().getKeypair()).not.toBeNull()
})

it('keeps legacy funds recoverable when browser storage fails', async () => {
  const secret = bs58.encode(Keypair.generate().secretKey)
  const legacy = JSON.stringify({ state: { secretKeyBase58: secret }, version: 0 })
  values.set('platform-wallet', legacy)
  const { usePlatformWalletStore: store } = await import('../src/stores/walletStore')
  store.getState().hydrateWallet()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: () => { throw new Error('quota') }, removeItem: (key: string) => values.delete(key) })
  expect(await store.getState().encryptWallet('a long test passphrase')).toBe(false)
  expect(values.get('platform-wallet')).toBe(legacy)
  expect(store.getState().getExportSecret()).toBe(secret)
})

it('allows correcting an invalid import without overwriting a previously stored wallet', async () => {
  const { usePlatformWalletStore: store } = await import('../src/stores/walletStore')
  expect(await store.getState().importFromSecretKey('invalid', 'a long test passphrase')).toBe(false)
  const secret = bs58.encode(Keypair.generate().secretKey)
  expect(await store.getState().importFromSecretKey(secret, 'a long test passphrase')).toBe(true)
  const ciphertext = values.get('platform-wallet-vault')
  expect(await store.getState().importFromSecretKey(bs58.encode(Keypair.generate().secretKey), 'a long test passphrase')).toBe(false)
  expect(values.get('platform-wallet-vault')).toBe(ciphertext)
})

it('does not restore a secret when the wallet is locked during an in-flight unlock', async () => {
  const { usePlatformWalletStore: store } = await import('../src/stores/walletStore')
  await store.getState().generateWallet('a long test passphrase')
  store.getState().lockWallet()
  const unlocking = store.getState().unlockWallet('a long test passphrase')
  store.getState().lockWallet()
  expect(await unlocking).toBe(false)
  expect(store.getState().getKeypair()).toBeNull()
})

it('loads a saved encrypted wallet locked after a page reload', async () => {
  const { usePlatformWalletStore: first } = await import('../src/stores/walletStore')
  await first.getState().generateWallet('a long test passphrase')
  const address = first.getState().walletAddress
  vi.resetModules()
  const { usePlatformWalletStore: reloaded } = await import('../src/stores/walletStore')
  reloaded.getState().hydrateWallet()
  expect(reloaded.getState().walletAddress).toBe(address)
  expect(reloaded.getState().getKeypair()).toBeNull()
  expect(reloaded.getState().secretKeyBase58).toBeNull()
})
