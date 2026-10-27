/** Original raster artwork stays in this browser's IndexedDB; no network requests are made. */
export interface ArtworkAsset { id: string; label: string; blob: Blob; type: string; size: number; createdAt: string }

const DATABASE = 'vanity-local-artwork-v1'
const STORE = 'artwork'
const MAX_ASSETS = 30
const MAX_BYTES = 25 * 1024 * 1024
const MAX_FILE_BYTES = 5 * 1024 * 1024
const ID = /^[a-f0-9]{64}$/
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const knownBlobs = new WeakMap<Blob, string>()
const knownAvailableIds = new Set<string>()
let artworkRevision = 0
/** Memory-only recognition for synchronous navigation; no image bytes enter draft JSON. */
export function knownArtworkId(blob: Blob): string | undefined {
  const id = knownBlobs.get(blob)
  return id && knownAvailableIds.has(id) ? id : undefined
}
function rememberArtwork(blob: Blob, id: string) { knownBlobs.set(blob, id); knownAvailableIds.add(id) }

function requireId(id: string) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid local artwork reference.')
}

export async function validateArtwork(blob: Blob) {
  if (!(blob instanceof Blob) || !TYPES.includes(blob.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.')
  if (!blob.size) throw new Error('The image is empty. Choose another image.')
  if (blob.size > MAX_FILE_BYTES) throw new Error('Choose an image no larger than 5 MB.')
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const begins = (signature: number[]) => bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
  const detected = begins([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : begins([255, 216, 255]) ? 'image/jpeg'
      : begins([71, 73, 70, 56, 55, 97]) || begins([71, 73, 70, 56, 57, 97]) ? 'image/gif'
        : begins([82, 73, 70, 70]) && bytes.length >= 12 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80 ? 'image/webp' : null
  if (detected !== blob.type) throw new Error('The image format does not match its file type. Choose a valid PNG, JPEG, WebP or GIF.')
}

function storedAsset(value: unknown): ArtworkAsset {
  const asset = value as Partial<ArtworkAsset> | null
  if (!asset || typeof asset.id !== 'string' || !ID.test(asset.id) || typeof asset.label !== 'string' || asset.label.length > 80 || !asset.label.trim()
    || !(asset.blob instanceof Blob) || asset.blob.size !== asset.size || asset.blob.type !== asset.type || !TYPES.includes(asset.type || '')
    || !asset.size || asset.size > MAX_FILE_BYTES || typeof asset.createdAt !== 'string' || !Number.isFinite(Date.parse(asset.createdAt))) {
    throw new Error('Saved artwork cannot be read. Preserve this browser’s data before adding another image.')
  }
  return { id: asset.id, label: asset.label, blob: asset.blob, type: asset.type!, size: asset.size, createdAt: asset.createdAt }
}

function storageError(error: unknown): Error {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  return new Error(name === 'QuotaExceededError'
    ? 'Browser storage is full. Remove an artwork image or free device space, then try again.'
    : 'Local artwork storage is unavailable. Allow storage for this site and try again; your current image is still available in the builder.')
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(storageError(null)); return }
    let settled = false
    const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error) } }
    const timer = setTimeout(() => fail(new Error('Local artwork storage is blocked. Close other OutSol tabs and try again.')), 6000)
    try {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }) }
      request.onerror = () => fail(storageError(request.error))
      request.onblocked = () => fail(new Error('Local artwork storage is blocked. Close other OutSol tabs and try again.'))
      request.onsuccess = () => {
        const db = request.result
        if (settled) { db.close(); return }
        settled = true; clearTimeout(timer)
        db.onversionchange = () => db.close()
        resolve(db)
      }
    } catch (error) { fail(storageError(error)) }
  })
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    let result: T
    let failure: Error | null = null
    try { transaction = db.transaction(STORE, mode) } catch (error) { db.close(); reject(storageError(error)); return }
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { failure ||= storageError(transaction.error) }
    transaction.onabort = () => { db.close(); reject(failure || storageError(transaction.error)) }
    const fail = (error: Error) => { failure = error; try { transaction.abort() } catch { db.close(); reject(error) } }
    try { run(transaction.objectStore(STORE), value => { result = value }, fail) } catch (error) { fail(storageError(error)) }
  })
}

function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('vanity-artwork-changed')) }

export async function saveArtwork(blob: Blob, label: string): Promise<ArtworkAsset> {
  await validateArtwork(blob)
  if (typeof label !== 'string' || label.trim().length > 80) throw new Error('Keep the artwork label within 80 characters.')
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const asset: ArtworkAsset = { id, blob, label: label.trim() || 'Untitled artwork', type: blob.type, size: blob.size, createdAt: new Date().toISOString() }
  const saved = await transact<ArtworkAsset>('readwrite', (store, result, fail) => {
    const request = store.getAll()
    request.onsuccess = () => {
      try {
        const existing = (request.result as unknown[]).map(storedAsset)
        const duplicate = existing.find(value => value.id === id)
        if (duplicate) { result(duplicate); return }
        if (existing.length >= MAX_ASSETS) throw new Error('Your library has 30 images. Delete one before saving another.')
        if (existing.reduce((total, value) => total + value.size, 0) + blob.size > MAX_BYTES) throw new Error('Your library has reached its 25 MB limit. Delete an image before saving another.')
        store.put(asset)
        result(asset)
      } catch (error) { fail(error instanceof Error && !('code' in error) ? error : storageError(error)) }
    }
  })
  artworkRevision++; rememberArtwork(blob, saved.id); rememberArtwork(saved.blob, saved.id)
  changed()
  return saved
}

export async function getArtwork(id: string): Promise<ArtworkAsset | null> {
  requireId(id)
  const revision = artworkRevision
  const asset = await transact<ArtworkAsset | null>('readonly', (store, result, fail) => {
    const request = store.get(id)
    request.onsuccess = () => { try { result(request.result === undefined ? null : storedAsset(request.result)) } catch (error) { fail(error as Error) } }
  })
  if (asset) { await validateArtwork(asset.blob); if (revision === artworkRevision) rememberArtwork(asset.blob, asset.id) } else if (revision === artworkRevision) knownAvailableIds.delete(id)
  return asset
}

export async function listArtwork(): Promise<ArtworkAsset[]> {
  const revision = artworkRevision
  const assets = await transact<ArtworkAsset[]>('readonly', (store, result, fail) => {
    const request = store.getAll()
    request.onsuccess = () => { try { result((request.result as unknown[]).map(storedAsset)) } catch (error) { fail(error as Error) } }
  })
  await Promise.all(assets.map(asset => validateArtwork(asset.blob)))
  if (revision === artworkRevision) { knownAvailableIds.clear(); assets.forEach(asset => rememberArtwork(asset.blob, asset.id)) }
  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}

export async function deleteArtwork(id: string): Promise<void> {
  requireId(id)
  await transact<void>('readwrite', (store, result) => { store.delete(id); result(undefined) })
  artworkRevision++; knownAvailableIds.delete(id)
  changed()
}

export async function artworkToDataUri(blob: Blob): Promise<string> {
  await validateArtwork(blob)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return `data:${blob.type};base64,${btoa(binary)}`
}
