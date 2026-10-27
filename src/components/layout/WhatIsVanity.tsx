'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, CircleHelp, Compass, FlaskConical, Rocket, Settings2, ShieldCheck } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { EXTERNAL_COST_REFERENCES, FEE_SOURCES_CHECKED_LABEL, PLATFORM_FEE_REFERENCES, VANITY_FEE_POLICY } from '@/lib/feeComparison'
import { prepareLaunchLinkNavigation } from '@/lib/launchNavigation'
import { useLaunchStore } from '@/stores/launchStore'

const workflow = [
  { title: 'Prepare', description: 'Choose a goal and plan your budget.', href: '/planner', icon: Compass },
  { title: 'Rehearse', description: 'Check a simulation before committing SOL.', href: '/rehearse', icon: FlaskConical },
  { title: 'Launch', description: 'Review the transaction, then sign.', href: '/launch?new=1', icon: Rocket },
  { title: 'Manage', description: 'Review holdings, trades and activity.', href: '/manage', icon: Settings2 },
]

export function WhatIsOutSol({ variant = 'header' }: { variant?: 'header' | 'secondary' }) {
  const [open, setOpen] = useState(false)
  const [navigationError,setNavigationError]=useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  return <Dialog open={open} onOpenChange={next=>{setOpen(next);setNavigationError('')}}>
    <DialogTrigger className={variant === 'secondary' ? 'secondary-action outsol-about-inline' : 'vanity-about-trigger'} aria-label="What is OutSol? About the workspace and fees" title="What is OutSol?"><CircleHelp size={17} aria-hidden="true" /><span>What is OutSol?</span></DialogTrigger>
    <DialogContent className="vanity-about-dialog" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus({ preventScroll: true }) }}>
      <div className="about-dialog-heading"><span className="eyebrow">YOUR LAUNCH WORKSPACE</span><DialogTitle ref={titleRef} tabIndex={-1}>What is OutSol?</DialogTitle><DialogDescription>A focused workspace for Pump.fun on Solana.</DialogDescription></div>
      <div className="about-dialog-scroll"><p className="about-intro">Prepare a token design, rehearse the transaction, review its costs and sign with your chosen wallet. Keep the design, launch and follow-up work in one place.</p>
        <div className="about-fee-policy"><ShieldCheck size={23} strokeWidth={1.6} aria-hidden="true" /><div><h3>{VANITY_FEE_POLICY.headline}</h3><p>{VANITY_FEE_POLICY.detail}</p></div></div>
        {navigationError&&<p role="alert" className="notice notice-error mb-4">{navigationError}</p>}<div className="about-workflow" aria-label="The OutSol workflow">{workflow.map((step, index) => <Link href={step.href} className="about-workflow-step" key={step.title} onClick={event=>{if(!prepareLaunchLinkNavigation(event,step.href)){setNavigationError(useLaunchStore.getState().error||'Save your current design before starting another.');return}setOpen(false)}}><span className="about-step-top"><step.icon size={19} strokeWidth={1.6} aria-hidden="true" /><span>0{index + 1}</span></span><b>{step.title}<ArrowUpRight size={13} aria-hidden="true" /></b><small>{step.description}</small></Link>)}</div>
        <p className="about-key-note"><ShieldCheck size={16} aria-hidden="true" /><span>Your private keys stay in your browser or chosen wallet. Public saved designs exclude wallet keys and signed transactions.</span></p>
        <section className="about-comparison" aria-labelledby="about-fees-heading"><div className="section-heading"><div><h3 id="about-fees-heading">How platform fees compare</h3><p>Compare the same operation and its final cost.</p></div></div><div className="fee-comparison-list">{PLATFORM_FEE_REFERENCES.map(platform => <article className="fee-comparison-row" key={platform.name}><div className="fee-platform-heading"><h4>{platform.name}</h4>{!platform.verified && <span>Rate unverified</span>}</div><dl className="fee-operation-list">{platform.operations.map(operation => <div key={operation.label}><dt>{operation.label}</dt><dd>{operation.charge}</dd></div>)}</dl><p>{platform.note}</p><div className="fee-source-links">{platform.sources.map(source => <a href={source.href} target="_blank" rel="noreferrer" key={source.href}>{source.label}<ArrowUpRight size={12} aria-hidden="true" /></a>)}</div></article>)}</div><p className="fee-source-date">Official sources checked {FEE_SOURCES_CHECKED_LABEL}. Rates and terms can change. These references are not an all-in transaction quote.</p></section>
        <details className="about-external-costs"><summary>What can still cost SOL?</summary><div className="external-cost-grid">{EXTERNAL_COST_REFERENCES.map(cost => <div key={cost.title}><h4>{cost.title}</h4><p>{cost.detail}</p><a href={cost.href} target="_blank" rel="noreferrer">{cost.source}<ArrowUpRight size={12} aria-hidden="true" /></a></div>)}</div></details>
      </div><div className="about-dialog-footer"><span>Build first. Review every signing action.</span><div><DialogClose asChild><button className="secondary-action">Close</button></DialogClose><Link href="/planner" className="primary-action" onClick={() => setOpen(false)}>Plan a launch<ArrowRight size={15} aria-hidden="true" /></Link></div></div>
    </DialogContent>
  </Dialog>
}

export const WhatIsVanity = WhatIsOutSol
