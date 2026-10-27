import { afterEach, describe, expect, it, vi } from 'vitest'
import { LAUNCH_SHORTCUTS, WORKSPACE_TOOLS, launchSelectionFromSearch, searchWorkspaceTools } from '../src/lib/workspaceCatalog'
import { LAUNCH_STEP_ORDER, shouldStartNewLaunch } from '../src/lib/launchFlow'
import { prepareLaunchNavigation } from '../src/lib/launchNavigation'
import { useLaunchStore } from '../src/stores/launchStore'
afterEach(() => { useLaunchStore.getState().reset(); vi.unstubAllGlobals() })

describe('unified creator navigation', () => {
  it('opens the exact launch venue selected in a shortcut', () => {
    for (const shortcut of LAUNCH_SHORTCUTS) {
      const query = new URL(shortcut.href, 'https://vanity.example').searchParams
      const selection = launchSelectionFromSearch(query, 1000)
      expect(selection.mode).toBe(shortcut.mode)
      if (shortcut.venue) expect(selection.venue).toBe(shortcut.venue)
      if (shortcut.mode === 'lock') expect(selection.unlockAt).toBe(1000 + 30 * 86400)
    }
  })
  it('ignores unknown launch choices and never reads arbitrary configuration from URLs', () => {
    expect(launchSelectionFromSearch(new URLSearchParams('mode=malicious&venue=bad&devBuySol=99&mintSecretKey=secret'), 1000)).toEqual({})
    expect(launchSelectionFromSearch(new URLSearchParams('venue=bonk&devBuySol=99'), 1000)).toEqual({})
  })
  it('searches names, descriptions and tags without leaving supported tools', () => {
    expect(searchWorkspaceTools('  PUMP  launch ').map(tool => tool.id)).toContain('pump')
    expect(searchWorkspaceTools('bonk')).toEqual([])
    expect(searchWorkspaceTools('empty accounts').map(tool => tool.id)).toContain('inspect')
    expect(searchWorkspaceTools('rehearsal').map(tool => tool.id)).toContain('rehearse')
    expect(searchWorkspaceTools('<script>')).toEqual([])
    expect(new Set(WORKSPACE_TOOLS.map(tool => tool.id)).size).toBe(WORKSPACE_TOOLS.length)
    expect(WORKSPACE_TOOLS.every(tool => tool.href.startsWith('/') && !tool.href.startsWith('//'))).toBe(true)
  })
  it('finds the wallet bundle workspace by each supported execution style', () => {
    for (const query of ['atomic', 'block zero', 'block0', 'after confirmation', 'organic']) {
      expect(searchWorkspaceTools(query).map(tool => tool.id)).toContain('bundles')
    }
  })
  it('lets people design a token before connecting, and connects before signing', () => {
    expect(LAUNCH_STEP_ORDER).toEqual(['metadata', 'select-mint', 'launch-settings', 'connect-wallet', 'sign-send', 'result'])
  })
  it('preserves a recovered result on bare launch navigation and resets only for explicit creation', () => {
    expect(shouldStartNewLaunch('result', new URLSearchParams())).toBe(false)
    expect(shouldStartNewLaunch('result', new URLSearchParams('mode=unknown'))).toBe(false)
    expect(shouldStartNewLaunch('result', new URLSearchParams('new=1'))).toBe(true)
    expect(shouldStartNewLaunch('result', new URLSearchParams('mode=standard&venue=pump'))).toBe(true)
    expect(shouldStartNewLaunch('metadata', new URLSearchParams('new=1'))).toBe(false)
  })
  it('starts a new design even when the selected create URL already matches, while preserving pending recovery', () => {
    const values = new Map<string,string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null })
    const store = useLaunchStore.getState()
    store.setStep('result')
    prepareLaunchNavigation('/launch')
    expect(useLaunchStore.getState().currentStep).toBe('result')
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().currentStep).toBe('metadata')
    store.setConfig({ mode: 'standard', venue: 'pump' }); store.setStep('result')
    prepareLaunchNavigation('/launch?mode=standard&venue=pump')
    expect(useLaunchStore.getState().config.venue).toBe('pump')
    store.setStep('result')
    values.set('vanity-pending-launch', JSON.stringify({ mode:'standard',mint:'mint',signatures:['signature'],payer:'payer',blockhash:'blockhash',submittedAt:'now' }))
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().currentStep).toBe('result')
    expect(values.has('vanity-pending-launch')).toBe(true)
  })
})
