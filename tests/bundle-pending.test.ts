import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { BUNDLE_PENDING_KEY, BUNDLE_RECEIPT_KEY, assertNoPendingBundleReceipt, guardedBundleReceiptStorage, persistBundleCheckpoint, readPendingBundleReceipt } from '../src/lib/bundler/pending'
import type { BundleResult } from '../src/lib/bundler/types'

function memory() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } }
function unknown(): BundleResult { const signature = bs58.encode(new Uint8Array(64).fill(7)); return { success: false, status: 'unknown', mintAddress: Keypair.generate().publicKey.toBase58(), createSignature: signature, submittedSignatures: [signature], buySignatures: [], bundleSellSignatures: [] } }

describe('cross-tab public bundle recovery gate', () => {
  it('persists only public signatures and blocks spending until the same bundle is resolved', () => {
    const storage = memory(), value = unknown()
    persistBundleCheckpoint({ ...value, creatorPrivateKey: 'never-store', signedPackets: 'never-store' } as BundleResult, storage)
    expect(readPendingBundleReceipt(storage)).toEqual(value)
    expect([...storage.values.values()].join('')).not.toMatch(/creatorPrivateKey|signedPackets|never-store/)
    expect(() => assertNoPendingBundleReceipt(storage)).toThrow(/pending confirmation/)
    expect(() => persistBundleCheckpoint({ ...unknown(), status: 'confirmed', success: true }, storage)).toThrow(/changed/)
    persistBundleCheckpoint({ ...value, status: 'confirmed', success: true }, storage)
    expect(storage.getItem(BUNDLE_PENDING_KEY)).toBeNull()
    expect(() => assertNoPendingBundleReceipt(storage)).not.toThrow()
  })

  it('prevents another tab typing or resetting its Zustand state from erasing an unknown receipt', () => {
    const storage = memory(), value = unknown(), guarded = guardedBundleReceiptStorage(storage)
    persistBundleCheckpoint(value, storage)
    const saved = storage.getItem(BUNDLE_RECEIPT_KEY)
    guarded.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify({ state: { result: null }, version: 0 }))
    guarded.removeItem(BUNDLE_RECEIPT_KEY)
    expect(storage.getItem(BUNDLE_RECEIPT_KEY)).toBe(saved)
    expect(readPendingBundleReceipt(storage)?.submittedSignatures).toEqual(value.submittedSignatures)
  })

  it('recognizes a legacy unknown receipt and preserves malformed legacy or durable evidence', () => {
    const storage = memory(), value = unknown(), guarded = guardedBundleReceiptStorage(storage)
    storage.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify({ state: { result: value }, version: 0 }))
    expect(() => assertNoPendingBundleReceipt(storage)).toThrow(/pending/)
    for (const key of [BUNDLE_RECEIPT_KEY, BUNDLE_PENDING_KEY]) {
      const current = memory(); current.setItem(key, '{broken')
      const guard = guardedBundleReceiptStorage(current)
      expect(() => assertNoPendingBundleReceipt(current)).toThrow(/cannot be read/)
      guard.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify({ state: { result: null }, version: 0 }))
      expect(current.getItem(key)).toBe('{broken')
    }
    guarded.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify({ state: { result: null }, version: 0 }))
    expect(readPendingBundleReceipt(storage)?.status).toBe('unknown')
  })

  it('refuses to drop unknown signatures and fails closed when recovery cannot be saved', () => {
    const storage = memory(), value = unknown()
    persistBundleCheckpoint(value, storage)
    const second = bs58.encode(new Uint8Array(64).fill(8))
    persistBundleCheckpoint({ ...value, submittedSignatures: [...value.submittedSignatures!, second] }, storage)
    expect(() => persistBundleCheckpoint(value, storage)).toThrow(/cannot be discarded/)
    const unavailable = { ...memory(), setItem: () => { throw new Error('Storage unavailable') } }
    expect(() => persistBundleCheckpoint(value, unavailable)).toThrow(/Storage unavailable/)
  })
})
