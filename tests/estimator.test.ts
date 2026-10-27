import { describe, it, expect } from 'vitest'
import {
  calculateProbability,
  estimateTime,
  formatProbability,
  getDifficultyLevel,
} from '../src/lib/vanity/estimator'

describe('Estimator', () => {
  describe('calculateProbability', () => {
    it('should return 1 for empty pattern', () => {
      expect(calculateProbability('', 'prefix', true)).toBe(1)
    })

    it('should calculate correct probability for 1 char prefix', () => {
      const prob = calculateProbability('A', 'prefix', true)
      // 1/58
      expect(prob).toBeCloseTo(1 / 58, 5)
    })

    it('should calculate correct probability for 2 char prefix', () => {
      const prob = calculateProbability('AB', 'prefix', true)
      // 1/58^2
      expect(prob).toBeCloseTo(1 / (58 * 58), 8)
    })

    it('should have higher probability for contains mode', () => {
      const prefixProb = calculateProbability('AB', 'prefix', true)
      const containsProb = calculateProbability('AB', 'contains', true)
      expect(containsProb).toBeGreaterThan(prefixProb)
    })

    it('should handle case-insensitive patterns', () => {
      const caseSensitiveProb = calculateProbability('AB', 'prefix', true)
      const caseInsensitiveProb = calculateProbability('AB', 'prefix', false)
      // Case-insensitive should have higher probability
      expect(caseInsensitiveProb).toBeGreaterThan(caseSensitiveProb)
    })
  })

  describe('estimateTime', () => {
    it('should return Infinity for zero probability', () => {
      const result = estimateTime(0, 10000)
      expect(result.expectedSeconds).toBe(Infinity)
      expect(result.p50Seconds).toBe(Infinity)
    })

    it('should return Infinity for zero attempts per second', () => {
      const result = estimateTime(0.5, 0)
      expect(result.expectedSeconds).toBe(Infinity)
    })

    it('should calculate expected attempts correctly', () => {
      const prob = 0.01 // 1%
      const result = estimateTime(prob, 1000)
      expect(result.expectedAttempts).toBe(100)
      expect(result.expectedSeconds).toBe(0.1)
    })

    it('should have p50 less than expected', () => {
      const result = estimateTime(0.01, 1000)
      expect(result.p50Seconds).toBeLessThan(result.expectedSeconds)
    })

    it('should have p90 greater than p50', () => {
      const result = estimateTime(0.01, 1000)
      expect(result.p90Seconds).toBeGreaterThan(result.p50Seconds)
    })

    it('should have p99 greater than p90', () => {
      const result = estimateTime(0.01, 1000)
      expect(result.p99Seconds).toBeGreaterThan(result.p90Seconds)
    })
  })

  describe('formatProbability', () => {
    it('should format 100%', () => {
      expect(formatProbability(1)).toBe('100%')
    })

    it('should format high percentages', () => {
      expect(formatProbability(0.5)).toBe('50.00%')
      expect(formatProbability(0.123)).toBe('12.30%')
    })

    it('should format low percentages', () => {
      expect(formatProbability(0.0012)).toBe('0.12%')
    })

    it('should format as "1 in X" for very low probabilities', () => {
      const result = formatProbability(0.00001)
      expect(result).toMatch(/1 in \d+K/)
    })

    it('should format millions and billions', () => {
      expect(formatProbability(1 / 1_000_000)).toMatch(/1 in \d+\.?\d*M/)
      expect(formatProbability(1 / 1_000_000_000)).toMatch(/1 in \d+\.?\d*B/)
    })
  })

  describe('getDifficultyLevel', () => {
    it('should return easy for 1-2 chars', () => {
      expect(getDifficultyLevel(1).level).toBe('easy')
      expect(getDifficultyLevel(2).level).toBe('easy')
    })

    it('should return medium for 3-4 chars', () => {
      expect(getDifficultyLevel(3).level).toBe('medium')
      expect(getDifficultyLevel(4).level).toBe('medium')
    })

    it('should return hard for 5-6 chars', () => {
      expect(getDifficultyLevel(5).level).toBe('hard')
      expect(getDifficultyLevel(6).level).toBe('hard')
    })

    it('should return extreme for 7-8 chars', () => {
      expect(getDifficultyLevel(7).level).toBe('extreme')
      expect(getDifficultyLevel(8).level).toBe('extreme')
    })

    it('should return infeasible for 9+ chars', () => {
      expect(getDifficultyLevel(9).level).toBe('infeasible')
      expect(getDifficultyLevel(10).level).toBe('infeasible')
    })

    it('should include description and color', () => {
      const result = getDifficultyLevel(3)
      expect(result.description).toBeDefined()
      expect(result.color).toBeDefined()
      expect(result.color).toMatch(/text-/)
    })
  })
})
