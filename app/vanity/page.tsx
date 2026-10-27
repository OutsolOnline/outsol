'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Cpu, Fingerprint, KeyRound, Play, ShieldCheck, Square } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { VanityGeneratorForm, VanityFormData } from '@/components/vanity/VanityGeneratorForm'
import { VanityStats } from '@/components/vanity/VanityStats'
import { VanityResultDisplay } from '@/components/vanity/VanityResult'
import { useVanityGenerator } from '@/hooks/useVanityGenerator'
import { Button } from '@/components/ui/button'

export default function VanityPage() {
  const [formData, setFormData] = useState<VanityFormData>({ pattern: '', mode: 'prefix', caseSensitive: true, threads: 4 })
  const [isFormValid, setIsFormValid] = useState(false)
  const handleFormChange = useCallback((data: VanityFormData, isValid: boolean) => {
    setFormData(data)
    setIsFormValid(isValid)
  }, [])
  const { state, progress, result, error, start, stop, reset, keypair } = useVanityGenerator(formData)
  const isRunning = state === 'running'
  const hasResult = state === 'found' && result && keypair
  const status = isRunning ? 'Searching locally' : hasResult ? 'Match found' : error ? 'Search interrupted' : 'Ready to generate'

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
        <div className="max-w-7xl mx-auto space-y-7">
          <div className="page-heading flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-accent mb-3"><Fingerprint size={14} aria-hidden="true" />ADDRESS STUDIO</div>
              <h1 className="text-3xl font-medium tracking-tight text-foreground">Make your address yours.</h1>
              <p className="mt-2 text-sm text-muted max-w-xl">Find a Solana mint address with a memorable prefix or suffix. Generated right here, on your device.</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted"><ShieldCheck size={13} className="text-accent" aria-hidden="true" />Local generation</span>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
            <div className="min-w-0 space-y-5">
              <section className="workspace-card p-5 sm:p-7" aria-labelledby="vanity-pattern-heading">
                <div className="flex items-center gap-3 pb-6 mb-6 border-b border-border">
                  <span className="w-9 h-9 flex items-center justify-center rounded-xl bg-accent/10 text-accent"><KeyRound size={17} aria-hidden="true" /></span>
                  <div><h2 id="vanity-pattern-heading" className="text-sm font-medium text-foreground">Choose your pattern</h2><p className="text-sm text-muted mt-0.5">A few characters can make all the difference.</p></div>
                </div>
                <VanityGeneratorForm onFormChange={handleFormChange} disabled={isRunning} />
                <div className="mt-7 pt-5 border-t border-border flex flex-wrap items-center justify-between gap-4">
                  <p className="text-sm text-muted">No wallet connection or SOL required.</p>
                  <div className="flex items-center gap-2">
                    {(hasResult || error) && <Button type="button" variant="ghost" onClick={reset} size="sm">Reset</Button>}
                    <Button type="button" onClick={isRunning ? stop : start} disabled={!isRunning && !isFormValid} variant={isRunning ? 'secondary' : 'default'} className="gap-2">
                      {isRunning ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                      {isRunning ? 'Stop search' : 'Generate address'}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="workspace-card p-5 sm:p-7" aria-labelledby="vanity-progress-heading">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <h2 id="vanity-progress-heading" className="text-sm font-medium text-foreground flex items-center gap-2"><Cpu size={16} className="text-muted" aria-hidden="true" />Search activity</h2>
                  <span role="status" className="inline-flex items-center gap-2 text-xs text-muted"><span className={`w-1.5 h-1.5 rounded-full ${isRunning || hasResult ? 'bg-accent' : 'bg-muted-dim'}`} />{status}</span>
                </div>
                <div className="[&>div>div]:flex-wrap [&>div>div]:gap-5 [&_.w-px]:hidden">
                  <VanityStats progress={progress} pattern={formData.pattern} mode={formData.mode} caseSensitive={formData.caseSensitive} isRunning={isRunning} />
                </div>
                {isRunning && <p className="mt-4 text-sm text-muted">{progress?.executionMode === 'main-thread' ? '1 cooperative browser task active' : progress?.activeWorkers ? `${progress.activeWorkers} browser worker${progress.activeWorkers === 1 ? '' : 's'} active` : 'Starting browser workers…'}. Keep this tab open while searching.</p>}
                {!isRunning && !hasResult && !error && <p className="mt-5 text-sm text-muted border-t border-border pt-4">Start a search to see live throughput. Time estimates describe probability, so a match can arrive sooner or later.</p>}
              </section>

              {error && <div role="alert" className="border border-red-400/25 bg-red-400/5 rounded-xl px-5 py-4 text-sm text-red-300">{error}</div>}
              {hasResult && <section className="workspace-card p-5 sm:p-7" aria-label="Generated address"><VanityResultDisplay result={result} keypair={keypair} pattern={formData.pattern} mode={formData.mode} caseSensitive={formData.caseSensitive} /></section>}
            </div>

            <aside className="space-y-5">
              <section className="workspace-card p-5">
                <div className="text-xs font-medium text-muted uppercase tracking-wider mb-4">A better first search</div>
                <ol className="space-y-5">
                  {[
                    ['Start with 3–4 characters', 'Every extra character increases the search space. Longer patterns can take a lot more time.'],
                    ['Try a flexible match', 'Turning off case sensitivity usually makes a pattern easier to find.'],
                    ['Give your device some room', 'More workers can improve speed, but also use more CPU and battery.'],
                  ].map(([title, description], index) => <li key={title} className="flex gap-3"><span className="flex-shrink-0 text-xs font-mono text-accent border border-border rounded-md w-6 h-6 flex items-center justify-center">0{index + 1}</span><div><h3 className="text-xs font-medium text-foreground">{title}</h3><p className="text-sm text-muted leading-relaxed mt-1.5">{description}</p></div></li>)}
                </ol>
              </section>
              <section className="workspace-card p-5">
                <ShieldCheck size={20} className="text-accent mb-3" aria-hidden="true" />
                <h2 className="text-sm font-medium text-foreground">Your keys stay with you.</h2>
                <p className="text-sm text-muted leading-relaxed mt-2">The search runs in this browser. Back up a result before leaving the page, and keep its private key private.</p>
                <p className="text-sm text-muted leading-relaxed mt-3">A matching suffix is cosmetic. It does not verify a token or prove a connection to any launch platform.</p>
              </section>
              <Link href="/launch" className="workspace-card p-5 flex items-start gap-3 group hover:border-accent/40 transition-colors">
                <span className="w-8 h-8 flex-shrink-0 rounded-lg bg-accent/10 text-accent flex items-center justify-center"><Check size={15} aria-hidden="true" /></span>
                <div><h2 className="text-sm font-medium text-foreground">Ready for the next step?</h2><p className="mt-1 text-sm text-muted">Create your token in the launch studio.</p><span className="mt-4 flex items-center gap-2 text-xs text-accent">Open launch studio<ArrowRight size={13} aria-hidden="true" /></span></div>
              </Link>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
