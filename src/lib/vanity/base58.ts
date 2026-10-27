/**
 * Base58 alphabet used by Bitcoin/Solana
 * Excludes: 0, O, I, l to avoid visual confusion
 */
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const BASE58_SET = new Set(BASE58_ALPHABET.split(''))

/**
 * Validates that a string contains only valid Base58 characters
 */
export function isValidBase58(str: string): boolean {
  if (!str || str.length === 0) return false
  return str.split('').every(char => BASE58_SET.has(char))
}

// Alias for convenience
export const validateBase58 = isValidBase58

/**
 * Returns invalid characters in a string that are not valid Base58
 */
export function getInvalidBase58Chars(str: string): string[] {
  const invalid: string[] = []
  for (const char of str) {
    if (!BASE58_SET.has(char) && !invalid.includes(char)) {
      invalid.push(char)
    }
  }
  return invalid
}

/**
 * Explains why certain characters are invalid in Base58
 */
export function getBase58ExplanationForChar(char: string): string {
  const explanations: Record<string, string> = {
    '0': 'Zero (0) looks like letter O',
    'O': 'Letter O looks like zero (0)',
    'I': 'Capital I looks like lowercase l or number 1',
    'l': 'Lowercase l looks like capital I or number 1',
  }
  return explanations[char] || 'Not part of Base58 alphabet'
}

/**
 * Validates a pattern and returns detailed validation result
 */
export interface PatternValidation {
  isValid: boolean
  invalidChars: string[]
  warnings: string[]
  explanation?: string
}

export function validatePattern(pattern: string): PatternValidation {
  if (!pattern) {
    return {
      isValid: false,
      invalidChars: [],
      warnings: [],
      explanation: 'Pattern cannot be empty',
    }
  }

  const invalidChars = getInvalidBase58Chars(pattern)
  const warnings: string[] = []

  // Length warnings
  if (pattern.length > 5) {
    warnings.push(
      `Pattern length ${pattern.length} may take a very long time. Consider using a native CLI tool for patterns > 5 characters.`
    )
  }

  if (pattern.length > 8) {
    warnings.push(
      'Pattern length > 8 is practically infeasible in browser. Expected time: centuries.'
    )
  }

  // Case sensitivity note
  const hasUppercase = /[A-Z]/.test(pattern)
  const hasLowercase = /[a-z]/.test(pattern)
  if (hasUppercase && hasLowercase) {
    warnings.push('Mixed case patterns are harder to find (Base58 is case-sensitive)')
  }

  return {
    isValid: invalidChars.length === 0,
    invalidChars,
    warnings,
    explanation: invalidChars.length > 0
      ? `Invalid characters: ${invalidChars.map(c => `"${c}" (${getBase58ExplanationForChar(c)})`).join(', ')}`
      : undefined,
  }
}

/**
 * Checks if a public key matches the pattern based on mode
 */
export type MatchMode = 'prefix' | 'suffix' | 'contains'

export function matchesPattern(
  pubkey: string,
  pattern: string,
  mode: MatchMode,
  caseSensitive: boolean
): boolean {
  const key = caseSensitive ? pubkey : pubkey.toLowerCase()
  const pat = caseSensitive ? pattern : pattern.toLowerCase()

  switch (mode) {
    case 'prefix':
      return key.startsWith(pat)
    case 'suffix':
      return key.endsWith(pat)
    case 'contains':
      return key.includes(pat)
    default:
      return false
  }
}
