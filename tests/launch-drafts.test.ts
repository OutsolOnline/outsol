import { beforeEach, describe, expect, it } from 'vitest'
import { createLaunchDraft, loadLaunchDrafts, saveLaunchDraft, restoreLaunchDraft, removeLaunchDraft } from '../src/lib/launchDrafts'
import { DEFAULT_LAUNCH_CONFIG } from '../src/lib/launchConfig'

const id = '5f31f89e-dae8-4ac7-9996-37ced68b9a36'
let values: Map<string, string>
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
beforeEach(() => { values = new Map() })
const input = () => ({ name: 'My launch', metadata: { name: 'Vanity', symbol: 'VAN', description: 'Public story' }, metadataUri: '', config: { ...DEFAULT_LAUNCH_CONFIG } })

describe('public launch drafts', () => {
  it('keeps only a valid public artwork reference when saving and restoring a draft', () => {
    const artworkId = 'a'.repeat(64)
    const draft = createLaunchDraft({ ...input(), artworkId, imageFile: 'private-blob', imagePreview: 'data:image/png;base64,AAA' } as any, id, 1000)
    expect(draft).toHaveProperty('artworkId', artworkId)
    saveLaunchDraft(draft, storage)
    expect(loadLaunchDrafts(storage)[0].artworkId).toBe(artworkId)
    expect(restoreLaunchDraft(draft).artworkId).toBe(artworkId)
    expect(Array.from(values.values()).join('')).not.toMatch(/imageFile|imagePreview|data:image|private-blob/)
    expect(createLaunchDraft(input(), id, 1000)).not.toHaveProperty('artworkId')
  })
  it.each(['data:image/png;base64,AAA', '../file.png', 'a'.repeat(63), 'A'.repeat(64), 123])('rejects invalid artwork references (%s)', artworkId => {
    expect(() => createLaunchDraft({ ...input(), artworkId } as any, id, 1000)).toThrow(/artwork/i)
  })
  it('saves Unicode descriptions accepted by the token form without reducing the character limit', () => {
    const description = 'ş'.repeat(600)
    const draft = createLaunchDraft({ ...input(), metadata: { ...input().metadata, description } }, id, 1000)
    saveLaunchDraft(draft, storage)
    expect(loadLaunchDrafts(storage)[0].metadata.description).toBe(description)
  })
  it.each([Infinity, NaN, -1, Number.MAX_SAFE_INTEGER])('rejects nonserializable or out-of-range timestamps in every mode (%s)', unlockAt => {
    expect(() => createLaunchDraft({ ...input(), config: { ...DEFAULT_LAUNCH_CONFIG, unlockAt } }, id, 1000)).toThrow()
  })
  it('persists only public allowlisted fields, never store keys or transaction state', () => {
    const draft = createLaunchDraft({ ...input(), mintSecretKey: [1,2,3], privateKey: 'secret', prepared: { secretKey: 'secret' }, metadata: { ...input().metadata, secretKey: 'secret' } } as any, id, 1000)
    saveLaunchDraft(draft, storage)
    const text = Array.from(values.values()).join('')
    expect(text).not.toMatch(/secret|mintSecretKey|privateKey|prepared/)
    expect(loadLaunchDrafts(storage)).toEqual([draft])
  })
  it('never overwrites corrupt existing drafts or accepts unsafe imported metadata links', () => {
    values.set('vanity-public-launch-drafts-v1', 'corrupt')
    expect(() => saveLaunchDraft(createLaunchDraft(input(), id, 1000), storage)).toThrow(/draft/i)
    expect(values.get('vanity-public-launch-drafts-v1')).toBe('corrupt')
    expect(() => createLaunchDraft({ ...input(), metadataUri: 'javascript:alert(1)' }, id, 1000)).toThrow()
    expect(() => createLaunchDraft({ ...input(), metadata: { ...input().metadata, website: 'https://user:pass@evil.example' } }, id, 1000)).toThrow()
  })
  it('restores a fresh editable design, resets expired lock dates and never restores keys or signatures', () => {
    const draft = createLaunchDraft({ ...input(), config: { ...DEFAULT_LAUNCH_CONFIG, mode: 'lock', unlockAt: 100000 } }, id, 1000)
    const restored = restoreLaunchDraft(draft, 200000)
    expect(restored.config.unlockAt).toBe(200000 + 30 * 86400)
    expect(restored.currentStep).toBe('metadata')
    expect(restored).not.toHaveProperty('mintSecretKey')
    expect(restored).not.toHaveProperty('transactionSignature')
    expect(restored).not.toHaveProperty('receipt')
  })
  it('updates a named draft without duplicating it, and deletes only the chosen draft', () => {
    const first = createLaunchDraft(input(), id, 1000)
    const second = createLaunchDraft(input(), 'd72d67ea-4b6f-4a96-a5bf-9f5be9070b65', 1001)
    saveLaunchDraft(first, storage); saveLaunchDraft(second, storage)
    saveLaunchDraft({ ...first, name: 'Revised' }, storage)
    expect(loadLaunchDrafts(storage)).toHaveLength(2)
    expect(loadLaunchDrafts(storage)[0].name).toBe('Revised')
    removeLaunchDraft(first.id, storage)
    expect(loadLaunchDrafts(storage).map(item => item.id)).toEqual([second.id])
  })
  it('bounds unused launch settings too and refuses oversized aggregate writes before replacing storage', () => {
    expect(() => createLaunchDraft({ ...input(), config: { ...DEFAULT_LAUNCH_CONFIG, totalSupply: 'x'.repeat(12000) } }, id, 1000)).toThrow()
    let refused = false
    for (let index = 0; index < 30; index++) {
      const draft = createLaunchDraft({ ...input(), metadata: { ...input().metadata, name: '\u0000'.repeat(32), symbol: '\u0000'.repeat(10), description: '\u0000'.repeat(1000) } }, crypto.randomUUID(), 1000)
      const before = values.get('vanity-public-launch-drafts-v1')
      try { saveLaunchDraft(draft, storage) } catch {
        refused = true
        expect(values.get('vanity-public-launch-drafts-v1')).toBe(before)
        expect(() => loadLaunchDrafts(storage)).not.toThrow()
        break
      }
    }
    expect(refused).toBe(true)
  })
})
