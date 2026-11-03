'use client'
import {useState} from 'react'
import {Archive,RotateCcw} from 'lucide-react'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {WALLET_GROUP_COLORS,type WalletLibraryGroup} from '@/lib/walletLibrary/types'
export function GroupPreferencesPanel({group,disabled}:{group:WalletLibraryGroup;disabled:boolean}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const change=async(patch:{color?:WalletLibraryGroup['color'];archivedAt?:string|null})=>{setBusy(true);setError('');try{await useWalletLibraryStore.getState().updateGroup(group.id,patch)}catch(e){setError(e instanceof Error?e.message:'Group settings could not be saved.')}finally{setBusy(false)}}
 return <details className="mb-5 rounded-lg border border-border px-4 py-3"><summary className="text-sm text-muted cursor-pointer">Group appearance & archive{group.archivedAt?' · Archived':''}</summary><div className="flex flex-wrap items-end gap-4 mt-4"><div><label className="field-label" htmlFor="wallet-group-color">Group marker</label><select id="wallet-group-color" value={group.color??'mint'} disabled={disabled||busy} onChange={e=>void change({color:e.target.value as WalletLibraryGroup['color']})}>{WALLET_GROUP_COLORS.map(color=><option value={color} key={color}>{color[0].toUpperCase()+color.slice(1)}</option>)}</select></div><button className="secondary-action" disabled={disabled||busy} onClick={()=>void change({archivedAt:group.archivedAt?null:new Date().toISOString()})}>{group.archivedAt?<RotateCcw size={14}/>:<Archive size={14}/>} {group.archivedAt?'Restore group':'Archive group'}</button></div><p className="field-help mt-3">Archiving organizes the group list. Wallets, balances, keys and recovery records are preserved.</p>{error&&<p className="notice notice-error mt-3" role="alert">{error}</p>}</details>
}
