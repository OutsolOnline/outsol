import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { storePublicTokenMetadata, readPublicAsset } from '../src/lib/server/publicAssets'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vanity-assets-test-'))
  vi.stubEnv('ASSET_STORAGE_DIR', directory)
  vi.stubEnv('PUBLIC_APP_URL', 'https://vanity.example')
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })

it('stores immutable public metadata under content hashes and serves the same bytes', async () => {
  const image = new Uint8Array([137,80,78,71,13,10,26,10,0])
  const result = await storePublicTokenMetadata(image, 'image/png', { name: 'Test', symbol: 'TEST', description: 'Public token' })
  expect(result.metadataUri.startsWith('https://vanity.example/api/assets/')).toBe(true)
  const metadataFile = result.metadataUri.split('/').at(-1)!
  const metadata = await readPublicAsset(metadataFile)
  expect(metadata).not.toBeNull()
  const parsed = JSON.parse(new TextDecoder().decode(metadata!.bytes))
  expect(parsed.image).toBe(`https://vanity.example/api/assets/${createHash('sha256').update(image).digest('hex')}.png`)
  expect(parsed.name).toBe('Test')
  expect(parsed.secretKey).toBeUndefined()
  expect(metadataFile).toBe(`${createHash('sha256').update(metadata!.bytes).digest('hex')}.json`)
})

it('rejects traversal and refuses a directory already beyond its quota', async () => {
  expect(await readPublicAsset('../.env')).toBeNull()
  expect(await readPublicAsset('%2e%2e%2fsecret.json')).toBeNull()
  vi.stubEnv('ASSET_STORAGE_QUOTA_MB', '0')
  await expect(storePublicTokenMetadata(new Uint8Array([1]), 'image/png', { name: 'Test', symbol: 'TEST' })).rejects.toThrow()
})

it('fails closed without a trusted HTTPS public origin', async () => {
  vi.stubEnv('PUBLIC_APP_URL', 'http://evil.example')
  await expect(storePublicTokenMetadata(new Uint8Array([1]), 'image/png', { name: 'Test', symbol: 'TEST' })).rejects.toThrow()
})
