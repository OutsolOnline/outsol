export function getCenteredCrop(width: number, height: number, zoom: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }
  const boundedZoom = Number.isFinite(zoom) ? Math.min(3, Math.max(1, zoom)) : 1
  const size = Math.min(width, height) / boundedZoom
  return { x: (width - size) / 2, y: (height - size) / 2, size }
}

export function getArtworkFileError(file: { type: string; size: number }): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    return 'Choose a PNG, JPEG, WebP or GIF image.'
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return 'This image is empty. Choose another file.'
  if (file.size > 5 * 1024 * 1024) return 'Choose an image of 5 MB or less.'
  return null
}
