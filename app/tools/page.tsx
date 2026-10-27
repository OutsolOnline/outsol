'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Search, X } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { ToolIcon } from '@/components/workspace/ToolIcon'
import { searchWorkspaceTools } from '@/lib/workspaceCatalog'

export default function ToolsPage() {
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All')
  const tools = searchWorkspaceTools(query, category)
  return <div className="min-h-screen flex flex-col"><Header /><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
    <div className="page-heading"><div className="eyebrow">YOUR SOLANA TOOLKIT</div><h1>One workspace. Every next move.</h1><p>From your first token design to the wallets and trades that follow. Zero OutSol platform fees.</p></div>
    <div className="workspace-toolbar"><div className="relative flex-1"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" /><label className="sr-only" htmlFor="tool-search">Search all tools</label><input id="tool-search" className="input-pill !pl-11 !pr-10" placeholder="Search tools, venues, wallets…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="absolute right-4 top-1/2 -translate-y-1/2 text-muted" aria-label="Clear tool search" onClick={() => setQuery('')}><X size={15} /></button>}</div><div className="filter-tabs" aria-label="Filter tools">{['All','Create','Operate','Prepare'].map(item => <button key={item} className={category === item ? 'active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
    <p className="text-sm text-muted mb-5" aria-live="polite">{tools.length} {tools.length === 1 ? 'tool' : 'tools'} in your workspace</p>
    <div className="tool-grid">{tools.map(tool => <Link href={tool.href} key={tool.id} className="tool-card group"><div className="flex items-center justify-between"><span className="mode-icon"><ToolIcon name={tool.icon} /></span><ArrowUpRight size={17} className="text-muted group-hover:text-accent transition-colors" /></div><span className="eyebrow mt-6 block">{tool.status==='coming-soon'?'Coming soon':tool.category}</span><h2 className="text-lg font-medium mt-2 mb-2">{tool.title}</h2><p className="text-sm leading-relaxed text-muted">{tool.description}</p><span className="mt-6 inline-block text-xs text-accent">{tool.status==='coming-soon'?'See what’s planned':`Open ${tool.title.toLowerCase()}`} →</span></Link>)}</div>
    {!tools.length && <div className="workspace-card text-center py-16"><Search className="mx-auto text-muted mb-4" size={28} /><h2 className="text-lg">No tools match “{query}”</h2><p className="text-sm text-muted mt-2 mb-6">Try a venue name, wallet, liquidity or metadata.</p><button className="secondary-action" onClick={() => { setQuery(''); setCategory('All') }}>Reset filters</button></div>}
    <div className="notice mt-7 text-sm leading-relaxed">OutSol adds no launch fee, trading cut or subscription. Network fees, account rent and Pump.fun charges remain separate and appear before signing.</div>
  </main><Footer /></div>
}
