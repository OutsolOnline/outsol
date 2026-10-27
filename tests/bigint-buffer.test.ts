import { describe, expect, it } from 'vitest'
import { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE } from '../vendor/bigint-buffer'

describe('unsigned BigInt buffer compatibility', () => {
  it('converts hand-checked 64-bit quantities in both endiannesses without mutating input', () => {
    const input = Buffer.from('0123456789abcdef', 'hex')
    expect(toBigIntBE(input)).toBe(0x0123456789abcdefn)
    expect(toBigIntLE(input)).toBe(0xefcdab8967452301n)
    expect(input.toString('hex')).toBe('0123456789abcdef')
    expect(toBufferBE(0x0123456789abcdefn, 8).toString('hex')).toBe('0123456789abcdef')
    expect(toBufferLE(0x0123456789abcdefn, 8).toString('hex')).toBe('efcdab8967452301')
  })
  it('preserves the full unsigned 128-bit range and leading zero padding', () => {
    const maximum = (1n << 128n) - 1n
    expect(toBufferBE(maximum, 16).toString('hex')).toBe('ffffffffffffffffffffffffffffffff')
    expect(toBigIntLE(toBufferLE(maximum, 16))).toBe(maximum)
    expect(toBigIntBE(toBufferBE(maximum, 16))).toBe(maximum)
    expect(toBufferBE(1n, 16).toString('hex')).toBe('00000000000000000000000000000001')
    expect(toBufferLE(1n, 16).toString('hex')).toBe('01000000000000000000000000000000')
  })
  it('treats empty inputs as zero and allows only zero in a zero-byte output', () => {
    expect(toBigIntLE(Buffer.alloc(0))).toBe(0n)
    expect(toBigIntBE(Buffer.alloc(0))).toBe(0n)
    expect(toBufferLE(0n, 0)).toEqual(Buffer.alloc(0))
    expect(toBufferBE(0n, 0)).toEqual(Buffer.alloc(0))
    expect(() => toBufferLE(1n, 0)).toThrow(RangeError)
  })
  it('rejects negative, overflowing and invalid-width quantities instead of truncating', () => {
    for (const convert of [toBufferLE, toBufferBE]) {
      expect(() => convert(-1n, 8)).toThrow(RangeError)
      expect(() => convert(1n << 64n, 8)).toThrow(RangeError)
      expect(() => convert(0n, -1)).toThrow(RangeError)
      expect(() => convert(0n, 1.5)).toThrow(RangeError)
      expect(() => convert(0n, Infinity)).toThrow(RangeError)
      expect(() => convert(0n, 1025)).toThrow(RangeError)
      expect(() => convert(1 as unknown as bigint, 8)).toThrow(TypeError)
    }
    expect(() => toBigIntLE(Buffer.alloc(1025))).toThrow(RangeError)
    expect(() => toBigIntBE(Buffer.alloc(1025))).toThrow(RangeError)
  })
})
