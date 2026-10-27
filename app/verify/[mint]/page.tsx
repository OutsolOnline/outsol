'use client'
import {use,useState} from 'react'
import Link from 'next/link'
import {Copy} from 'lucide-react'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {TokenFactsPanel} from '@/components/manage/TokenFactsPanel'
export default function VerifyPage({params}:{params:Promise<{mint:string}>}){
 const {mint}=use(params),[notice,setNotice]=useState('')
 return <><Header/><main className="workspace-main" id="workspace-content" tabIndex={-1}><div className="page-heading flex flex-wrap items-start justify-between gap-5"><div><div className="eyebrow">PUBLIC TOKEN VERIFICATION</div><h1>Facts you can check.</h1><p>Read the current mint and Pump.fun curve directly from Solana.</p></div><button className="secondary-action" onClick={async()=>{try{await navigator.clipboard.writeText(location.href);setNotice('Public link copied.')}catch{setNotice('Copy this page’s address to share it.')}}}><Copy size={15}/>Copy link</button></div>{notice&&<p role="status" className="notice mb-6">{notice}</p>}<TokenFactsPanel mint={mint}/><div className="workspace-card mt-6 flex flex-wrap gap-5 items-center justify-between"><div><h2 className="text-lg">Manage this token</h2><p className="field-help mt-2">Open a workspace to check your holdings and save private notes.</p></div><Link href={`/token/${mint}`} className="primary-action">Open token workspace</Link></div></main><Footer/></>
}
