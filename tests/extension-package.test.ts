import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function unpackStoredZip(bytes: Buffer) {
  const files = new Map<string, Buffer>()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0)
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    files.set(name, bytes.subarray(dataStart, dataStart + size))
    offset = dataStart + size
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
  return files
}

describe('downloadable extension package', () => {
  it('builds a deterministic complete unpacked extension with only the requested permissions', () => {
    const root = resolve(import.meta.dirname, '..')
    execFileSync(process.execPath, ['scripts/package-extension.mjs'], { cwd: root })
    const zipPath = resolve(root, 'public/downloads/outsol-extension.zip')
    const first = readFileSync(zipPath)
    const files = unpackStoredZip(first)
    expect([...files.keys()]).toEqual(['README.md', 'background.js', 'collector.js', 'icons/icon-128.png', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'manifest.json', 'popup.css', 'popup.html', 'popup.js', 'shared.js'])
    const manifest = JSON.parse(files.get('manifest.json')!.toString())
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'contextMenus'])
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.externally_connectable).toBeUndefined()
    for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) expect(files.has(file as string)).toBe(true)
    for (const size of [16, 32, 48, 128]) {
      const png = files.get(`icons/icon-${size}.png`)!
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(size)
      expect(png.readUInt32BE(20)).toBe(size)
    }
    execFileSync(process.execPath, ['scripts/package-extension.mjs'], { cwd: root })
    expect(readFileSync(zipPath)).toEqual(first)
  })
})
