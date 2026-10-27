'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowRight, ArrowUpRight, CircleAlert, Clock3, ExternalLink, RefreshCw, Rocket, Search, Wrench } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { filterWorkspaceActivity, readWorkspaceActivity, WORKSPACE_ACTIVITY_KEYS, type ActivityFilter, type WorkspaceActivityItem, type WorkspaceActivitySnapshot } from '@/lib/workspaceActivity'

const filters: { value: ActivityFilter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'launches', label: 'Launches' }, { value: 'trades', label: 'Trades' }, { value: 'wallets', label: 'Wallets' }, { value: 'bundles', label: 'Bundles' }, { value: 'pending', label: 'Pending' }]
const venues: Record<string, string> = { pump: 'Pump.fun', bonk: 'Bonk', 'raydium-launchlab': 'Raydium LaunchLab', 'meteora-dbc': 'Meteora DBC', 'raydium-cpmm': 'Raydium CPMM', solana: 'Solana' }
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-6)}`
const title = (item: WorkspaceActivityItem) => item.kind === 'group' ? item.description.startsWith('Group funding') ? 'Group funding' : 'Group withdrawal' : item.kind === 'bundle' ? 'Wallet bundle' : item.kind === 'wallet' ? 'Wallet operation' : item.kind === 'setup' ? 'Launch setup' : item.kind === 'launch' ? 'Token launch' : item.description.startsWith('Buy') ? 'Buy tokens' : 'Sell tokens'

function ActivityRow({ item }: { item: WorkspaceActivityItem }) {
  const Icon = item.kind === 'setup' ? Wrench : item.kind === 'launch' ? Rocket : Activity
  const isWallet = item.kind === 'wallet' || item.kind === 'group'
  const recoveryHref = item.kind === 'group' ? '/wallet' : item.kind === 'bundle' ? '/bundler' : item.kind === 'wallet' ? '/wallet-operations?view=manual' : item.kind === 'trade' ? `/manage?mint=${encodeURIComponent(item.mint)}` : '/launch'
  const workspaceHref = item.kind === 'group' ? '/wallet' : item.kind === 'bundle' ? '/bundler' : item.kind === 'wallet' ? '/wallet-operations?view=manual' : `/token/${encodeURIComponent(item.mint)}`
  return <article className="border-b border-white/[.07] py-5 last:border-0">
    <div className="flex flex-wrap items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[.025] text-accent"><Icon size={16} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-medium text-[#dceae4]">{title(item)}</h2><span className={`rounded border px-2 py-0.5 text-xs capitalize ${item.status === 'pending' || item.status === 'partial' ? 'border-amber-200/20 bg-amber-100/5 text-amber-200' : item.status === 'failed' ? 'border-red-200/20 bg-red-100/5 text-red-200' : 'border-emerald-200/20 bg-emerald-100/5 text-emerald-200'}`}>{item.status === 'pending' ? 'Awaiting confirmation' : item.status === 'partial' ? 'Partially completed' : item.status}</span></div>
        <p className="mt-2 text-sm leading-6 text-muted">{item.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"><span>{venues[item.venue] ?? 'Solana'}</span>{item.timestamp ? <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleString()}</time> : <span>Time not recorded</span>}<a className="inline-flex items-center gap-1 font-mono hover:text-accent" href={`https://solscan.io/${isWallet ? 'account' : 'token'}/${encodeURIComponent(item.mint)}`} target="_blank" rel="noreferrer" aria-label={`View ${isWallet ? 'account or mint' : 'token'} ${item.mint} on Solscan`}>{short(item.mint)}<ExternalLink size={10} aria-hidden="true" /></a></div>
      </div>
      {item.status === 'pending' ? <Link href={recoveryHref} className="text-link min-h-9">Review status<ArrowRight size={12} aria-hidden="true" /></Link> : <Link href={workspaceHref} className="text-link min-h-9">{item.kind === 'group' ? 'Open Wallets' : item.kind === 'bundle' ? 'Open Bundler' : item.kind === 'wallet' ? 'Wallet operations' : 'Open workspace'}<ArrowUpRight size={12} aria-hidden="true" /></Link>}
    </div>
    <details className="mt-3 text-xs text-muted sm:ml-12"><summary className="w-fit cursor-pointer py-1 hover:text-accent">Transaction details · {item.signatures.length}</summary><div className="mt-3 space-y-3 rounded-lg border border-white/[.07] bg-black/10 p-4"><p className="break-all leading-5"><span className="text-[#c0d0c8]">{isWallet ? 'Account or token mint' : 'Token mint'}</span><br />{item.mint}</p>{item.signatures.map((signature, index) => <a key={signature} href={`https://solscan.io/tx/${encodeURIComponent(signature)}`} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-accent"><span className="min-w-0 break-all font-mono leading-5"><span className="font-sans text-muted">Signature {index + 1}</span><br />{signature}</span><ExternalLink size={12} className="mt-1 shrink-0" aria-hidden="true" /></a>)}{item.status === 'pending' && <p className="leading-5">Submission is not confirmation. Open the original workspace to check this transaction’s status.</p>}</div></details>
  </article>
}

export default function ActivityPage() {
  const [snapshot, setSnapshot] = useState<WorkspaceActivitySnapshot>({ items: [], warnings: [] })
  const [loaded, setLoaded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [query, setQuery] = useState('')
  const refresh = useCallback(() => { setSnapshot(readWorkspaceActivity()); setLoaded(true); setUpdatedAt(new Date().toISOString()) }, [])
  useEffect(() => {
    refresh()
    const handleStorage = (event: StorageEvent) => { if (event.key === null || WORKSPACE_ACTIVITY_KEYS.some(key => key === event.key)) refresh() }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [refresh])
  const visible = useMemo(() => filterWorkspaceActivity(snapshot.items, filter, query), [snapshot.items, filter, query])
  const pending = snapshot.items.filter(item => item.status === 'pending').length

  return <><Header /><main className="workspace-main" id="workspace-content" tabIndex={-1}>
    <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE · THIS DEVICE</div><h1>Activity</h1><p>Your launch, bundle, trade and wallet records, together. Review pending operations from their original workspace.</p></div><button className="secondary-action" onClick={refresh} aria-label="Refresh saved activity"><RefreshCw size={14} aria-hidden="true" />Refresh</button></div>
    <div className="workspace-card">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-medium text-[#dceae4]">Saved operations</h2><p className="mt-2 text-sm leading-5 text-muted">Public records saved in this browser. Refresh reads local history; it does not check the chain.</p></div><div className="flex gap-5 text-xs"><span className="text-muted"><b className="mr-1 font-medium text-[#dceae4]">{snapshot.items.length}</b> records</span><span className={pending ? 'text-amber-200' : 'text-muted'}><b className="mr-1 font-medium">{pending}</b> pending</span></div></div>
      <div className="workspace-toolbar"><div className="relative"><label className="sr-only" htmlFor="activity-search">Search activity by mint, signature, venue or action</label><Search size={14} className="pointer-events-none absolute left-3 top-3 text-muted" aria-hidden="true" /><input id="activity-search" className="!pl-9" type="search" placeholder="Search mint, signature or action…" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></div><div className="filter-tabs" role="group" aria-label="Filter activity">{filters.map(option => <button key={option.value} onClick={() => setFilter(option.value)} aria-pressed={filter === option.value}>{option.label}{option.value === 'pending' && pending > 0 ? ` · ${pending}` : ''}</button>)}</div></div>
      {snapshot.warnings.length > 0 && <div role="alert" className="mb-4 rounded-lg border border-amber-200/20 bg-amber-100/5 p-4 text-xs leading-6 text-amber-100"><div className="flex items-center gap-2 font-medium"><CircleAlert size={15} aria-hidden="true" />Some saved activity could not be read</div><ul className="mt-2 list-disc space-y-1 pl-5">{snapshot.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      <div aria-live="polite" aria-busy={!loaded}>
        {!loaded ? <p className="py-12 text-center text-sm text-muted">Reading saved activity…</p> : visible.length ? <><p className="mb-1 text-sm text-muted">Showing {visible.length} of {snapshot.items.length} records</p>{visible.map(item => <ActivityRow key={item.id} item={item} />)}</> : <div className="flex flex-col items-center px-4 py-14 text-center"><span className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[.02] text-accent"><Clock3 size={21} aria-hidden="true" /></span><h2 className="text-base font-medium text-[#dceae4]">{snapshot.items.length ? 'No matching activity' : snapshot.warnings.length ? 'No readable activity' : 'Your activity starts here'}</h2><p className="mt-3 max-w-md text-sm leading-6 text-muted">{snapshot.items.length ? 'Try a different search or filter to find your saved operations.' : snapshot.warnings.length ? 'Review the warning above and preserve this browser’s data. Records from other devices do not appear here.' : 'Confirmed launches, trades and pending submissions appear here when you use OutSol on this device.'}</p>{snapshot.items.length ? <button className="secondary-action mt-5" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button> : !snapshot.warnings.length && <Link className="primary-action mt-5" href="/launch">Create a token<ArrowRight size={13} aria-hidden="true" /></Link>}</div>}
      </div>
      {updatedAt && <p className="mt-5 border-t border-white/[.07] pt-4 text-sm text-muted">Local history refreshed at <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleTimeString()}</time>. OutSol platform fee: 0 SOL, forever.</p>}
    </div>
  </main><Footer /></>
}
