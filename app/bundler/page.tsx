'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowUpRight, Layers3, ShieldCheck } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'

// Dynamic import to avoid SSR issues
const BundlerContent = dynamic(
  () => import('@/components/bundler/BundlerContent').then(mod => mod.BundlerContent),
  { ssr: false, loading: () => <BundlerLoading /> }
)

function BundlerLoading() {
  return (
    <div className="workspace-card text-center py-16" role="status">
      <div className="inline-block w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      <p className="text-muted text-sm mt-4">Preparing the bundle workspace…</p>
    </div>
  )
}

export default function BundlerPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
        <div className="max-w-7xl mx-auto space-y-7">
          <div className="page-heading flex flex-wrap items-start justify-between gap-4">
            <div><div className="flex items-center gap-2 text-xs text-accent mb-3"><Layers3 size={14} aria-hidden="true" />PUMP.FUN · SOL DEPLOYER</div><h1 className="text-3xl font-medium tracking-tight text-foreground">Wallet bundles</h1><p className="mt-2 text-sm text-muted max-w-xl">Generate reusable sniper and receiver pairs, fund their addresses yourself, then launch and manage your token.</p></div>
            <Link href="/launch" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted hover:text-foreground hover:border-muted-dim">Standard launch studio<ArrowUpRight size={13} aria-hidden="true" /></Link>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted"><ShieldCheck size={14} className="text-accent mt-0.5 flex-shrink-0" aria-hidden="true" /><p>0% OutSol platform fees. Network fees, account rent, venue charges and any selected Jito tip still apply.</p></div>
          <BundlerContent />
          <details className="workspace-card">
          <summary className="cursor-pointer text-sm text-muted">How a bundle launch works</summary>
          <div className="grid sm:grid-cols-3 gap-3 mt-5" aria-label="Bundle preparation steps">
            {[
              ['01', 'Set up your token', 'Add metadata and choose a mint.'],
              ['02', 'Prepare your wallets', 'Set buy budgets and execution timing.'],
              ['03', 'Review and launch', 'Check costs, back up keys, then execute.'],
            ].map(([step, title, copy]) => <div key={step} className="workspace-card flex items-start gap-3 p-4"><span className="text-xs font-mono text-accent bg-accent/10 border border-accent/15 rounded-md px-1.5 py-1">{step}</span><div><h2 className="text-xs font-medium text-foreground">{title}</h2><p className="mt-1 text-sm text-muted">{copy}</p></div></div>)}
          </div>
          </details>
        </div>
      </main>
      <Footer />
    </div>
  )
}
