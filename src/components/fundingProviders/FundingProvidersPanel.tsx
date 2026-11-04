'use client'

import {useEffect,useId,useRef,useState} from 'react'
import {ArrowUpRight,Check,Copy,Download,ExternalLink,Loader2,RefreshCw,Upload} from 'lucide-react'
import {Button} from '../ui/button'
import {Input} from '../ui/input'
import {FUNDING_POLICIES,MAX_FUNDING_WALLETS,parseFundingPlan,type FundingQuote,type FundingReceipt} from '../../lib/fundingProviders/model'
import {parseFundingRecovery,readFundingRecoveries,saveFundingRecovery,type FundingRecovery} from '../../lib/fundingProviders/recovery'

interface ProviderAvailability {splitnow:{configured:boolean};husher:{configured:boolean}}
export interface FundingProvidersPanelProps {recipients?:{address:string;label?:string}[];groupName?:string;onBusyChange?:(busy:boolean)=>void}
async function request<T>(path:string,body?:unknown,capability?:string):Promise<T>{
 const response=await fetch(`/api/funding-providers${path}`,{method:path?'POST':'GET',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(capability?{authorization:`Bearer ${capability}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25_000),cache:'no-store',redirect:'error'})
 const value=await response.json();if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'Provider funding is unavailable.')
 return value as T
}
function recovery(capability:string):FundingRecovery{return {version:1,kind:'launchpier-splitnow-funding',capability,createdAt:new Date().toISOString()}}
function download(value:FundingRecovery){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),anchor=document.createElement('a')
 anchor.href=url;anchor.download=`launchpier-funding-${value.createdAt.slice(0,10)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5_000)
}
const short=(address:string)=>`${address.slice(0,6)}…${address.slice(-5)}`
const stateLabel=(state:FundingReceipt['state'])=>({creating:'Creating order',uncertain:'Recovery required',verification_required:'Verification required',pending:'Awaiting deposit',sending:'Sending',monitoring:'Monitoring',expired:'Expired',halted:'Halted',failed:'Failed',refunded:'Provider reports refund',completed:'Provider reports complete'})[state]

/** A separately reviewed third-party order. No wallet keys or signing methods enter this panel. */
export function FundingProvidersPanel({recipients=[],groupName,onBusyChange}:FundingProvidersPanelProps){
 const id=useId(),[availability,setAvailability]=useState<ProviderAvailability|null>(null),[amountSol,setAmountSol]=useState(''),[quote,setQuote]=useState<FundingQuote|null>(null),[exchangeId,setExchangeId]=useState(''),[policies,setPolicies]=useState(false),[confirmed,setConfirmed]=useState(false),[receipt,setReceipt]=useState<FundingReceipt|null>(null),[selected,setSelected]=useState<FundingRecovery|null>(null),[saved,setSaved]=useState<FundingRecovery[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[now,setNow]=useState(0),[downloaded,setDownloaded]=useState('')
 const importRef=useRef<HTMLInputElement>(null),quoteGeneration=useRef({value:0}),mounted=useRef(true)
 const recipientKey=recipients.map(row=>row.address).join(',')
 const validCount=recipients.length>0&&recipients.length<=MAX_FUNDING_WALLETS
 const expired=!!quote&&Date.parse(quote.expiresAt)<=now
 const depositExpired=!!receipt?.deposit?.expiresAt&&Date.parse(receipt.deposit.expiresAt)<=now
 const currentCapability=selected?.capability||quote?.capability
 const loadAvailability=async()=>{setLoading(true);try{setAvailability(await request<ProviderAvailability>(''));setError('')}catch{setError('Provider availability could not be checked. Retry to load its configuration.')}finally{setLoading(false)}}
 useEffect(()=>{const lifecycle=quoteGeneration.current;mounted.current=true;void loadAvailability();try{setSaved(readFundingRecoveries(localStorage))}catch{setNotice('Browser receipt storage is unavailable. Download a recovery file before creating an order.')}return()=>{mounted.current=false;lifecycle.value++}},[])
 useEffect(()=>{quoteGeneration.current.value++;setQuote(null);setPolicies(false);setConfirmed(false);setExchangeId('')},[recipientKey,amountSol])
 useEffect(()=>{if(!quote&&!receipt?.deposit)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1_000);return()=>clearInterval(timer)},[quote,receipt])
 useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange])

 async function getQuote(){
  setError('');setNotice('');let input:ReturnType<typeof parseFundingPlan>
  try{input=parseFundingPlan({amountSol,recipients:recipients.map(row=>({address:row.address}))})}catch(error){setError(error instanceof Error?error.message:'Review the selected recipients.');return}
  const generation=++quoteGeneration.current.value;setBusy(true);setQuote(null);setReceipt(null);setSelected(null);setPolicies(false);setConfirmed(false)
  try{const result=await request<FundingQuote>('/quote',{amountSol:input.amountSol,recipients:input.recipients});if(mounted.current&&generation===quoteGeneration.current.value){setQuote(result);setExchangeId(result.routes[0]?.exchangeId||'');setNow(Date.now())}}
  catch(error){if(mounted.current&&generation===quoteGeneration.current.value)setError(error instanceof Error?error.message:'The quote could not be prepared.')}
  finally{if(mounted.current)setBusy(false)}
 }
 function preserve(value:FundingRecovery){
  try{setSaved(saveFundingRecovery(localStorage,value));return true}catch{setNotice('The receipt could not be saved on this browser. Keep your downloaded recovery file.');return downloaded===value.capability}
 }
 async function createOrder(){
  if(!quote||expired||!policies||!confirmed||busy)return
  const selectedRecovery=recovery(quote.capability)
  if(!preserve(selectedRecovery)){setError('Download the recovery file below before creating the order. Browser storage is unavailable.');return}
  setSelected(selectedRecovery);setBusy(true);setError('');setReceipt({plan:quote.plan,state:'creating',createdAt:selectedRecovery.createdAt,updatedAt:selectedRecovery.createdAt,exchangeId,message:'The order is being prepared. Keep this receipt if the connection is interrupted.',platformFeeBps:0})
  try{const value=await request<FundingReceipt>('/order',{exchangeId,policiesAccepted:policies,reviewConfirmed:confirmed},quote.capability);if(mounted.current){setReceipt(value);setQuote(null)}}
  catch{if(mounted.current){setReceipt(current=>current?{...current,state:'uncertain',message:'The connection was interrupted. Refresh this saved receipt before creating another order or sending funds.'}:current);setQuote(null)}}
  finally{if(mounted.current)setBusy(false)}
 }
 async function restore(value:FundingRecovery){
  if(busy)return;quoteGeneration.current.value++;setSelected(value);setQuote(null);setReceipt(null);setError('');setNotice('');setBusy(true)
  try{const result=await request<FundingReceipt>('/status',undefined,value.capability);if(mounted.current)setReceipt(result)}catch(error){if(mounted.current)setError(error instanceof Error?error.message:'This receipt could not be refreshed.')}finally{if(mounted.current)setBusy(false)}
 }
 async function importRecovery(file:File|undefined){
  if(!file)return
  try{if(file.size>4_096)throw new Error('Choose a small LaunchPier funding recovery file.');const value=parseFundingRecovery(JSON.parse(await file.text()));preserve(value);await restore(value)}catch(error){setError(error instanceof Error?error.message:'The recovery file could not be imported.')}
  finally{if(importRef.current)importRef.current.value=''}
 }
 function exportRecovery(){
  if(!currentCapability)return
  try{download(selected||recovery(currentCapability));setDownloaded(currentCapability);setNotice('Keep this private funding recovery file. It can view this order, but cannot sign wallet transactions.')}catch{setError('The recovery file could not be downloaded. Allow downloads and try again.')}
 }
 async function copyAddress(){try{await navigator.clipboard.writeText(receipt?.deposit?.address||'');setNotice('Verified Solana deposit address copied.')}catch{setError('Select and copy the deposit address shown below.')}}

 return <section className="workspace-card" aria-labelledby={`${id}-title`}>
  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">EXTERNAL FUNDING</p><h2 id={`${id}-title`} className="text-xl mt-1">Fund through a provider</h2></div><span className="status-chip">0% LaunchPier fee</span></div>
  <p className="text-sm text-muted mt-3 leading-relaxed">Send SOL through SplitNOW to your selected wallets. Review a floating estimate, create an order, then make its deposit yourself.</p>
  <details className="mt-4 border border-border rounded-lg p-4"><summary className="text-sm cursor-pointer">Provider charges and how this works</summary><div className="text-sm text-muted leading-relaxed space-y-3 mt-3"><p>SplitNOW executes this service. Its published terms list up to 1% service fees, plus partner-exchange and network charges. LaunchPier adds no fee.</p><p>A quote covers the whole SOL amount. The provider recalculates each wallet allocation; final receipts can differ. The API does not itemize every charge. Exchange selection can fall back to another provider, and orders can be delayed or halted. This is not an anonymity guarantee.</p><div className="flex flex-wrap gap-x-4 gap-y-2"><a className="text-link" href={FUNDING_POLICIES.terms} target="_blank" rel="noreferrer">SplitNOW terms<ExternalLink size={12}/></a><a className="text-link" href="https://www.husher.io/" target="_blank" rel="noreferrer">Open Husher<ExternalLink size={12}/></a></div><p>Husher is currently an external option. Connecting a public app to its API requires written Partner Access; a personal API key cannot enable it here.</p></div></details>
  {error&&<p role="alert" className="notice notice-error mt-4">{error}</p>}{notice&&<p role="status" className="notice mt-4">{notice}</p>}
  {loading?<div role="status" className="flex gap-2 items-center py-6 text-sm text-muted"><Loader2 size={16} className="animate-spin motion-reduce:animate-none"/>Checking provider configuration…</div>:!availability?<Button variant="secondary" className="mt-4" onClick={()=>void loadAvailability()}>Retry provider check<RefreshCw size={14}/></Button>:!availability.splitnow.configured?<div className="border border-border rounded-lg p-4 mt-5"><p className="text-sm font-medium">SplitNOW setup required</p><p className="field-help mt-2">The site owner must configure its private API key and persistent receipt storage before quotes or orders are available. Your existing direct wallet funding remains available above.</p><a className="text-link mt-3" href="https://splitnow.io/" target="_blank" rel="noreferrer">Use SplitNOW directly<ArrowUpRight size={13}/></a></div>:null}

  {availability?.splitnow.configured&&!receipt&&<div className="mt-6 space-y-4">
   <div><label className="field-label" htmlFor={`${id}-amount`}>Total deposit in SOL</label><Input id={`${id}-amount`} inputMode="decimal" placeholder="1.00" value={amountSol} disabled={busy} onChange={event=>setAmountSol(event.target.value)} aria-describedby={`${id}-allocation`}/><p id={`${id}-allocation`} className="field-help mt-2">{groupName?`${groupName} · `:''}{recipients.length} selected wallets · equal percentage allocation.{!validCount&&` Choose a group with 1–${MAX_FUNDING_WALLETS} wallets.`}</p></div>
   <Button variant="secondary" disabled={busy||!validCount||!amountSol} onClick={()=>void getQuote()}>{busy?<Loader2 size={15} className="animate-spin motion-reduce:animate-none"/>:<RefreshCw size={15}/>}Get current estimate</Button>
  </div>}

  {quote&&!receipt&&<div className="mt-6 border-t border-border pt-5 space-y-4">
   <h3 className="text-lg">Review the provider order</h3><p className="field-help">Solana → Solana · floating rate · {expired?'Estimate expired. Request a fresh estimate.':`Review before ${new Date(quote.expiresAt).toLocaleTimeString()}.`}</p>
   <label className="field-label" htmlFor={`${id}-route`}>Preferred exchange route</label><select id={`${id}-route`} className="w-full" value={exchangeId} disabled={busy||expired} onChange={event=>{setExchangeId(event.target.value);setConfirmed(false)}}>{quote.routes.map(route=><option key={route.exchangeId} value={route.exchangeId}>{route.exchangeId} · estimated {route.estimatedOutputSol} SOL returned for whole amount</option>)}</select>
   <dl className="divide-y divide-border text-sm"><div className="flex justify-between gap-4 py-3"><dt>Total provider deposit</dt><dd className="tabular-nums">{quote.plan.amountSol} SOL</dd></div><div className="flex justify-between gap-4 py-3"><dt>LaunchPier fee</dt><dd className="tabular-nums">0 SOL</dd></div><div className="flex justify-between gap-4 py-3"><dt>Provider, exchange and network charges</dt><dd className="max-w-[55%] text-right text-muted">Not itemized by this API. Up to 1% provider service fee; exchange and network charges may be additional.</dd></div></dl>
   <p className="field-help">The displayed return is an estimate for the whole amount, not a guaranteed total for this group. Your deposit is not an additional platform fee. Your sending wallet also pays its own Solana transaction fee.</p>
   <div className="border border-border rounded-lg overflow-hidden"><div className="bg-surface-elevated px-3 py-2 text-sm font-medium">Exact destination allocation</div><ul className="divide-y divide-border">{quote.plan.recipients.map(row=><li className="flex flex-wrap justify-between gap-2 px-3 py-3 text-sm" key={row.address}><span className="min-w-0"><span className="block">{recipients.find(recipient=>recipient.address===row.address)?.label||'Selected wallet'}</span><span className="block break-all font-mono text-xs text-muted mt-1">{row.address}</span></span><span className="tabular-nums">{(row.shareBps/100).toFixed(2)}%</span></li>)}</ul></div>
   <label className="flex gap-3 items-start text-sm leading-relaxed"><input className="mt-1 h-4 w-4 accent-accent" type="checkbox" checked={policies} disabled={busy||expired} onChange={event=>setPolicies(event.target.checked)}/><span>I accept SplitNOW’s <a className="underline" href={FUNDING_POLICIES.terms} target="_blank" rel="noreferrer">terms</a>, <a className="underline" href={FUNDING_POLICIES.privacy} target="_blank" rel="noreferrer">privacy</a> and <a className="underline" href={FUNDING_POLICIES.aml} target="_blank" rel="noreferrer">AML policies</a>, and confirm I am eligible under its <a className="underline" href={FUNDING_POLICIES.regions} target="_blank" rel="noreferrer">region restrictions</a>.</span></label>
   <label className="flex gap-3 items-start text-sm leading-relaxed"><input className="mt-1 h-4 w-4 accent-accent" type="checkbox" checked={confirmed} disabled={busy||expired} onChange={event=>setConfirmed(event.target.checked)}/><span>I checked every Solana destination and allocation, understand the floating rate and provider charges, and want to create this order. I will fund it manually.</span></label>
   <Button disabled={busy||expired||!policies||!confirmed||!exchangeId} onClick={()=>void createOrder()}>{busy?<Loader2 size={15} className="animate-spin motion-reduce:animate-none"/>:<Check size={15}/>}Create deposit order</Button>
  </div>}

  {receipt&&<div className="mt-6 border-t border-border pt-5 space-y-4" aria-live="polite">
   <div className="flex flex-wrap justify-between gap-3"><h3 className="text-lg">{stateLabel(receipt.state)}</h3><Button variant="secondary" size="sm" disabled={busy||!selected} onClick={()=>selected&&void restore(selected)}><RefreshCw size={14} className={busy?'animate-spin motion-reduce:animate-none':''}/>Refresh receipt</Button></div>
   <p className="text-sm text-muted leading-relaxed">{receipt.message}</p><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted">Reviewed deposit</dt><dd className="tabular-nums mt-1">{receipt.plan.amountSol} SOL</dd></div><div><dt className="text-muted">Recipients</dt><dd className="tabular-nums mt-1">{receipt.plan.recipients.length} wallets</dd></div><div><dt className="text-muted">Preferred route</dt><dd className="mt-1">{receipt.exchangeId}</dd></div><div><dt className="text-muted">Provider order</dt><dd className="font-mono mt-1">{receipt.orderId||'Response unconfirmed'}</dd></div></dl>
   {depositExpired&&<p role="status" className="notice notice-error">The displayed deposit instructions have expired. Do not send funds; refresh this receipt.</p>}{receipt.deposit&&!depositExpired&&<div className="border border-accent/35 bg-accent/5 rounded-lg p-4"><p className="font-medium text-sm">Manual deposit · Solana network only</p><p className="text-2xl tabular-nums mt-3">{receipt.deposit.amountSol} SOL</p><p className="font-mono text-sm break-all mt-3 select-all">{receipt.deposit.address}</p><Button variant="secondary" size="sm" className="mt-3" onClick={()=>void copyAddress()}><Copy size={13}/>Copy verified deposit address</Button>{receipt.deposit.expiresAt?<p className="field-help mt-3">Provider expiry: {new Date(receipt.deposit.expiresAt).toLocaleString()}. Refresh before depositing; do not send after expiry.</p>:<p className="field-help mt-3">The provider did not supply an expiry. Refresh and verify the order is still awaiting a deposit before sending.</p>}</div>}
   <details className="border border-border rounded-lg p-3"><summary className="cursor-pointer text-sm">Reviewed destination wallets</summary><ul className="mt-3 space-y-3">{receipt.plan.recipients.map(row=><li key={row.address} className="flex justify-between gap-3 text-sm"><span className="font-mono break-all text-xs">{row.address}</span><span className="tabular-nums">{row.shareBps/100}%</span></li>)}</ul></details>
   <p className="field-help">Updated {new Date(receipt.updatedAt).toLocaleString()}. Status is reported by SplitNOW, not independently confirmed on chain.</p><a className="text-link" href="https://splitnow.io/" target="_blank" rel="noreferrer">Open SplitNOW for support<ExternalLink size={12}/></a>
   <Button variant="ghost" disabled={busy} onClick={()=>{setReceipt(null);setSelected(null);setQuote(null);setPolicies(false);setConfirmed(false)}}>Prepare a separate funding order</Button>
  </div>}

  <div className="mt-6 border-t border-border pt-5"><div className="flex flex-wrap gap-3">{currentCapability&&<Button variant="secondary" size="sm" onClick={exportRecovery}><Download size={14}/>Download recovery</Button>}<Button variant="secondary" size="sm" disabled={busy} onClick={()=>importRef.current?.click()}><Upload size={14}/>Import recovery</Button><input ref={importRef} className="sr-only" tabIndex={-1} aria-label="Import funding recovery JSON" type="file" accept="application/json,.json" onChange={event=>void importRecovery(event.target.files?.[0])}/></div><p className="field-help mt-3">Keep recovery files private: they open order details, but contain no wallet keys. Receipts remain recoverable on this service for 90 days. No funds are sent from this page automatically.</p>
   {saved.length>0&&<details className="mt-4"><summary className="cursor-pointer text-sm">Saved private receipts · {saved.length}</summary><ul className="mt-3 space-y-1">{saved.map(value=><li key={value.capability}><button className="text-link py-2 text-left" disabled={busy} onClick={()=>void restore(value)} aria-label={`Open funding receipt from ${new Date(value.createdAt).toLocaleString()}`}>{new Date(value.createdAt).toLocaleString()}<span className="text-xs text-muted">{short(value.capability)}</span></button></li>)}</ul></details>}
  </div>
 </section>
}
