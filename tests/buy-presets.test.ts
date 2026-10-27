import { describe, expect, it } from 'vitest'
import { loadBuyPresets, parseBuyPresets, saveBuyPresets } from '../src/lib/buyPresets'
describe('reviewed SOL amount presets', () => {
  it('roundtrips exact lamport amounts without losing tiny values to exponent notation', () => {
    let raw: string | null = null
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
    const values = parseBuyPresets('0, 0.000000001, 0.05, 2')
    saveBuyPresets(values, storage)
    expect(loadBuyPresets(storage)).toEqual(values)
  })
  it.each(['','-1','Infinity','0.0000000001','1e2','1001','1,1','0,1,2,3,4,5,6'])('rejects malformed or ambiguous trade amounts (%s)', value => {
    expect(() => parseBuyPresets(value)).toThrow()
  })
  it('keeps unreadable stored preferences intact until an explicit reset', () => {
    let raw = '{"privateKey":"not-a-preset"}'
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
    expect(() => loadBuyPresets(storage)).toThrow()
    expect(raw).toContain('not-a-preset')
    saveBuyPresets([0,0.1],storage)
    expect(raw).toBe('[0,0.1]')
  })
})
