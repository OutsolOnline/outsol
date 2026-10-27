import { describe, expect, it, vi } from 'vitest'
import { publicPending, saveConfirmed, savePending, readPending } from '../src/lib/launchHistory'
describe('launch recovery privacy', () => {
  it('persists only public recovery fields even if a caller passes signer data', () => {
    const record = publicPending({ mode: 'lock', mint: 'mint', payer: 'payer', signatures: ['sig'], blockhash: 'blockhash', submittedAt: 'now', signers: ['secret'], secretKey: [1,2,3] } as any)
    expect(record).toEqual({ mode: 'lock', mint: 'mint', payer: 'payer', signatures: ['sig'], blockhash: 'blockhash', submittedAt: 'now', poolAddress: undefined, lockAddress: undefined, unlockAt: undefined })
    expect(JSON.stringify(record)).not.toContain('secret')
  })
  it('does not erase a newer submission when an older recovery completes', () => {
    const values = new Map<string,string>()
    vi.stubGlobal('localStorage', { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value), removeItem: (key:string) => values.delete(key) })
    const old = { mode: 'standard' as const, mint: 'old', payer: 'payer', signatures: ['old-sig'], blockhash: 'old-block', submittedAt: 'now' }
    const newer = { ...old, mint: 'new', signatures: ['new-sig'], blockhash: 'new-block' }
    savePending(newer)
    saveConfirmed(old)
    expect(readPending()?.mint).toBe('new')
    vi.unstubAllGlobals()
  })
})
