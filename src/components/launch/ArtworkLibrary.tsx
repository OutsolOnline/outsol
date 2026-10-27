'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Search, Trash2, Upload } from 'lucide-react'
import { artworkToDataUri, deleteArtwork, listArtwork, saveArtwork, type ArtworkAsset } from '@/lib/artworkLibrary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ArtworkLibraryProps { onSelect: (blob: Blob, previewDataUri: string) => void | Promise<void> }

function ArtworkPreview({ asset }: { asset: ArtworkAsset }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const localUrl = URL.createObjectURL(asset.blob)
    setUrl(localUrl); setFailed(false)
    return () => URL.revokeObjectURL(localUrl)
  }, [asset.blob])
  return <div className="aspect-square rounded-xl overflow-hidden border border-border bg-surface flex items-center justify-center">
    {url && !failed ? <img src={url} alt={asset.label} className="w-full h-full object-cover" onError={() => setFailed(true)} /> : <span className="text-sm text-muted p-4 text-center">{failed ? 'Image preview unavailable' : 'Loading preview…'}</span>}
  </div>
}

export function ArtworkLibrary({ onSelect }: ArtworkLibraryProps) {
  const id = useId()
  const [assets, setAssets] = useState<ArtworkAsset[]>([])
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const operation = useRef(false)
  const refreshNumber = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++refreshNumber.current
    try {
      const saved = await listArtwork()
      if (alive.current && request === refreshNumber.current) { setAssets(saved); setLoading(false) }
    } catch (failure) {
      if (alive.current && request === refreshNumber.current) { setError(failure instanceof Error ? failure.message : 'Your artwork library could not be loaded.'); setLoading(false) }
    }
  }, [])

  useEffect(() => {
    alive.current = true
    const update = () => { void refresh() }
    update()
    window.addEventListener('vanity-artwork-changed', update)
    window.addEventListener('focus', update)
    return () => { alive.current = false; window.removeEventListener('vanity-artwork-changed', update); window.removeEventListener('focus', update) }
  }, [refresh])

  const run = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'The artwork action did not complete.') }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  const save = () => run(async () => {
    if (!file) return
    const saved = await saveArtwork(file, label)
    if (!alive.current) return
    setFile(null); setLabel(''); if (inputRef.current) inputRef.current.value = ''
    setNotice(`“${saved.label}” is saved on this device.`)
    await refresh()
  })
  const use = (asset: ArtworkAsset) => run(async () => {
    const preview = await artworkToDataUri(asset.blob)
    if (!alive.current) return
    await onSelect(asset.blob, preview)
    if (alive.current) setNotice(`“${asset.label}” is attached to your design.`)
  })
  const remove = (asset: ArtworkAsset) => run(async () => {
    await deleteArtwork(asset.id)
    if (!alive.current) return
    setPendingDelete(null); setNotice(`“${asset.label}” was deleted from this device.`)
    await refresh()
  })
  const filtered = assets.filter(asset => asset.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const sizeMb = assets.reduce((total, asset) => total + asset.size, 0) / (1024 * 1024)

  return <section aria-label="Local artwork library" className="space-y-6 text-sm">
    <div><h3 className="text-lg font-medium">Artwork library</h3><p className="text-sm text-muted mt-2 leading-relaxed">Save images here and reuse them in your token designs. Images stay in this browser until you delete them or clear site data.</p><p className="text-sm text-muted mt-2">{assets.length} of 30 images · {sizeMb.toFixed(1)} of 25 MB used · PNG, JPEG, WebP or GIF up to 5 MB each</p></div>
    <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
      <div><label className="block text-sm mb-2" htmlFor={`${id}-file`}>Add an image</label><input ref={inputRef} id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} className="block text-sm text-muted max-w-full file:mr-3 file:rounded-lg file:border file:border-border file:bg-transparent file:text-foreground file:px-3 file:py-2 file:text-sm" onChange={event => { const next = event.target.files?.[0] || null; setFile(next); setLabel(next?.name.replace(/\.[^.]+$/, '').slice(0, 80) || ''); setError(''); setNotice('') }} /></div>
      {file && <div className="flex flex-col sm:flex-row gap-3 sm:items-end"><div className="flex-1"><label className="block text-sm mb-2" htmlFor={`${id}-label`}>Image label</label><Input id={`${id}-label`} value={label} maxLength={80} disabled={busy} onChange={event => setLabel(event.target.value)} placeholder="A name you can search for" /></div><Button variant="secondary" disabled={busy} onClick={save}><Upload size={15} className="mr-2" />Save to library</Button></div>}
    </div>
    <div className="relative"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><label className="sr-only" htmlFor={`${id}-search`}>Search artwork labels</label><Input id={`${id}-search`} className="!pl-10" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search saved artwork…" /></div>
    {error && <div role="alert" className="notice notice-error text-sm">{error}<button className="underline ml-3" disabled={busy} onClick={() => { setError(''); setLoading(true); void refresh() }}>Try again</button></div>}
    {notice && <p role="status" className="notice text-sm"><Check size={15} className="inline mr-2" />{notice}</p>}
    {loading ? <p role="status" className="text-sm text-muted flex gap-2 items-center"><Loader2 size={16} className="animate-spin" />Loading your local artwork…</p> : filtered.length ? <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{filtered.map(asset => <article key={asset.id} className="rounded-xl border border-border p-3 space-y-3">
      <ArtworkPreview asset={asset} /><div><h4 className="text-sm font-medium truncate" title={asset.label}>{asset.label}</h4><p className="text-sm text-muted mt-1">{asset.type.replace('image/', '').toUpperCase()} · {(asset.size / 1024).toFixed(0)} KB</p></div>
      {pendingDelete === asset.id ? <div className="space-y-3"><p className="text-sm text-muted">Delete this local image? Drafts that use it will need another image.</p><div className="flex flex-wrap gap-3"><Button variant="secondary" size="sm" disabled={busy} onClick={() => remove(asset)}>Delete image</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setPendingDelete(null)}>Cancel</Button></div></div> : <div className="flex gap-2"><Button className="flex-1" variant="secondary" size="sm" disabled={busy} onClick={() => use(asset)}>Use image</Button><Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete ${asset.label}`} onClick={() => setPendingDelete(asset.id)}><Trash2 size={15} /></Button></div>}
    </article>)}</div> : <div className="rounded-xl border border-dashed border-border py-10 px-4 text-center"><ImagePlus size={28} className="text-accent mx-auto mb-3" /><h4 className="text-base font-medium">{query ? 'No matching artwork' : 'Keep your next image ready'}</h4><p className="text-sm text-muted mt-2">{query ? 'Try another image label.' : 'Add an image above, then choose Use image to attach it to your design.'}</p></div>}
  </section>
}
