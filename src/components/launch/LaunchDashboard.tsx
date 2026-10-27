'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, ArrowUpRight, FileText, FlaskConical, Plus, Search, X } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { BrandMark } from '@/components/layout/Brand'
import { WhatIsOutSol } from '@/components/layout/WhatIsVanity'
import { loadLaunchDrafts } from '@/lib/launchDrafts'
import { readTokenProjects } from '@/lib/tokenProjects'
import { readWorkspaceActivity } from '@/lib/workspaceActivity'
import { restoreRehearsalSession } from '@/lib/rehearsalSession'
import { getArtwork } from '@/lib/artworkLibrary'
import { prepareLaunchLinkNavigation } from '@/lib/launchNavigation'
import { useLaunchStore } from '@/stores/launchStore'

type LaunchKind = 'design' | 'rehearsal' | 'token' | 'pending'
interface LaunchRow { id: string; kind: LaunchKind; name: string; symbol: string; stage: string; updatedAt: string; href: string; action: string; artworkId?: string; address?: string; current?: boolean; attention?: boolean }
type LaunchFilter = 'all' | 'design' | 'rehearsal' | 'token'
const filters: { id: LaunchFilter; label: string }[] = [{ id: 'all', label: 'All launches' }, { id: 'design', label: 'Designs' }, { id: 'rehearsal', label: 'Rehearsals' }, { id: 'token', label: 'Tokens' }]

