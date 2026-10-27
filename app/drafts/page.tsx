'use client'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Copy, Download, FolderOpen, Plus, Search, Trash2, Upload } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { createLaunchDraft, loadLaunchDrafts, removeLaunchDraft, restoreLaunchDraft, saveLaunchDraft, type LaunchDraft } from '@/lib/launchDrafts'
import { useLaunchStore } from '@/stores/launchStore'
import { readPending } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { artworkToDataUri, getArtwork } from '@/lib/artworkLibrary'

function DraftArtwork({ draft }: { draft: LaunchDraft }) {
  const [url, setUrl] = useState(''), [missing, setMissing] = useState(false)
  useEffect(() => {
    let active = true, localUrl = ''
    setUrl(''); setMissing(false)
    if (draft.artworkId) void getArtwork(draft.artworkId).then(asset => {
      if (!active) return
      if (asset) { localUrl = URL.createObjectURL(asset.blob); setUrl(localUrl) } else setMissing(true)
    }).catch(() => { if (active) setMissing(true) })
    return () => { active = false; if (localUrl) URL.revokeObjectURL(localUrl) }
  }, [draft.artworkId])
  return <div className="flex items-center gap-3"><div className="w-12 h-12 overflow-hidden bg-accent/10 border border-accent/20 text-accent rounded-xl flex items-center justify-center text-lg font-semibold">{url ? <img src={url} alt={`${draft.name} artwork`} className="w-full h-full object-cover" onError={() => setMissing(true)} /> : draft.metadata.symbol.slice(0,2) || 'V'}</div>{missing && <span className="text-xs text-muted">Artwork unavailable</span>}</div>
}

