import { describe, expect, it } from 'vitest'
import { DEFAULT_LAUNCH_CONFIG, PLATFORM_FEE_BPS, validateLaunchConfig, validateTokenDetails } from '../src/lib/launchConfig'

describe('launch configuration', () => {
  it('charges no Vanity platform fee', () => {
    expect(PLATFORM_FEE_BPS).toBe(0)
  })
  it('rejects nonfinite amounts and invalid liquidity allocations', () => {
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, devBuySol: NaN })).toContain('Developer buy must be a valid SOL amount.')
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, mode: 'liquidity', liquidityPercent: 100 })).toContain('Liquidity allocation must be between 1% and 99%.')
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, mode: 'liquidity', liquiditySol: '0' })).toContain('Add a positive SOL amount for liquidity.')
  })
  it('requires a future date for an immediate developer lock', () => {
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, mode: 'lock', unlockAt: 100 }, 100)).toContain('Choose an unlock date at least one hour in the future.')
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, mode: 'lock', unlockAt: 7200 }, 100)).toEqual([])
  })
  it('rejects supply outside an unsigned 64 bit token amount', () => {
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, mode: 'liquidity', totalSupply: '99999999999999999' }).length).toBeGreaterThan(0)
  })
  it('accepts defaults for a standard launch', () => {
    expect(validateLaunchConfig(DEFAULT_LAUNCH_CONFIG)).toEqual([])
  })
})

describe('public token metadata', () => {
  it('rejects whitespace-only names and unsafe social URLs', () => {
    expect(validateTokenDetails({ name: '  ', symbol: 'BAD', description: '', website: 'javascript:alert(1)' })).toMatchObject({ name: expect.any(String), website: expect.any(String) })
  })
  it('accepts full HTTPS social links and a trimmed token name', () => {
    expect(validateTokenDetails({ name: 'Vanity', symbol: 'VAN', description: '', website: 'https://example.com' })).toEqual({})
  })
})
