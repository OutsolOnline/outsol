import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../', import.meta.url)
const source = new URL('extension/', root)
const destination = new URL('public/downloads/', root)
await mkdir(new URL('icons/', source), { recursive: true })
await mkdir(destination, { recursive: true })
await mkdir(new URL('public/extension/', root), { recursive: true })

// Derive every raster icon from the project's original vector symbol.
const symbol = await readFile(new URL('public/brand/outsol-symbol-mint.svg', root))
for (const size of [16, 32, 48, 128]) {
  const padding = Math.max(2, Math.round(size * 0.11))
  const png = await sharp(symbol).resize(size - padding * 2, size - padding * 2).extend({ top: padding, bottom: padding, left: padding, right: padding, background: '#101214' }).png().toBuffer()
  await writeFile(new URL(`icons/icon-${size}.png`, source), png)
  if (size === 128) await writeFile(new URL('public/extension/outsol-extension-128.png', root), png)
}

const files = [
  'README.md', 'background.js', 'collector.js', 'icons/icon-128.png', 'icons/icon-16.png',
  'icons/icon-32.png', 'icons/icon-48.png', 'manifest.json', 'popup.css', 'popup.html', 'popup.js', 'shared.js',
]

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const localRecords = []
const centralRecords = []
let offset = 0
const fixedDate = (46 << 9) | (1 << 5) | 1 // 2026-01-01, 00:00:00
for (const name of files) {
  const filename = Buffer.from(name, 'utf8')
  const data = await readFile(new URL(name, source))
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x800, 6)
  local.writeUInt16LE(fixedDate, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(filename.length, 26)
  localRecords.push(local, filename, data)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x800, 8)
  central.writeUInt16LE(fixedDate, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(filename.length, 28)
  central.writeUInt32LE(offset, 42)
  centralRecords.push(central, filename)
  offset += local.length + filename.length + data.length
}
const central = Buffer.concat(centralRecords)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(central.length, 12)
end.writeUInt32LE(offset, 16)
const zip = Buffer.concat([...localRecords, central, end])
await writeFile(new URL('outsol-extension.zip', destination), zip)
process.stdout.write(`Packaged OutSol extension: ${files.length} files, ${zip.length.toLocaleString('en-US')} bytes.\n`)
