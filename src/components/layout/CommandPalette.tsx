'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpRight, Command, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { searchWorkspaceTools } from '@/lib/workspaceCatalog'
import { prepareLaunchLinkNavigation } from '@/lib/launchNavigation'
import { useLaunchStore } from '@/stores/launchStore'

const workspacePages = [
  { id: 'dashboard', title: 'Launches', description: 'Open your projects and recent launches.', href: '/launches', category: 'Workspace', tags: ['home', 'overview'] },
  { id: 'tools', title: 'All tools', description: 'Browse the complete workspace toolkit.', href: '/tools', category: 'Workspace', tags: ['directory', 'browse'] },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [appleShortcut,setAppleShortcut]=useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(()=>setAppleShortcut(/Mac|iPhone|iPad/.test(navigator.platform)),[])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return
      event.preventDefault()
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setNavigationError('')
      setQuery('')
      setOpen(current => !current)
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = [...workspacePages.filter(page => words.every(word => [page.title, page.description, ...page.tags].join(' ').toLowerCase().includes(word))), ...searchWorkspaceTools(query)]
  const changeOpen = (next: boolean) => {
    setOpen(next)
    setNavigationError('')
    if (!next) setQuery('')
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger className="command-trigger" onClick={() => { returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}><Search size={15} aria-hidden="true" /><span>Search tools…</span><kbd>{appleShortcut?<Command size={11} aria-hidden="true" />:'Ctrl'} K</kbd><span className="sr-only">Search workspace tools. Keyboard shortcut Control or Command K.</span></DialogTrigger>
    <DialogContent className="command-dialog" onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }} onCloseAutoFocus={event => { if (returnFocusRef.current?.isConnected) { event.preventDefault(); returnFocusRef.current.focus() } }}>
      <DialogTitle className="sr-only">Search your workspace</DialogTitle>
      <DialogDescription className="sr-only">Find launch routes, token tools and saved drafts. Use the arrow keys to browse results, Enter to open, and Escape to close.</DialogDescription>
      <div className="command-input-wrap"><Search size={21} aria-hidden="true" /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); resultsRef.current?.querySelector<HTMLAnchorElement>('a')?.focus() } }} aria-label="Search tools" placeholder="What would you like to do?" autoComplete="off" spellCheck={false} /></div>
      <div className="command-result-heading"><span>{query.trim() ? 'SEARCH RESULTS' : 'EXPLORE YOUR WORKSPACE'}</span><span aria-live="polite">{results.length} {results.length === 1 ? 'tool' : 'tools'}</span></div>
      {navigationError && <p role="alert" className="notice notice-error mx-6 mb-3">{navigationError}</p>}
      <div className="command-results" ref={resultsRef} onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const links = Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
        const index = links.indexOf(document.activeElement as HTMLAnchorElement)
        if (event.key === 'ArrowUp' && index <= 0) searchRef.current?.focus()
        else links[(index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus()
      }}>
        {results.length ? results.map(tool => <Link href={tool.href} key={tool.id} className="command-result" onClick={event => { if (!prepareLaunchLinkNavigation(event, tool.href)) { setNavigationError(useLaunchStore.getState().error || 'Save your current design before starting another.'); return } changeOpen(false) }}><span className="command-result-icon"><ArrowUpRight size={17} aria-hidden="true" /></span><span><b>{tool.title}</b><small>{tool.description}</small></span><span className="command-category">{tool.category}</span><ArrowUpRight size={15} aria-hidden="true" /></Link>) : <div className="command-empty"><Search size={26} aria-hidden="true" /><b>No tools found</b><p>Try “launch”, “wallet”, “vanity” or “draft”.</p><button onClick={() => { setQuery(''); searchRef.current?.focus() }}>Clear search</button></div>}
      </div>
      <div className="command-footer"><span><ArrowUp size={12} aria-hidden="true" /><ArrowDown size={12} aria-hidden="true" /> to navigate <kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>
    </DialogContent>
  </Dialog>
}
