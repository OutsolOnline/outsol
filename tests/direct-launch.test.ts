import { describe, expect, it } from 'vitest'
import { calculateDirectAllocations } from '../src/lib/launch/allocations'

describe('direct launch allocations', () => {
  it('preserves all atomic units instead of using floating-point supply arithmetic', () => {
    const result = calculateDirectAllocations('1000000000.000001', 6, 80, '1.125')
    expect(result.totalRaw).toBe(1000000000000001n)
    expect(result.liquidityRaw).toBe(800000000000000n)
    expect(result.developerRaw).toBe(200000000000001n)
    expect(result.liquidityLamports).toBe(1125000000n)
  })

  it('rounds fractional pool allocation down and assigns the remainder to the developer', () => {
    const result = calculateDirectAllocations('101', 0, 33.33, '0.000000001')
    expect(result.liquidityRaw).toBe(33n)
    expect(result.developerRaw).toBe(68n)
  })

  it.each([
    ['1.0000001', 6, 80, '1'],
    ['18446744073709551616', 0, 80, '1'],
    ['1e9', 6, 80, '1'],
    ['100', 6, 0, '1'],
    ['100', 6, 100, '1'],
    ['100', 6, 50.001, '1'],
    ['100', 6, 80, '0'],
    ['100', 6, 80, '0.0000000001'],
    ['100', 6, 80, 'NaN'],
  ] as const)('rejects an inexact or invalid allocation: %s %s %s %s', (supply, decimals, percent, sol) => {
    expect(() => calculateDirectAllocations(supply, decimals, percent, sol)).toThrow()
  })
})
