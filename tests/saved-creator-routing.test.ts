import { describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { resolveCreatorFeeRouting, type SupportedCreatorFeeSelection } from '../src/lib/creatorFeeRouting'
import { RECEIPTS_KEY } from '../src/lib/launchHistory'
import { readSavedCreatorFeeRouting } from '../src/lib/savedCreatorRouting'

const payer = Keypair.fromSeed(new Uint8Array(32).fill(91)).publicKey.toBase58()
const mint = Keypair.fromSeed(new Uint8Array(32).fill(92)).publicKey.toBase58()
const otherMint = Keypair.fromSeed(new Uint8Array(32).fill(93)).publicKey.toBase58()
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(94)).publicKey.toBase58()
const github = { userId: '12345', username: 'Alice', profileUrl: 'https://github.com/Alice', accountType: 'User' as const }
function routing(selection: SupportedCreatorFeeSelection = { kind: 'deployer' }) {
  return resolveCreatorFeeRouting({ selection, payer, mint, ...(selection.kind === 'github' ? { github } : {}) })
}
function receipt(creatorFeeRouting: unknown = routing()) { return { mode: 'standard', venue: 'pump', mint, signatures: ['public-signature'], confirmedAt: '2026-10-27T10:00:00.000Z', creatorFeeRouting } }
function saved(value: unknown) {
  const raw = JSON.stringify(value)
  const storage = { getItem: vi.fn((key: string) => key === RECEIPTS_KEY ? raw : null), setItem: vi.fn(), removeItem: vi.fn() }
  return { raw, storage }
}

describe('saved public creator fee launch intention', () => {
  it('returns no invented recipient for absent storage or legacy receipts', () => {
    expect(readSavedCreatorFeeRouting(mint, { getItem: () => null })).toBeUndefined()
    const { creatorFeeRouting: _legacyAbsent, ...legacy } = receipt()
    expect(readSavedCreatorFeeRouting(mint, saved([legacy]).storage)).toBeUndefined()
    expect(readSavedCreatorFeeRouting(mint, saved([]).storage)).toBeUndefined()
  })
  it.each<SupportedCreatorFeeSelection>([{ kind: 'deployer' }, { kind: 'wallet', address: recipient }, { kind: 'holder-rewards' }, { kind: 'github', username: 'alice' }])('returns only the checked matching public routing for $kind', selection => {
    const expected = routing(selection)
    const source = saved([{ ...receipt(expected), secretKey: 'private', packets: ['opaque'], githubToken: 'private-token', apiResponse: { extra: 'unused' } }])
    expect(readSavedCreatorFeeRouting(mint, source.storage)).toEqual(expected)
    expect(source.storage.getItem).toHaveBeenCalledExactlyOnceWith(RECEIPTS_KEY)
    expect(source.storage.setItem).not.toHaveBeenCalled()
    expect(source.storage.removeItem).not.toHaveBeenCalled()
    expect(JSON.stringify(readSavedCreatorFeeRouting(mint, source.storage))).not.toMatch(/private|opaque|unused|secretKey|packets|apiResponse/)
  })
  it('ignores malformed records for another mint without hiding a matching valid route', () => {
    const expected = routing({ kind: 'holder-rewards' })
    expect(readSavedCreatorFeeRouting(mint, saved([null, 'unrelated', { mint: otherMint, creatorFeeRouting: { kind: 'unknown' } }, receipt(expected)]).storage)).toEqual(expected)
  })
  it('rejects a route bound to another mint even when the receipt matches the requested mint', () => {
    const route = resolveCreatorFeeRouting({ selection: { kind: 'holder-rewards' }, payer, mint: otherMint })
    const source = saved([receipt(route)])
    expect(() => readSavedCreatorFeeRouting(mint, source.storage)).toThrow(/mint|routing/i)
    expect(source.storage.setItem).not.toHaveBeenCalled()
  })
  it.each([null, {}, { kind: 'cashback' }, { ...routing(), effectiveCreator: recipient }, { ...routing(), secret: 'private' }])('rejects malformed present matching routing without changing storage: %j', value => {
    const source = saved([receipt(value)])
    expect(() => readSavedCreatorFeeRouting(mint, source.storage)).toThrow()
    expect(source.storage.setItem).not.toHaveBeenCalled()
    expect(source.storage.removeItem).not.toHaveBeenCalled()
    expect(source.storage.getItem(RECEIPTS_KEY)).toBe(source.raw)
  })
  it.each([{ mode: 'lock' }, { venue: 'bonk' }, { venue: null }])('requires matching routed receipts to be standard Pump launches: %j', invalid => {
    const source = saved([{ ...receipt(), ...invalid }])
    expect(() => readSavedCreatorFeeRouting(mint, source.storage)).toThrow(/Pump|routing/i)
    expect(source.storage.setItem).not.toHaveBeenCalled()
  })
  it('validates every matching record rather than hiding a malformed duplicate behind a valid record', () => {
    expect(() => readSavedCreatorFeeRouting(mint, saved([receipt(), receipt(null)]).storage)).toThrow()
  })
  it.each(['not-json', '{}', 'null', '[]'.padEnd(262145, ' ')])('fails closed on malformed or oversized receipt storage without writes', raw => {
    const storage = { getItem: () => raw, setItem: vi.fn() }
    expect(() => readSavedCreatorFeeRouting(mint, storage)).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('bounds receipt count to 100 before finding a matching record', () => {
    expect(readSavedCreatorFeeRouting(mint, saved(Array.from({ length: 100 }, () => ({ mint: otherMint }))).storage)).toBeUndefined()
    expect(() => readSavedCreatorFeeRouting(mint, saved(Array.from({ length: 101 }, () => ({ mint: otherMint }))).storage)).toThrow()
  })
  it('rejects invalid requested mint identifiers before reading any browser data', () => {
    const storage = { getItem: vi.fn(() => null) }
    expect(() => readSavedCreatorFeeRouting('not-a-public-key', storage)).toThrow()
    expect(storage.getItem).not.toHaveBeenCalled()
  })
})
