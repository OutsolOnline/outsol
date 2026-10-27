import { describe, expect, it } from 'vitest'
import { getCenteredCrop, getArtworkFileError } from '../src/components/launch/tokenArtwork'

describe('token artwork crop geometry', () => {
  it('crops a landscape image to its centered square without stretching', () => {
    expect(getCenteredCrop(1600, 900, 1)).toEqual({ x: 350, y: 0, size: 900 })
  })

  it('uses the same center when zooming a portrait image', () => {
    expect(getCenteredCrop(800, 1200, 2)).toEqual({ x: 200, y: 400, size: 400 })
  })

  it('bounds zoom so crop pixels always stay inside the source', () => {
    expect(getCenteredCrop(600, 600, -4)).toEqual({ x: 0, y: 0, size: 600 })
    expect(getCenteredCrop(600, 600, 100)).toEqual({ x: 200, y: 200, size: 200 })
    expect(getCenteredCrop(600, 600, Number.NaN)).toEqual({ x: 0, y: 0, size: 600 })
  })

  it('rejects empty, negative or non-finite image dimensions', () => {
    for (const dimensions of [[0, 500], [500, -1], [Infinity, 500], [500, NaN]]) {
      expect(() => getCenteredCrop(dimensions[0], dimensions[1], 1)).toThrow('Invalid image dimensions')
    }
  })
})

describe('token artwork upload validation', () => {
  it('accepts supported raster formats up to five megabytes', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(getArtworkFileError({ type, size: 5 * 1024 * 1024 })).toBeNull()
    }
  })

  it('rejects SVG, missing types, empty files and oversized files before decoding', () => {
    expect(getArtworkFileError({ type: 'image/svg+xml', size: 100 })).toMatch(/PNG, JPEG, WebP or GIF/)
    expect(getArtworkFileError({ type: '', size: 100 })).toMatch(/PNG, JPEG, WebP or GIF/)
    expect(getArtworkFileError({ type: 'image/png', size: 0 })).toMatch(/empty/)
    expect(getArtworkFileError({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/)
  })
})
