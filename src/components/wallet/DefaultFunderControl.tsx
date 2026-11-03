'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {readWorkspacePreferences} from '@/lib/workspacePreferences'
export function DefaultFunderControl({disabled,onChoose}:{disabled:boolean;onChoose:()=>void}){
 const library=useWalletLibraryStore(),[address,setAddress]=useState<string>(),[error,setError]=useState('')
 useEffect(()=>{const load=()=>{try{setAddress(readWorkspacePreferences().defaultFunder);setError('')}catch{setError('Saved funding preferences could not be read. Choose a signer manually.')}};load();window.addEventListener('storage',load);window.addEventListener('outsol-preferences-changed',load);return()=>{window.removeEventListener('storage',load);window.removeEventListener('outsol-preferences-changed',load)}},[])
 const wallet=library.wallets.find(row=>row.publicKey===address)
 return <div className="field-help mt-3">{wallet?<button type="button" className="text-link" disabled={disabled} onClick={()=>{try{useWalletLibraryStore.getState().selectWallet(wallet.id);onChoose();setError('')}catch(e){setError(e instanceof Error?e.message:'The saved funder is unavailable.')}}}>Use saved funder · {wallet.name}</button>:<Link href="/settings" className="text-link">Set a default funder</Link>}{address&&!wallet&&<p className="mt-2">Import your saved funder wallet to use it here.</p>}{error&&<p role="alert" className="mt-2">{error}</p>}</div>
}
