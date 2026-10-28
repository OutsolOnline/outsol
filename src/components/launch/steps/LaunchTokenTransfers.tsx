import React from 'react'
import type {LaunchBundleTransfer} from '@/lib/launchBundle/receipt'
import {Input} from '@/components/ui/input'

interface Props {
 transfers?: LaunchBundleTransfer[]
 wallets?: Array<{walletId:string;name:string}>
 status?: 'review'|'confirmed'|'partial'
}

/** Keep every raw token digit; Number would round large purchase outputs. */
export function formatTokenAmount(rawAmount:string,decimals:number){
 const digits=BigInt(rawAmount).toString().padStart(decimals+1,'0')
 if(decimals===0)return digits
 const fraction=digits.slice(-decimals).replace(/0+$/,'')
 return `${digits.slice(0,-decimals)}${fraction?`.${fraction}`:''}`
}

export function LaunchTokenTransfers({transfers,wallets=[],status='review'}:Props){
 if(!transfers?.length)return null
 return <section className="form-section min-w-0 space-y-4" aria-label="Token transfers">
  <h2 className="text-lg">{status==='review'?'Token transfers in this bundle':status==='confirmed'?'Transfers confirmed':'Recorded token transfer intent'}</h2>
  <p className="field-help">{status==='review'?'Each buyer sends exactly its purchased tokens in the same transaction. Earlier token holdings stay in the buyer wallet. Recipient account rent is included in the simulated payer requirements.':status==='confirmed'?'These token transfers confirmed with the launch transactions.':'These saved instructions do not establish transfer completion. Check the original transaction signatures in Activity before taking further action.'}{status==='partial'&&<> <a href="/activity" className="underline">Review Activity</a></>}</p>
  <ul className="space-y-4">{transfers.map(transfer=><li key={transfer.walletId} className="min-w-0 border-t border-border pt-4">
   <p className="text-sm">{wallets.find(wallet=>wallet.walletId===transfer.walletId)?.name||'Buyer wallet'}</p>
   <dl className="mt-3 space-y-3 text-sm">
    <div><dt className="text-muted">Exact token amount</dt><dd className="tabular-nums break-all mt-1">{formatTokenAmount(transfer.rawAmount,transfer.decimals)} tokens</dd></div>
    <div><dt className="text-muted">From buyer</dt><dd className="font-mono break-all mt-1">{transfer.payer}</dd></div>
    <div><dt className="text-muted">Send bought tokens to</dt><dd className="font-mono break-all mt-1">{transfer.recipient}</dd></div>
   </dl>
  </li>)}</ul>
 </section>
}

export function LaunchTransferDestination({id,buyerName,value,disabled,onChange}:{id:string;buyerName:string;value:string;disabled:boolean;onChange:(value:string)=>void}){
 return <div className="min-w-0">
  <label className="field-label" htmlFor={id}>Send bought tokens to <span className="text-muted font-normal">· optional</span><span className="sr-only"> for {buyerName}</span></label>
  <Input id={id} type="text" value={value} disabled={disabled} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-help`} onChange={event=>onChange(event.currentTarget.value)} placeholder="Receiving wallet public address" className="w-full min-w-0 font-mono text-xs"/>
  <p id={`${id}-help`} className="field-help">Use a receiving wallet public address only. This purchase’s tokens move in the same transaction. Leave empty to keep them in the buyer wallet.</p>
 </div>
}