function readLaunches(): { rows: LaunchRow[]; warnings: string[] } {
  const rows: LaunchRow[] = [], warnings: string[] = []
  const activity = readWorkspaceActivity()
  warnings.push(...activity.warnings)
  try {
    const active = localStorage.getItem('vanity-active-design-v1')
    for (const draft of loadLaunchDrafts()) rows.push({ id: `design:${draft.id}`, kind: 'design', name: draft.metadata.name || draft.name, symbol: draft.metadata.symbol, stage: 'Design', updatedAt: draft.updatedAt, href: `/launch?draft=${encodeURIComponent(draft.id)}`, action: 'Continue design', artworkId: draft.artworkId, current: active === draft.id })
  } catch (error) { warnings.push(error instanceof Error ? error.message : 'Saved designs could not be read.') }
  const confirmed = activity.items.filter(item => item.kind === 'launch' && item.status === 'confirmed')
  const pending = activity.items.filter(item => (item.kind === 'launch' || item.kind === 'setup') && item.status === 'pending')
  const known = new Set<string>()
  for (const item of pending) {
    if (typeof item.timestamp !== 'string') continue
    known.add(item.mint)
    rows.push({ id: item.id, kind: 'pending', name: item.kind === 'setup' ? 'Launch setup' : 'Pending launch', symbol: '', stage: 'Awaiting confirmation', updatedAt: item.timestamp, href: '/launch', action: 'Review launch', address: item.mint, attention: true })
  }
  try {
    const confirmedMints = new Set(confirmed.map(item => item.mint))
    for (const project of readTokenProjects()) {
      if (known.has(project.mint)) continue
      known.add(project.mint)
      rows.push({ id: `token:${project.mint}`, kind: 'token', name: project.name || 'Token workspace', symbol: project.symbol, stage: confirmedMints.has(project.mint) ? 'Launched' : 'Workspace', updatedAt: project.updatedAt, href: `/token/${project.mint}`, action: 'Open workspace', address: project.mint })
    }
  } catch (error) { warnings.push(error instanceof Error ? error.message : 'Token workspaces could not be read.') }
  for (const item of confirmed) {
    if (typeof item.timestamp !== 'string') continue
    if (known.has(item.mint)) continue
    known.add(item.mint)
    rows.push({ id: item.id, kind: 'token', name: 'Launched token', symbol: '', stage: 'Launched', updatedAt: item.timestamp, href: `/token/${item.mint}`, action: 'Open workspace', address: item.mint })
  }
  try {
    const raw = localStorage.getItem('vanity-rehearsal-v1')
    if (raw) {
      const { input, job } = restoreRehearsalSession(raw)
      const stale = ['queued', 'running'].includes(job.status) && Date.parse(job.expiresAt) < Date.now()
      const stage = stale ? 'Review required' : job.status === 'succeeded' ? 'Rehearsed' : job.status === 'running' || job.status === 'queued' ? 'Rehearsing' : job.status === 'failed' ? 'Needs review' : 'Cancelled'
      rows.push({ id: `rehearsal:${job.id}`, kind: 'rehearsal', name: input.name || 'Launch rehearsal', symbol: input.symbol, stage, updatedAt: job.result?.completedAt || job.createdAt, href: '/rehearse', action: 'Review rehearsal', attention: stale || job.status === 'failed' })
    }
  } catch { warnings.push('The saved rehearsal could not be read. Open Rehearse launch from Tools to check it.') }
  rows.sort((a, b) => Number(!!b.attention) - Number(!!a.attention) || Number(!!b.current) - Number(!!a.current) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return { rows, warnings: [...new Set(warnings)] }
}

function LaunchArtwork({ artworkId, symbol }: { artworkId?: string; symbol: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true, objectUrl: string | undefined
    setUrl(null)
    if (artworkId) void getArtwork(artworkId).then(artwork => { if (active && artwork) { objectUrl = URL.createObjectURL(artwork.blob); setUrl(objectUrl) } }).catch(() => { /* The design remains usable without a local thumbnail. */ })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [artworkId])
  return <span className="launch-token-art">{url ? <Image src={url} width={44} height={44} alt="" unoptimized /> : symbol ? symbol.slice(0, 2).toUpperCase() : <BrandMark />}</span>
}

export function LaunchDashboard() {
  const [rows, setRows] = useState<LaunchRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LaunchFilter>('all')
  const [navigationError, setNavigationError] = useState('')
  useEffect(() => {
    const refresh = () => { const snapshot = readLaunches(); setRows(snapshot.rows); setWarnings(snapshot.warnings); setReady(true) }
    refresh()
    const events = ['storage', 'focus', 'vanity-drafts-changed', 'vanity-projects-changed', 'vanity-artwork-changed']
    events.forEach(event => window.addEventListener(event, refresh))
    return () => events.forEach(event => window.removeEventListener(event, refresh))
  }, [])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visible = rows.filter(row => (filter === 'all' || (filter === 'token' ? row.kind === 'token' || row.kind === 'pending' : row.kind === filter)) && words.every(word => `${row.name} ${row.symbol} ${row.stage} ${row.address || ''}`.toLowerCase().includes(word)))
  const prepareNewLaunch = (event: MouseEvent<HTMLAnchorElement>) => {
    setNavigationError('')
    if (!prepareLaunchLinkNavigation(event, '/launch?new=1')) setNavigationError(useLaunchStore.getState().error || 'Save your current design before starting another.')
  }

  return <div className="min-h-screen flex flex-col"><Header /><main className="dashboard-main launches-main" id="workspace-content" tabIndex={-1}>
    <div className="page-heading launches-heading"><div><h1>Launches</h1><p>Prepare, rehearse and manage your tokens.</p></div><div className="launches-heading-action">{!ready ? <span className="launch-skeleton launch-action-skeleton" aria-hidden="true" /> : rows.length > 0 ? <Link href="/launch?new=1" onClick={prepareNewLaunch} className="primary-action"><Plus size={17} aria-hidden="true" />New launch</Link> : null}</div></div>
    {warnings.length > 0 && <div className="notice notice-error launch-storage-warning" role="status">{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    {navigationError && <p className="notice notice-error launch-storage-warning" role="alert">{navigationError}</p>}
    {(!ready || rows.length > 0) && <div className="launches-toolbar"><div className="filter-tabs" aria-label="Filter launches">{filters.map(item => <button key={item.id} onClick={() => setFilter(item.id)} aria-pressed={filter === item.id}>{item.label}{ready && <span>{item.id === 'all' ? rows.length : rows.filter(row => item.id === 'token' ? row.kind === 'token' || row.kind === 'pending' : row.kind === item.id).length}</span>}</button>)}</div><div className="launch-search"><Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor="launches-search">Search launches</label><input id="launches-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search launches" />{query && <button aria-label="Clear launch search" onClick={() => setQuery('')}><X size={14} /></button>}</div></div>}
    <section className="launches-surface" aria-label="Your launches" aria-busy={!ready}>{!ready ? <div className="launches-loading" role="status"><span className="sr-only">Loading your saved launches.</span><div className="launch-table-head" aria-hidden="true"><span>Token</span><span>Stage</span><span>Updated</span><span /></div>{[0, 1, 2].map(index => <div className="launch-work-row launch-loading-row" key={index} aria-hidden="true"><div className="launch-token-cell"><span className="launch-skeleton launch-art-skeleton"><BrandMark /></span><span className="launch-skeleton-copy"><span className="launch-skeleton" /><span className="launch-skeleton" /></span></div><span className="launch-skeleton launch-stage-skeleton" /><span className="launch-skeleton launch-date-skeleton" /><span className="launch-skeleton launch-link-skeleton" /></div>)}</div> : rows.length === 0 ? <div className="launches-empty"><BrandMark className="launch-empty-mark" /><h2>{warnings.length ? 'Saved work is unavailable.' : 'No launches yet.'}</h2><p>{warnings.length ? 'Preserve this browser’s data and check your Library or Activity before starting again.' : 'Start a Pump.fun design. Your saved designs, rehearsals and tokens will stay together here.'}</p><div className="launch-empty-actions">{warnings.length ? <Link href="/library" className="primary-action">Open Library<ArrowRight size={16} aria-hidden="true" /></Link> : <Link href="/launch?new=1" onClick={prepareNewLaunch} className="primary-action">Create your first token<ArrowRight size={16} aria-hidden="true" /></Link>}<WhatIsOutSol variant="secondary" /></div></div> : visible.length === 0 ? <div className="launches-empty launch-search-empty"><Search size={28} strokeWidth={1.5} aria-hidden="true" /><h2>No matching launches.</h2><p>Try a token name, symbol or address, or choose a different stage.</p><button className="secondary-action" onClick={() => { setQuery(''); setFilter('all') }}>Reset filters</button></div> : <><div className="launch-table-head"><span>Token</span><span>Stage</span><span>Updated</span><span className="sr-only">Next action</span></div><div className="launch-rows">{visible.map(row => <article className={`launch-work-row${row.current ? ' launch-work-current' : ''}`} key={row.id}><div className="launch-token-cell"><LaunchArtwork artworkId={row.artworkId} symbol={row.symbol} /><div className="launch-token-copy"><Link href={row.href} className="launch-token-name">{row.name}</Link><div className="launch-token-detail">{row.symbol && <span>{row.symbol}</span>}{row.current ? <span>Current design</span> : row.kind === 'rehearsal' ? <span><FlaskConical size={12} aria-hidden="true" />Local rehearsal</span> : row.address ? <span className="launch-token-address">{row.address.slice(0, 6)}…{row.address.slice(-6)}</span> : <span><FileText size={12} aria-hidden="true" />Saved design</span>}</div></div></div><div className={`launch-stage${row.attention ? ' launch-stage-attention' : ''}`}><span className="live-dot" aria-hidden="true" />{row.stage}</div><time className="launch-row-updated" dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}<span>{new Date(row.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></time><Link href={row.href} className="launch-row-action">{row.action}<ArrowUpRight size={15} aria-hidden="true" /></Link></article>)}</div></>}</section>
    {ready && rows.length > 0 && <p className="launches-local-note">Saved work on this device. Confirmed token facts are read again when you open a workspace.</p>}
  </main><Footer /></div>
}
