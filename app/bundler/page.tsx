'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import styles from '@/components/bundler/BundlerWorkspace.module.css'

const BundlerContent = dynamic(
  () => import('@/components/bundler/BundlerContent').then(mod => mod.BundlerContent),
  { ssr: false, loading: () => <BundlerLoading /> }
)

function BundlerLoading() {
  return <div role="status" aria-live="polite" className={styles.loading}>
    <p>Opening your bundle workspace…</p>
    <div className={styles.loadingWallets} aria-hidden="true"/><div className={styles.loadingGrid} aria-hidden="true"><div/><div/></div>
  </div>
}

export default function BundlerPage() {
  return <div className="min-h-screen flex flex-col bg-background">
    <Header />
    <main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
      <div className={styles.pageContent}>
        <div className="page-heading flex flex-wrap items-start justify-between gap-4">
          <div><h1>Bundle launch</h1><p>Create a Pump.fun token with coordinated wallet buys. Prepare your wallets, set the execution plan and review costs before launching.</p></div>
          <Link href="/launch" className={styles.standardLink}>Open standard builder<ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
        <details className={styles.pageGuide}>
          <summary>How does a bundle launch work?</summary>
          <div className={styles.guideBody}>
            <div><h2>1. Prepare and back up</h2><p>The deployer creates the token. Sniper wallets buy it; each receiver holds that sniper’s purchased tokens. Download private backups before adding funds.</p></div>
            <div><h2>2. Fund and review</h2><p>Fund the deployer and sniper addresses yourself. Add token details, choose atomic or after-confirmation execution, then review buy budgets and estimated costs.</p></div>
            <div><h2>3. Launch and manage</h2><p>Launch signs and sends using your selected wallets. Use Wallet controls &amp; sales to transfer or sell tokens. Browser-timed actions need this page to stay open.</p></div>
          </div>
        </details>
        <BundlerContent />
      </div>
    </main>
    <Footer />
  </div>
}
