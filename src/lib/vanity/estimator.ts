import { MatchMode, BASE58_ALPHABET } from './base58'

const BASE58_SIZE = BASE58_ALPHABET.length // 58

/**
 * Calculate the probability of finding a match for a given pattern
 */
export function calculateProbability(
  pattern: string,
  mode: MatchMode,
  caseSensitive: boolean
): number {
  const patternLength = pattern.length
  
  if (patternLength === 0) return 1

  // For case-insensitive, we need to account for multiple matches
  // Base58 has 22 lowercase + 22 uppercase = 44 letter chars (excluding 9 digits)
  // Simplified: if not case sensitive and pattern has letters, probability is higher
  
  let effectiveBase = BASE58_SIZE

  if (!caseSensitive) {
    // Count letters vs digits in pattern
    const letterCount = (pattern.match(/[a-zA-Z]/g) || []).length
    // For each letter position, we match 2 chars (upper + lower) out of 58
    // This is a simplification; actual math is more complex
    // Rough approximation: effective base is reduced for letter positions
    if (letterCount > 0) {
      // Each letter can match 2 variants, so probability doubles per letter
      const multiplier = Math.pow(2, letterCount)
      return multiplier / Math.pow(BASE58_SIZE, patternLength)
    }
  }

  // Prefix/Suffix: 1/58^k
  // Contains: roughly (32-k+1) * (1/58^k) for a 32-44 char address
  // Solana addresses are 32-44 chars (usually 43-44)
  
  const baseProb = 1 / Math.pow(effectiveBase, patternLength)
  
  if (mode === 'contains') {
    // Average address length is ~43 chars
    const avgAddressLen = 43
    const possiblePositions = Math.max(1, avgAddressLen - patternLength + 1)
    // This is an upper bound (positions aren't independent, but good approximation)
    return Math.min(1, baseProb * possiblePositions)
  }

  return baseProb
}

/**
 * Estimate time to find a match given attempts per second
 */
export function estimateTime(
  probability: number,
  attemptsPerSecond: number
): {
  expectedAttempts: number
  expectedSeconds: number
  p50Seconds: number
  p90Seconds: number
  p99Seconds: number
} {
  if (probability <= 0 || attemptsPerSecond <= 0) {
    return {
      expectedAttempts: Infinity,
      expectedSeconds: Infinity,
      p50Seconds: Infinity,
      p90Seconds: Infinity,
      p99Seconds: Infinity,
    }
  }

  // Expected value for geometric distribution is 1/p
  const expectedAttempts = 1 / probability
  const expectedSeconds = expectedAttempts / attemptsPerSecond

  // For geometric distribution:
  // P(X <= k) = 1 - (1-p)^k
  // To find k for P(X <= k) = q, solve: k = log(1-q) / log(1-p)
  
  const calcPercentile = (percentile: number): number => {
    if (probability >= 1) return 0
    return Math.log(1 - percentile) / Math.log(1 - probability) / attemptsPerSecond
  }

  return {
    expectedAttempts,
    expectedSeconds,
    p50Seconds: calcPercentile(0.5),
    p90Seconds: calcPercentile(0.9),
    p99Seconds: calcPercentile(0.99),
  }
}

/**
 * Format probability as a human-readable string
 */
export function formatProbability(probability: number): string {
  if (probability >= 1) return '100%'
  if (probability >= 0.01) return `${(probability * 100).toFixed(2)}%`
  if (probability >= 0.0001) return `${Number((probability * 100).toFixed(4))}%`
  
  // Express as 1 in X
  const oneIn = Math.round(1 / probability)
  if (oneIn >= 1_000_000_000) {
    return `1 in ${(oneIn / 1_000_000_000).toFixed(1)}B`
  }
  if (oneIn >= 1_000_000) {
    return `1 in ${(oneIn / 1_000_000).toFixed(1)}M`
  }
  if (oneIn >= 1_000) {
    return `1 in ${Math.round(oneIn / 1_000)}K`
  }
  return `1 in ${oneIn}`
}

/**
 * Get difficulty level description
 */
export function getDifficultyLevel(patternLength: number): {
  level: 'easy' | 'medium' | 'hard' | 'extreme' | 'infeasible'
  description: string
  color: string
} {
  if (patternLength <= 2) {
    return {
      level: 'easy',
      description: 'Usually found in seconds',
      color: 'text-green-400',
    }
  }
  if (patternLength <= 4) {
    return {
      level: 'medium',
      description: 'May take minutes to hours',
      color: 'text-yellow-400',
    }
  }
  if (patternLength <= 6) {
    return {
      level: 'hard',
      description: 'May take hours to days',
      color: 'text-orange-400',
    }
  }
  if (patternLength <= 8) {
    return {
      level: 'extreme',
      description: 'May take days to weeks',
      color: 'text-red-400',
    }
  }
  return {
    level: 'infeasible',
    description: 'Practically impossible in browser',
    color: 'text-red-600',
  }
}
