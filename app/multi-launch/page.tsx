'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import {Layers3} from 'lucide-react'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'

const MultiLaunchContent=dynamic(()=>import('@/components/multiLaunch/MultiLaunchContent').then(module=>module.MultiLaunchContent),{ssr:false,loading:()=> <div className="workspace-card p-12 text-sm text-muted" role="status">Preparing your multi-launch workspace…</div>})
export default function MultiLaunchPage(){return <div className="min-h-screen flex flex-col bg-background"><Header/><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1"><div className="max-w-7xl mx-auto space-y-7"><div className="page-heading"><div className="flex items-center gap-2 text-xs text-accent mb-3"><Layers3 size={14}/>MULTI-LAUNCH</div><h1 className="text-3xl font-medium tracking-tight">One design. A reviewed launch sequence.</h1><p className="mt-2 text-sm text-muted max-w-2xl">Prepare 2–5 Pump.fun tokens, review every cost, then launch them in order from one signing wallet. Each token has its own fresh mint address.</p><Link href="/launch" className="text-xs text-accent underline inline-block mt-3">Back to Launch studio</Link></div><div className="notice text-sm">OutSol adds 0% platform fees. Network fees, account rent, Pump.fun charges and any required validator tip apply.</div><MultiLaunchContent/></div></main><Footer/></div>}
