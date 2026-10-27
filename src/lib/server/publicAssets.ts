import { createHash } from 'node:crypto'
import { mkdir, opendir, lstat, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', json: 'application/json; charset=utf-8' }
const FILE_PATTERN = /^[a-f0-9]{64}\.(png|jpg|webp|gif|json)$/
let pendingWrite: Promise<unknown> = Promise.resolve()

function settings() {
  const directory = process.env.ASSET_STORAGE_DIR
  const publicUrl = process.env.PUBLIC_APP_URL
  if (!directory || !publicUrl) throw new Error('Public metadata storage is not configured')
  const url = new URL(publicUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_APP_URL must be an HTTPS origin')
  const megabytes = Number(process.env.ASSET_STORAGE_QUOTA_MB || '512')
  if (!Number.isFinite(megabytes) || megabytes <= 0 || megabytes > 8192) throw new Error('Invalid public storage quota')
  return { directory: resolve(directory), origin: url.origin, quota: megabytes * 1024 * 1024 }
}

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

async function currentUsage(directory: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  for await (const entry of await opendir(directory)) {
    if (++files > 10_000) throw new Error('Public storage file quota reached')
    const stat = await lstat(join(directory, entry.name))
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected public storage entry')
    bytes += stat.size
  }
  return { bytes, files }
}

async function immutableWrite(directory: string, filename: string, bytes: Uint8Array) {
  try { await writeFile(join(directory, filename), bytes, { flag: 'wx', mode: 0o644 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const stored = await readFile(join(directory, filename))
    if (hash(stored) !== hash(bytes)) throw new Error('Stored asset failed integrity check')
  }
}

/** Caller validates raster signatures and text limits before invoking this storage layer. */
export async function storePublicTokenMetadata(image: Uint8Array, imageType: string, fields: Record<string, string>): Promise<{ metadataUri: string; metadata: { name: string; symbol: string } }> {
  const task = pendingWrite.then(async () => {
    const config = settings()
    const extension = TYPES[imageType]
    if (!extension || !image.length || image.length > 5 * 1024 * 1024) throw new Error('Invalid public image')
    await mkdir(config.directory, { recursive: true, mode: 0o700 })
    const imageFile = `${hash(image)}.${extension}`
    // Explicitly select public token fields; arbitrary input keys are never persisted.
    const metadata: Record<string, string | boolean> = {
      name: (fields.name || '').slice(0,32), symbol: (fields.symbol || '').slice(0,10),
      description: (fields.description || '').slice(0,1000),
      image: `${config.origin}/api/assets/${imageFile}`, showName: true,
    }
    for (const key of ['twitter', 'telegram', 'website']) if (fields[key]) metadata[key] = fields[key].slice(0,300)
    const json = new TextEncoder().encode(JSON.stringify(metadata))
    const metadataFile = `${hash(json)}.json`
    const usage = await currentUsage(config.directory)
    // Conservative reservation also bounds concurrent writes in this process.
    if (usage.bytes + image.length + json.length > config.quota || usage.files + 2 > 10_000) throw new Error('Public storage quota reached')
    await immutableWrite(config.directory, imageFile, image)
    await immutableWrite(config.directory, metadataFile, json)
    return { metadataUri: `${config.origin}/api/assets/${metadataFile}`, metadata: { name: String(metadata.name), symbol: String(metadata.symbol) } }
  })
  pendingWrite = task.catch(() => {})
  return task
}

export async function readPublicAsset(filename: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!FILE_PATTERN.test(filename)) return null
  try {
    const config = settings()
    const path = join(config.directory, filename)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) return null
    const bytes = await readFile(path)
    if (hash(bytes) !== filename.slice(0,64)) return null
    return { bytes, contentType: MIME[filename.split('.').at(-1)!] }
  } catch { return null }
}
