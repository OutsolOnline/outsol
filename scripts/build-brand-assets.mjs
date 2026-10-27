// Raster fallbacks are rendered from the same production SVG used by modern browsers.
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../public/', import.meta.url)
const svg = await readFile(new URL('favicon.svg', root))
let favicon32
for (const [size, file] of [[16,'favicon-16x16.png'],[32,'favicon-32x32.png'],[180,'apple-touch-icon.png']]) {
  const png = await sharp(svg).resize(size, size).png().toBuffer()
  await writeFile(new URL(file, root), png)
  if (size === 32) favicon32 = png
}
const ico = Buffer.alloc(22)
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4)
ico[6] = 32; ico[7] = 32
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12)
ico.writeUInt32LE(favicon32.length, 14); ico.writeUInt32LE(22, 18)
await writeFile(new URL('favicon.ico', root), Buffer.concat([ico, favicon32]))
process.stdout.write('Rendered favicon PNG/ICO and Apple touch icon from the OutSol SVG.\n')
