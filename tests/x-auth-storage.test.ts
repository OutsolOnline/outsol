import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { XAuthStore } from '../src/lib/server/xAuth/storage'

let root: string
let now: number
const key = Buffer.alloc(32, 7)
const handle = 'a'.repeat(43)
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'outsol-x-store-')); now = 1000 })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const store = (maxFiles = 2000) => new XAuthStore({ directory: join(root, 'private'), key, now: () => now, maxFiles })

describe('private X credential storage', () => {
  it('survives a new store instance while ciphertext and filenames disclose no credentials', async () => {
    await store().put('session', handle, { expiresAt: 5000, accessToken: 'secret-access-token', refreshToken: 'secret-refresh-token' })
    const files = await readdir(join(root, 'private'))
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain(handle)
    const disk = await readFile(join(root, 'private', files[0]), 'utf8')
    expect(disk).not.toContain('secret-access-token')
    expect(disk).not.toContain('secret-refresh-token')
    expect(await store().get('session', handle)).toEqual({ expiresAt: 5000, accessToken: 'secret-access-token', refreshToken: 'secret-refresh-token' })
    if (process.platform !== 'win32') {
      expect((await stat(join(root, 'private'))).mode & 0o777).toBe(0o700)
      expect((await stat(join(root, 'private', files[0]))).mode & 0o777).toBe(0o600)
    }
  })

  it('fails closed for a wrong key or modified authenticated ciphertext', async () => {
    await store().put('session', handle, { expiresAt: 5000, accessToken: 'secret-access-token' })
    const wrong = new XAuthStore({ directory: join(root, 'private'), key: Buffer.alloc(32, 8), now: () => now })
    await expect(wrong.get('session', handle)).rejects.toMatchObject({ code: 'storage_unavailable' })
    const path = join(root, 'private', (await readdir(join(root, 'private')))[0])
    const envelope = JSON.parse(await readFile(path, 'utf8'))
    envelope.ciphertext = Buffer.alloc(20, 1).toString('base64')
    await writeFile(path, JSON.stringify(envelope))
    await expect(store().get('session', handle)).rejects.toMatchObject({ code: 'storage_unavailable' })
  })

  it('consumes authorization state once even through concurrent store instances', async () => {
    await store().put('pending', handle, { expiresAt: 5000, verifier: 'private-verifier' })
    const results = await Promise.all([store().take('pending', handle), store().take('pending', handle)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await store().get('pending', handle)).toBeNull()
  })

  it('expires records and reclaims their quota without returning stale tokens', async () => {
    await store(1).put('pending', handle, { expiresAt: 2000, verifier: 'old' })
    await expect(store(1).put('pending', 'b'.repeat(43), { expiresAt: 4000 })).rejects.toMatchObject({ code: 'storage_unavailable' })
    now = 2001
    expect(await store().get('pending', handle)).toBeNull()
    await store(1).put('pending', 'b'.repeat(43), { expiresAt: 4000 })
    expect(await store().get('pending', 'b'.repeat(43))).toEqual({ expiresAt: 4000 })
  })

  it('rejects malformed handles and overlarge records before writing', async () => {
    await expect(store().put('session', '../secret', { expiresAt: 5000 })).rejects.toMatchObject({ code: 'storage_unavailable' })
    await expect(store().put('session', handle, { expiresAt: 5000, secret: 'x'.repeat(65536) })).rejects.toMatchObject({ code: 'storage_unavailable' })
  })

  it('refuses a private directory redirected to public assets through a symbolic link', async () => {
    const publicDirectory = join(root, 'public')
    await mkdir(publicDirectory)
    await symlink(publicDirectory, join(root, 'private'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store().put('session', handle, { expiresAt: 5000, accessToken: 'private' })).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(await readdir(publicDirectory)).toHaveLength(0)
  })

  // Real durable writes and quota scans need headroom under full-suite Windows disk contention.
  it('allows concurrent claims, credential removal, and unrelated session writes without quota-scan races', async () => {
    const handles = Array.from({ length: 20 }, (_, index) => Buffer.alloc(32, index + 1).toString('base64url'))
    for (const id of handles) await store().put('pending', id, { expiresAt: 5000, verifier: 'one-use' })
    const operations = handles.flatMap((id, index) => [
      index % 2 ? store().take('pending', id) : store().remove('pending', id),
      store().put('session', id, { expiresAt: 5000, accessToken: `token-${index}` }),
    ])
    await expect(Promise.all(operations)).resolves.toHaveLength(40)
    expect(await readdir(join(root, 'private'))).toHaveLength(20)
    for (const id of handles) expect(await store().get('pending', id)).toBeNull()
  }, 15_000)
})
