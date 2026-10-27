import { describe, it, expect } from 'vitest'
import {
  isValidBase58,
  getInvalidBase58Chars,
  validatePattern,
  matchesPattern,
  BASE58_ALPHABET,
} from '../src/lib/vanity/base58'

describe('Base58 Validation', () => {
  describe('isValidBase58', () => {
    it('should return true for valid Base58 strings', () => {
      expect(isValidBase58('123456789')).toBe(true)
      expect(isValidBase58('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')).toBe(true)
      expect(isValidBase58('PUMP')).toBe(true)
      expect(isValidBase58('SoL')).toBe(true)
    })

    it('should return false for strings with invalid characters', () => {
      expect(isValidBase58('0')).toBe(false) // Zero
      expect(isValidBase58('O')).toBe(false) // Capital O
      expect(isValidBase58('I')).toBe(false) // Capital I
      expect(isValidBase58('l')).toBe(false) // Lowercase L
      expect(isValidBase58('PUMP!')).toBe(false)
      expect(isValidBase58('test with spaces')).toBe(false)
    })

    it('should return false for empty strings', () => {
      expect(isValidBase58('')).toBe(false)
    })
  })

  describe('getInvalidBase58Chars', () => {
    it('should return empty array for valid strings', () => {
      expect(getInvalidBase58Chars('PUMP')).toEqual([])
      expect(getInvalidBase58Chars('123abc')).toEqual([])
    })

    it('should return invalid characters', () => {
      expect(getInvalidBase58Chars('0')).toEqual(['0'])
      expect(getInvalidBase58Chars('OIl')).toEqual(['O', 'I', 'l'])
      expect(getInvalidBase58Chars('PUMP!')).toEqual(['!'])
    })

    it('should not return duplicates', () => {
      expect(getInvalidBase58Chars('000')).toEqual(['0'])
      expect(getInvalidBase58Chars('0!0!')).toEqual(['0', '!'])
    })
  })

  describe('validatePattern', () => {
    it('should validate valid patterns', () => {
      const result = validatePattern('PUMP')
      expect(result.isValid).toBe(true)
      expect(result.invalidChars).toEqual([])
    })

    it('should invalidate patterns with bad characters', () => {
      const result = validatePattern('0PUMP')
      expect(result.isValid).toBe(false)
      expect(result.invalidChars).toContain('0')
      expect(result.explanation).toBeDefined()
    })

    it('should warn about long patterns', () => {
      const result = validatePattern('PUMPFUN')
      expect(result.isValid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('should return invalid for empty pattern', () => {
      const result = validatePattern('')
      expect(result.isValid).toBe(false)
    })
  })

  describe('matchesPattern', () => {
    const testAddress = 'PUMPxyz123ABCdef'

    describe('prefix mode', () => {
      it('should match prefix case-sensitive', () => {
        expect(matchesPattern(testAddress, 'PUMP', 'prefix', true)).toBe(true)
        expect(matchesPattern(testAddress, 'pump', 'prefix', true)).toBe(false)
      })

      it('should match prefix case-insensitive', () => {
        expect(matchesPattern(testAddress, 'pump', 'prefix', false)).toBe(true)
        expect(matchesPattern(testAddress, 'PUMP', 'prefix', false)).toBe(true)
      })
    })

    describe('suffix mode', () => {
      it('should match suffix case-sensitive', () => {
        expect(matchesPattern(testAddress, 'def', 'suffix', true)).toBe(true)
        expect(matchesPattern(testAddress, 'DEF', 'suffix', true)).toBe(false)
      })

      it('should match suffix case-insensitive', () => {
        expect(matchesPattern(testAddress, 'DEF', 'suffix', false)).toBe(true)
      })
    })

    describe('contains mode', () => {
      it('should match contains case-sensitive', () => {
        expect(matchesPattern(testAddress, 'xyz', 'contains', true)).toBe(true)
        expect(matchesPattern(testAddress, 'XYZ', 'contains', true)).toBe(false)
      })

      it('should match contains case-insensitive', () => {
        expect(matchesPattern(testAddress, 'XYZ', 'contains', false)).toBe(true)
      })
    })
  })

  describe('BASE58_ALPHABET', () => {
    it('should have exactly 58 characters', () => {
      expect(BASE58_ALPHABET.length).toBe(58)
    })

    it('should not contain 0, O, I, l', () => {
      expect(BASE58_ALPHABET).not.toContain('0')
      expect(BASE58_ALPHABET).not.toContain('O')
      expect(BASE58_ALPHABET).not.toContain('I')
      expect(BASE58_ALPHABET).not.toContain('l')
    })

    it('should contain all expected characters', () => {
      expect(BASE58_ALPHABET).toContain('1')
      expect(BASE58_ALPHABET).toContain('9')
      expect(BASE58_ALPHABET).toContain('A')
      expect(BASE58_ALPHABET).toContain('Z')
      expect(BASE58_ALPHABET).toContain('a')
      expect(BASE58_ALPHABET).toContain('z')
    })
  })
})
