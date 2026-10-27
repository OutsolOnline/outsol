'use client'

import dynamic from 'next/dynamic'
import type {TradingSessionConfig} from '@/lib/tradingSessions/types'

const Content=dynamic(()=>import('./TradingSessionsContent').then(module=>module.TradingSessionsContent),{ssr:false,loading:()=> <div className="min-h-screen grid place-items-center"><div className="loader-line w-24"/></div>})
export function TradingSessionsClient({initialMode}:{initialMode:TradingSessionConfig['mode']}){return <Content initialMode={initialMode}/>}
