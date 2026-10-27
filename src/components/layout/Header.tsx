'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Activity, FolderClosed, Grid2X2, Layers3, Menu, Rocket, Wallet, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CommandPalette } from './CommandPalette'
import { NetworkStatus } from './NetworkStatus'
import { Brand, OUTSOL_ARC_PATH } from './Brand'
import { WhatIsOutSol } from './WhatIsVanity'

const navigation = [
  { name: 'Launches', href: '/launches', icon: Rocket },
  { name: 'Bundles', href: '/bundler', icon: Layers3 },
  { name: 'Wallets', href: '/wallet-operations', icon: Wallet },
  { name: 'Library', href: '/library', icon: FolderClosed },
  { name: 'Activity', href: '/activity', icon: Activity },
  { name: 'Tools', href: '/tools', icon: Grid2X2 },
]
const pageNames: Record<string, string> = { '/': 'OutSol', '/launches': 'Launches', '/launch': 'New launch', '/wallet-operations': 'Wallets', '/wallet': 'Wallets', '/library': 'Library', '/drafts': 'Saved designs', '/artwork': 'Artwork', '/activity': 'Activity', '/tools': 'Tools', '/planner': 'Launch planner', '/rehearse': 'Launch rehearsal', '/vanity': 'Vanity addresses', '/inspect': 'Wallet inspector', '/manage': 'Manage token', '/bundler': 'Wallet bundles', '/projects': 'Token workspaces', '/extension': 'Browser extension', '/x': 'Launch from X', '/tracker': 'X tracker', '/sniper': 'Launch discovery', '/automations': 'Trading sessions', '/multi-launch': 'Multi-launch' }

export function Header() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const currentPage = pageNames[pathname] ?? (pathname.startsWith('/token/') ? 'Token workspace' : pathname.startsWith('/verify/') ? 'Token verification' : 'OutSol')
  const activeHref = ['/wallet', '/wallet-operations'].includes(pathname) ? '/wallet-operations' : ['/library', '/drafts', '/artwork'].includes(pathname) ? '/library' : pathname === '/activity' ? '/activity' : pathname === '/bundler' ? '/bundler' : ['/tools', '/vanity', '/inspect', '/manage', '/manual', '/extension', '/x', '/tracker', '/sniper', '/automations', '/multi-launch'].includes(pathname) ? '/tools' : '/launches'

  useEffect(() => setMounted(true), [])
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus() } }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const links = navigation.map(item => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={cn('sidebar-link', activeHref === item.href && 'active')} aria-current={pathname === item.href ? 'page' : undefined}><item.icon size={18} strokeWidth={1.65} aria-hidden="true" /><span>{item.name}</span>{activeHref === item.href && <svg className="sidebar-current-arc" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d={OUTSOL_ARC_PATH} /></svg>}</Link>)

  return <header className="app-header"><a className="skip-link" href="#workspace-content">Skip to workspace</a><aside className="workspace-sidebar" aria-label="OutSol workspace"><Brand /><nav className="sidebar-nav" aria-label="Main navigation">{links}</nav></aside><div className="header-inner"><div className="header-location"><span className="header-page-context">{currentPage}</span></div><div className="mobile-brand"><Brand /></div><div className="header-actions"><CommandPalette /><WhatIsOutSol /><NetworkStatus />{mounted ? <WalletMultiButton /> : <div className="wallet-placeholder" aria-hidden="true" />}<button ref={menuButtonRef} className="mobile-menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="mobile-workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button></div></div>{menuOpen && <nav className="mobile-nav" id="mobile-workspace-navigation" aria-label="Mobile navigation">{links}</nav>}</header>
}
