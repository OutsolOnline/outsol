import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { saveArtwork, getArtwork, listArtwork, deleteArtwork, artworkToDataUri, knownArtworkId } from '../src/lib/artworkLibrary'

const png = (marker = 0, size = 16) => {
  const bytes = new Uint8Array(size)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes[8] = marker
  return new Blob([bytes], { type: 'image/png' })
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('indexedDB', new IDBFactory())
})

describe('local artwork library', () => {
  it('recognizes a Blob as saved only after its persistence succeeds, including freshly restored Blob instances',async()=>{
    const original=png(71)
    expect(knownArtworkId(original)).toBeUndefined()
    const asset=await saveArtwork(original,'Saved design')
    expect(knownArtworkId(original)).toBe(asset.id)
    const restored=await getArtwork(asset.id)
    expect(restored?.blob).not.toBe(original)
    expect(knownArtworkId(restored!.blob)).toBe(asset.id)
    const rejected=new Blob(['not a PNG'],{type:'image/png'})
    await expect(saveArtwork(rejected,'Invalid')).rejects.toThrow()
    expect(knownArtworkId(rejected)).toBeUndefined()
  })
  it('does not let a delayed artwork read reclassify a deleted image as safely saved',async()=>{
    const original=png(72),asset=await saveArtwork(original,'Delete during read')
    let release!:()=>void,started!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve}),begun=new Promise<void>(resolve=>{started=resolve})
    const read=Blob.prototype.arrayBuffer
    let blocked=false
    const spy=vi.spyOn(Blob.prototype,'arrayBuffer').mockImplementation(async function(this:Blob){if(this.size===12&&!blocked){blocked=true;started();await gate}return read.call(this)})
    const loading=getArtwork(asset.id)
    await begun;await deleteArtwork(asset.id);release();await loading;spy.mockRestore()
    expect(knownArtworkId(original)).toBeUndefined()
  })
  it('stores the original Blob and label across a module reload, then deletes only the selected artwork', async () => {
    const first = await saveArtwork(png(1), '  Green frog  ')
    const second = await saveArtwork(png(2), 'Blue bird')
    expect(first.id).toMatch(/^[a-f0-9]{64}$/)
    vi.resetModules()
    const reloaded = await import('../src/lib/artworkLibrary')
    const saved = await reloaded.getArtwork(first.id)
    expect(saved?.label).toBe('Green frog')
    expect(await saved?.blob.arrayBuffer()).toEqual(await png(1).arrayBuffer())
    expect(await reloaded.listArtwork()).toHaveLength(2)
    await reloaded.deleteArtwork(first.id)
    expect(await reloaded.getArtwork(first.id)).toBeNull()
    expect((await reloaded.listArtwork()).map(asset => asset.id)).toEqual([second.id])
  })

  it('deduplicates the same image content during concurrent saves without replacing its label', async () => {
    const assets = await Promise.all(Array.from({ length: 8 }, (_, index) => saveArtwork(png(), `Label ${index}`)))
    expect(new Set(assets.map(asset => asset.id)).size).toBe(1)
    expect(await listArtwork()).toHaveLength(1)
    expect((await getArtwork(assets[0].id))?.label).toMatch(/^Label [0-7]$/)
  })

  it('rejects forged raster MIME types, active formats, empty and oversized files before writing', async () => {
    for (const blob of [new Blob(['<svg/>'], { type: 'image/png' }), new Blob(['<svg/>'], { type: 'image/svg+xml' }), new Blob([], { type: 'image/png' }), png(0, 5 * 1024 * 1024 + 1)]) {
      await expect(saveArtwork(blob, 'Invalid')).rejects.toThrow(/image|empty|5 MB|PNG/i)
    }
    await expect(saveArtwork(new Blob([await png().arrayBuffer()], { type: 'image/jpeg' }), 'Mismatched')).rejects.toThrow(/match|signature|format/i)
    expect(await listArtwork()).toEqual([])
  })

  it('accepts each allowed raster signature and makes a local data URI with the validated MIME', async () => {
    const fixtures = [
      new Blob([Uint8Array.of(255, 216, 255, 224)], { type: 'image/jpeg' }),
      new Blob(['GIF89a'], { type: 'image/gif' }),
      new Blob(['RIFF\0\0\0\0WEBP'], { type: 'image/webp' }),
      png(),
    ]
    for (const blob of fixtures) {
      const saved = await saveArtwork(blob, 'Raster')
      expect(saved.type).toBe(blob.type)
      expect(await artworkToDataUri(saved.blob)).toMatch(new RegExp(`^data:${blob.type};base64,`))
    }
  })

  it('keeps the previous assets when the 30-image count limit is exceeded', async () => {
    for (let index = 0; index < 30; index++) await saveArtwork(png(index), `Image ${index}`)
    await expect(saveArtwork(png(31), 'Extra')).rejects.toThrow(/30/)
    expect(await listArtwork()).toHaveLength(30)
    expect((await saveArtwork(png(1), 'Duplicate at capacity')).id).toBe((await saveArtwork(png(1), 'Same')).id)
  })

  it('keeps existing images when the 25 MB aggregate limit is exceeded', async () => {
    for (let index = 0; index < 5; index++) await saveArtwork(png(index, 5 * 1024 * 1024), `Large ${index}`)
    await expect(saveArtwork(png(6), 'Too much')).rejects.toThrow(/25 MB/)
    expect(await listArtwork()).toHaveLength(5)
  })

  it('reports storage quota and unavailable storage errors without overwriting saved artwork', async () => {
    const existing = await saveArtwork(png(), 'Keep me')
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Storage quota full', 'QuotaExceededError') })
    await expect(saveArtwork(png(1), 'New')).rejects.toThrow(/storage|space|quota/i)
    put.mockRestore()
    expect((await getArtwork(existing.id))?.label).toBe('Keep me')
    vi.stubGlobal('indexedDB', undefined)
    await expect(listArtwork()).rejects.toThrow(/storage|available|browser/i)
  })

  it('rejects malformed artwork identifiers before reading or deleting', async () => {
    await expect(getArtwork('../unsafe')).rejects.toThrow(/artwork/i)
    await expect(deleteArtwork('z'.repeat(64))).rejects.toThrow(/artwork/i)
  })
})
