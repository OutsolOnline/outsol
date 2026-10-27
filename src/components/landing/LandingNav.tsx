'use client'

import { useEffect, useRef, type MouseEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react'
import { WORKSPACE_TOOLS } from '@/lib/workspaceCatalog'
import styles from '../../../app/LandingPage.module.css'

const categories = ['Create', 'Prepare', 'Operate'] as const

function ToolLinks({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? styles.mobileTools : styles.toolsColumns}>
    {categories.map(category => <div key={category} className={styles.toolColumn}>
      <p className={styles.toolCategory}>{category}</p>
      {WORKSPACE_TOOLS.filter(tool => tool.category === category).map(tool => <Link className={styles.toolLink} href={tool.href} key={tool.id}>
        <span><span className={styles.toolName}>{tool.title}{tool.status === 'coming-soon' && <small>Soon</small>}</span>{!compact && <span className={styles.toolDescription}>{tool.description}</span>}</span><ArrowUpRight size={14} aria-hidden="true" />
      </Link>)}
    </div>)}
  </div>
}

export function LandingNav() {
  const header = useRef<HTMLElement>(null)

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) {
        header.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail => { detail.open = false })
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const openDetails = Array.from(header.current?.querySelectorAll<HTMLDetailsElement>('details[open]') || [])
      const detail = openDetails.reverse().find(item => item.contains(document.activeElement)) || openDetails[0]
      if (!detail) return
      event.preventDefault()
      detail.open = false
      detail.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const closeOnNavigation = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('a')) {
      header.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail => { detail.open = false })
    }
  }

  return <header ref={header} className={styles.header} onClick={closeOnNavigation}>
    <div className={styles.navInner}>
      <Link href="/" className={styles.brand} aria-label="OutSol home"><Image src="/brand/outsol-lockup-mint.svg" width={130} height={36} alt="OutSol" priority /></Link>
      <nav aria-label="Main navigation" className={styles.desktopNav}>
        <Link href="/launches">Launches</Link>
        <Link href="#features">Features</Link>
        <details className={styles.toolsDisclosure} onBlur={event => {
          if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
        }}>
          <summary>Tools<ChevronDown size={14} aria-hidden="true" /></summary>
          <div className={styles.toolsPopover}>
            <div className={styles.toolsPopoverHeader}><span>The OutSol toolkit</span><Link href="#tools">Explore all tools<ArrowRight size={14} /></Link></div>
            <ToolLinks />
            <div className={styles.toolsPopoverFooter}><span>One workspace. Zero OutSol platform fees.</span><Link href="/launches">Open workspace<ArrowUpRight size={14} /></Link></div>
          </div>
        </details>
        <Link href="#about">What is OutSol?</Link>
      </nav>
      <Link href="/launches" className={styles.navCta}>Open workspace<ArrowUpRight size={15} aria-hidden="true" /></Link>
      <details className={styles.mobileDisclosure}>
        <summary aria-label="Navigation menu"><Menu className={styles.menuIcon} size={21} aria-hidden="true" /><X className={styles.closeIcon} size={21} aria-hidden="true" /></summary>
        <nav className={styles.mobileNav} aria-label="Mobile navigation">
          <Link href="/launches">Launches<ArrowUpRight size={16} /></Link>
          <Link href="#features">Features<ArrowRight size={16} /></Link>
          <details className={styles.mobileToolsDisclosure}><summary>Tools<ChevronDown size={16} /></summary><ToolLinks compact /></details>
          <Link href="#about">What is OutSol?<ArrowRight size={16} /></Link>
          <Link href="#pricing">Pricing<ArrowRight size={16} /></Link>
          <Link className={styles.mobileOpenWorkspace} href="/launches">Open workspace<ArrowUpRight size={16} /></Link>
        </nav>
      </details>
    </div>
  </header>
}
