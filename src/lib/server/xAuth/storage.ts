import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { unavailableStorage } from './types'

export type XRecord = { expiresAt: number; [key: string]: unknown }
type Kind = 'pending' | 'session' | 'flow'
interface StoreOptions { directory: string; key: Uint8Array; now?: () => number; maxFiles?: number; maxBytes?: number }
const MAX_RECORD = 32_768, MAX_ENVELOPE = 49_152
const NAME = /^(pending|session|flow)-([a-f0-9]{64})\.enc$/
const HANDLE = /^[A-Za-z0-9_-]{43}$/
const processState = globalThis as typeof globalThis & { __outsolXStoreLocks?: Map<string, Promise<void>> }
const locks = processState.__outsolXStoreLocks ||= new Map<string, Promise<void>>()

/** Private credentials only. No part of this directory is exposed by an asset route. */
export class XAuthStore {
  private readonly directory: string
  private readonly key: Buffer
  private readonly now: () => number
  private readonly maxFiles: number
  private readonly maxBytes: number
  constructor(options: StoreOptions) {
    this.directory = resolve(options.directory); this.key = Buffer.from(options.key)
    this.now = options.now || Date.now; this.maxFiles = options.maxFiles ?? 2000; this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024
    if (this.key.length !== 32 || this.maxFiles < 1 || this.maxBytes < MAX_ENVELOPE) throw unavailableStorage()
  }

  /** Shared across route modules and store instances in this single-process deployment. */
  async lock<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.directory}:${scope}`, previous = locks.get(key) || Promise.resolve()
    const task = previous.catch(() => {}).then(operation), settled = task.then(() => {}, () => {})
    locks.set(key, settled)
    void settled.then(() => { if (locks.get(key) === settled) locks.delete(key) })
    return task
  }

  private filename(kind: Kind, handle: string): string {
    if (!HANDLE.test(handle) || !['pending', 'session', 'flow'].includes(kind)) throw unavailableStorage()
    return `${kind}-${createHash('sha256').update(handle).digest('hex')}.enc`
  }
  private async ready() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const parent = dirname(this.directory), [directoryStat, parentStat] = await Promise.all([lstat(this.directory), lstat(parent)])
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || parentStat.isSymbolicLink() || dirname(await realpath(this.directory)) !== await realpath(parent)) throw unavailableStorage()
    await chmod(this.directory, 0o700)
  }
  private aad(filename: string): Buffer { return Buffer.from(`outsol-x:v1:${filename}`, 'utf8') }
  private encrypt(filename: string, value: XRecord): Buffer {
    const plain = Buffer.from(JSON.stringify(value))
    if (plain.length > MAX_RECORD || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= this.now()) throw unavailableStorage()
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(this.aad(filename))
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.from(JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }))
  }
  private async readEncrypted(path: string, filename: string): Promise<XRecord> {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > MAX_ENVELOPE) throw unavailableStorage()
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_ENVELOPE || info.nlink !== 1) throw unavailableStorage()
      const bytes = await handle.readFile()
      if (bytes.length > MAX_ENVELOPE) throw unavailableStorage()
      const envelope = JSON.parse(bytes.toString('utf8'))
      if (!envelope || envelope.version !== 1 || Object.keys(envelope).some(key => !['version', 'iv', 'tag', 'ciphertext'].includes(key))) throw unavailableStorage()
      const decode = (value: unknown) => {
        if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw unavailableStorage()
        const decoded = Buffer.from(value, 'base64')
        if (decoded.toString('base64') !== value) throw unavailableStorage()
        return decoded
      }
      const iv = decode(envelope.iv), tag = decode(envelope.tag), ciphertext = decode(envelope.ciphertext)
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_RECORD) throw unavailableStorage()
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
      decipher.setAAD(this.aad(filename)); decipher.setAuthTag(tag)
      const value = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0) throw unavailableStorage()
      return value as XRecord
    } finally { await handle.close() }
  }
  private async syncDirectory() {
    // Linux volume durability includes the rename/unlink, not only file contents.
    if (process.platform === 'win32') return
    const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY)
    try { await directory.sync() } finally { await directory.close() }
  }
  private async removePath(path: string) { try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  private async usage(replacing: string) {
    let files = 0, bytes = 0
    const entries = await readdir(this.directory)
    if (entries.length > this.maxFiles + 100) throw unavailableStorage()
    for (const name of entries) {
      const path = join(this.directory, name), info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_ENVELOPE) throw unavailableStorage()
      if (NAME.test(name)) {
        const record = await this.readEncrypted(path, name)
        if (record.expiresAt <= this.now()) { await this.removePath(path); continue }
      } else if (/^\.(write|consume)-[a-f0-9]{32}$/.test(name)) {
        if (info.mtimeMs < this.now() - 10 * 60_000) { await this.removePath(path); continue }
      } else throw unavailableStorage()
      if (name !== replacing) { files++; bytes += info.size }
    }
    return { files, bytes }
  }

  async put(kind: Kind, handle: string, value: XRecord): Promise<void> {
    try {
      const filename = this.filename(kind, handle), encrypted = this.encrypt(filename, value)
      await this.lock('write', async () => {
        await this.ready()
        const usage = await this.usage(filename)
        if (usage.files + 1 > this.maxFiles || usage.bytes + encrypted.length > this.maxBytes) throw unavailableStorage()
        const temporary = join(this.directory, `.write-${randomBytes(16).toString('hex')}`)
        try {
          const file = await open(temporary, 'wx', 0o600)
          try { await file.writeFile(encrypted); await file.sync() } finally { await file.close() }
          await rename(temporary, join(this.directory, filename))
          await this.syncDirectory()
        } finally { await this.removePath(temporary) }
      })
    } catch { throw unavailableStorage() }
  }
  async get<T extends XRecord = XRecord>(kind: Kind, handle: string): Promise<T | null> {
    try {
      const filename = this.filename(kind, handle)
      return await this.lock('write', async () => {
        await this.ready()
        let value: XRecord
        try { value = await this.readEncrypted(join(this.directory, filename), filename) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
        if (value.expiresAt <= this.now()) { await this.removePath(join(this.directory, filename)); await this.syncDirectory(); return null }
        return value as T
      })
    } catch { throw unavailableStorage() }
  }
  /** Rename claims state atomically, including across a process restart or overlapping worker. */
  async take<T extends XRecord = XRecord>(kind: Kind, handle: string): Promise<T | null> {
    try {
      const filename = this.filename(kind, handle)
      return await this.lock('write', async () => {
        await this.ready()
        const claimed = join(this.directory, `.consume-${randomBytes(16).toString('hex')}`)
        try { await rename(join(this.directory, filename), claimed) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
        try {
          await this.syncDirectory()
          const value = await this.readEncrypted(claimed, filename)
          return value.expiresAt <= this.now() ? null : value as T
        } finally { await this.removePath(claimed); await this.syncDirectory() }
      })
    } catch { throw unavailableStorage() }
  }
  async remove(kind: Kind, handle: string): Promise<void> {
    try {
      const filename = this.filename(kind, handle)
      await this.lock('write', async () => {
        try { await this.removePath(join(this.directory, filename)); await this.syncDirectory() }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      })
    } catch { throw unavailableStorage() }
  }
}
