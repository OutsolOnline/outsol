'use client'
import Link from 'next/link'
import {useSearchParams} from 'next/navigation'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {WalletManager} from './WalletManager'
import {WalletOperations} from './WalletOperations'
export function WalletWorkspace(){
 const params=useSearchParams(),manual=params.get('view')==='manual',action=params.get('action')
 return <div className="min-h-screen flex flex-col"><Header/><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1"><nav className="filter-tabs mb-7" aria-label="Wallet workspace"><Link href="/wallet-operations" aria-current={!manual?'page':undefined} className={!manual?'text-accent':''}>Wallets & groups</Link><Link href="/wallet-operations?view=manual" aria-current={manual?'page':undefined} className={manual?'text-accent':''}>Transfers & cleanup</Link></nav>{manual?<><div className="page-heading"><h1>Manual wallet operations</h1><p>Review individual SOL transfers, token distributions and eligible account cleanup.</p></div><WalletOperations/></>:<WalletManager initialAction={action==='create'||action==='import'?action:undefined}/>}</main><Footer/></div>
}
export function WalletWorkspaceLoading(){return <div className="min-h-screen flex flex-col"><Header/><main id="workspace-content" className="workspace-main flex-1" aria-busy="true"><div className="page-heading"><h1>Wallets</h1><p>Opening your encrypted wallet workspace…</p></div><div className="workspace-card animate-pulse space-y-5">{[1,2,3].map(value=><div className="h-16 rounded-lg bg-white/5" key={value}/>)}</div></main><Footer/></div>}