export default function DraftsPage() {
  const router = useRouter()
  const [drafts, setDrafts] = useState<LaunchDraft[]>([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [removed, setRemoved] = useState<LaunchDraft | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const alive = useRef(true), openingRef = useRef(false)
  const refresh = () => { try { setDrafts(loadLaunchDrafts()) } catch (e) { setError(e instanceof Error ? e.message : 'Drafts are unavailable.') } }
  useEffect(() => { alive.current = true; refresh(); window.addEventListener('storage', refresh); window.addEventListener('vanity-drafts-changed', refresh); return () => { alive.current = false; window.removeEventListener('storage', refresh); window.removeEventListener('vanity-drafts-changed', refresh) } }, [])
  const action = (run: () => void) => { setError(''); setNotice(''); setRemoved(null); try { run(); refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Draft action did not complete.') } }
  const open = async (draft: LaunchDraft) => {
    if (openingRef.current) return
    openingRef.current = true; setOpening(draft.id); setError(''); setNotice(''); setRemoved(null)
    try {
      assertNoPendingWalletOperation(); if (readPending() || readTradePending()) throw new Error('Check the pending operation in Activity before opening another design.')
      const restored = restoreLaunchDraft(draft)
      let image: Blob | null = null, preview: string | null = null, warning = ''
      if (restored.artworkId) {
        try {
          const asset = await getArtwork(restored.artworkId)
          if (asset) { image = asset.blob; preview = await artworkToDataUri(asset.blob) }
          else warning = 'This draft’s local artwork is missing. Choose another image from your artwork library or upload one before continuing.'
        } catch (failure) { warning = `This draft’s artwork could not be restored. ${failure instanceof Error ? failure.message : 'Choose another image before continuing.'}` }
      } else if (!restored.metadataUri) warning = 'This draft has no saved artwork. Add an image or choose one from your artwork library before continuing.'
      if (!alive.current) return
      assertNoPendingWalletOperation(); if (readPending() || readTradePending()) throw new Error('Check the pending operation in Activity before opening another design.')
      const store = useLaunchStore.getState()
      store.reset(); store.setMetadata(restored.metadata); store.setMetadataUri(restored.metadataUri); store.setConfig(restored.config);store.setBundleSettings(restored.bundleSettings); store.setImageFile(image); store.setImagePreview(preview); store.setStep('metadata'); store.setError(warning || null)
      router.push('/launch')
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'The design could not be opened.') }
    finally { openingRef.current = false; if (alive.current) setOpening(null) }
  }
  const download = (draft: LaunchDraft) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `outsol-draft-${draft.id.slice(0,8)}.json`; link.click(); URL.revokeObjectURL(url)
  }
  const importFile = async (file?: File) => {
    if (!file) return
    setError(''); setNotice('')
    try {
      if (file.size > 16000) throw new Error('Choose an OutSol public draft JSON under 16 KB.')
      const value = JSON.parse(await file.text())
      if (value?.version !== 1) throw new Error('Choose an OutSol public draft JSON export.')
      const draft = createLaunchDraft(value)
      saveLaunchDraft(draft); refresh(); setNotice('Public draft imported. Artwork is stored separately on its original device; open the draft to check whether it is available here.')
    } catch (e) { setError(e instanceof Error ? e.message : 'The file is not a valid public draft.') }
  }
  const filtered = drafts.filter(draft => `${draft.name} ${draft.metadata.name} ${draft.metadata.symbol}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="min-h-screen flex flex-col"><Header /><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
    <div className="page-heading"><div className="eyebrow">PREPARE ONCE. MAKE IT YOURS.</div><h1>Your ideas, ready to resume.</h1><p>Token designs and settings saved on this device, with artwork kept in your local image library. Exported drafts contain public details and image references.</p></div>
    <div className="workspace-toolbar"><div className="relative flex-1"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" /><label className="sr-only" htmlFor="draft-search">Search saved drafts</label><input id="draft-search" className="input-pill !pl-11" placeholder="Search drafts by name or symbol…" value={query} onChange={e => setQuery(e.target.value)} /></div><label className="secondary-action cursor-pointer"><Upload size={15} />Import draft<input type="file" accept="application/json,.json" className="sr-only" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = '' }} /></label><Link href="/launch?new=1" className="primary-action"><Plus size={16} />Create a design</Link></div>
    {error && <p role="alert" className="notice notice-error my-5">{error}</p>}{notice && <p role="status" className="notice my-5">{notice}{removed && <button className="underline ml-3 text-accent" onClick={() => { const draft = removed; action(() => { saveLaunchDraft(draft); setNotice('Draft restored.') }) }}>Undo</button>}</p>}
    {filtered.length ? <div className="tool-grid">{filtered.map(draft => <article className="workspace-card !p-6" key={draft.id}><div className="flex items-center justify-between gap-3 mb-5"><DraftArtwork draft={draft} /><span className="text-xs uppercase tracking-widest text-muted">{draft.config.mode === 'standard' ? draft.config.venue : draft.config.mode}</span></div><h2 className="text-lg font-medium truncate">{draft.name}</h2><p className="text-sm text-muted mt-1">{draft.metadata.symbol ? `$${draft.metadata.symbol}` : 'No symbol yet'} · {new Date(draft.updatedAt).toLocaleDateString()}</p><p className="text-sm text-muted leading-relaxed mt-4 line-clamp-2 min-h-10">{draft.metadata.description || 'A token design waiting for its story.'}</p><button className="primary-action w-full mt-5 !justify-between" disabled={opening !== null} onClick={() => { void open(draft) }}>{opening === draft.id ? 'Opening design…' : 'Open design'}<ArrowRight size={15} /></button><div className="flex items-center gap-1 mt-3 text-muted"><button className="text-sm p-2 hover:text-foreground inline-flex gap-1.5 items-center" disabled={opening !== null} onClick={() => action(() => { saveLaunchDraft(createLaunchDraft({ ...draft, name: `${draft.name.slice(0,65)} copy` })); setNotice('Draft duplicated.') })}><Copy size={13} />Duplicate</button><button className="p-2 hover:text-foreground" aria-label={`Export ${draft.name}`} onClick={() => download(draft)}><Download size={14} /></button><button className="p-2 ml-auto hover:text-red-300" disabled={opening !== null} aria-label={`Remove ${draft.name}`} onClick={() => action(() => { removeLaunchDraft(draft.id); setRemoved(draft); setNotice('Draft removed from this device.') })}><Trash2 size={14} /></button></div></article>)}</div> : <div className="workspace-card text-center py-16"><FolderOpen size={32} className="text-accent/60 mx-auto mb-5" /><h2 className="text-xl font-medium">{query ? 'No matching drafts.' : 'Your next launch starts with an idea.'}</h2><p className="text-sm text-muted max-w-md mx-auto mt-3 mb-7 leading-relaxed">{query ? 'Try another name or symbol.' : 'Create a token design and choose Save draft in the builder. Come back to it whenever you are ready.'}</p><Link href="/launch?new=1" className="primary-action">Open the token builder<ArrowRight size={16} /></Link></div>}
    <p className="field-help mt-6">Opening a draft replaces the current unsaved design. Artwork saved on this device is restored automatically. Images and keys are never included in a draft JSON export. <Link href="/artwork" className="text-accent underline">Browse artwork</Link></p>
  </main><Footer /></div>
}
