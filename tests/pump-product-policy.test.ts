import { describe, expect, it } from 'vitest'
import { DEFAULT_LAUNCH_CONFIG } from '../src/lib/launchConfig'
import { normalizePumpDesign, validatePumpCreation } from '../src/lib/pumpProductPolicy'
import { LAUNCH_SHORTCUTS, WORKSPACE_TOOLS, launchSelectionFromSearch } from '../src/lib/workspaceCatalog'

describe('Pump-only product policy', () => {
  it('only advertises Pump.fun for new launches', () => {
    expect(LAUNCH_SHORTCUTS.map(route => route.id)).toEqual(['pump'])
    const creators=WORKSPACE_TOOLS.filter(tool=>tool.category==='Create')
    expect(creators.length).toBeGreaterThan(0)
    expect(creators.every(tool=>tool.venue==='pump')).toBe(true)
    expect(creators.some(tool=>tool.href==='/multi-launch')).toBe(true)
    for (const query of ['mode=lock','mode=liquidity','venue=bonk','venue=meteora-dbc','mode=standard&venue=raydium-launchlab']) expect(launchSelectionFromSearch(new URLSearchParams(query), 1000)).toEqual({})
  })
  it('converts a retired editable design to Pump without reusing its developer spend', () => {
    const config = normalizePumpDesign({ ...DEFAULT_LAUNCH_CONFIG, mode:'lock', venue:'bonk', devBuySol:8 })
    expect(config.mode).toBe('standard'); expect(config.venue).toBe('pump'); expect(config.devBuySol).toBe(0)
    expect(normalizePumpDesign({ ...DEFAULT_LAUNCH_CONFIG, devBuySol:0.25 }).devBuySol).toBe(0.25)
  })
  it('stops removed routes at the creation boundary while keeping native Pump validation', () => {
    expect(validatePumpCreation(DEFAULT_LAUNCH_CONFIG)).toEqual([])
    expect(validatePumpCreation({ ...DEFAULT_LAUNCH_CONFIG, venue:'bonk' })).toEqual([expect.stringMatching(/Pump.fun/)])
    expect(validatePumpCreation({ ...DEFAULT_LAUNCH_CONFIG, mode:'liquidity' })).toEqual([expect.stringMatching(/Pump.fun/)])
    expect(validatePumpCreation({ ...DEFAULT_LAUNCH_CONFIG, devBuySol:NaN }).length).toBeGreaterThan(0)
  })
})
