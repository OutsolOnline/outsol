'use client'

import {useEffect,useRef,useState} from 'react'
import {ArrowUpRight,Database,LoaderCircle,RefreshCw,Square} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import type {BackgroundJobReadiness} from '@/lib/server/backgroundJobs/config'
import type {HistoryJobInput,HistoryReceipt,JobSummary} from '@/lib/server/backgroundJobs/model'
import styles from './BackgroundJobsPanel.module.css'

type SavedJob={id:string;accessKey:string;input:HistoryJobInput}
const STORAGE='launchpier-background-history-v1',HEADER='x-launchpier-job-key'
const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-5)}`
const stage=(state:JobSummary['state'])=>({queued:'Queued',running:'Indexing',succeeded:'Finished',cancelled:'Cancelled',failed:'Needs attention'})[state]
const readSaved=():SavedJob[]=>{
 const value=localStorage.getItem(STORAGE);if(!value)return[]
 const rows:unknown=JSON.parse(value);if(!Array.isArray(rows)||rows.length>12)throw new Error('Saved history access could not be read. Preserve this browser’s site data.')
 for(const row of rows){if(!row||typeof row!=='object'||!/^[a-f0-9]{40}$/.test(row.id)||!/^[A-Za-z0-9_-]{43}$/.test(row.accessKey)||row.input?.version!==1||row.input?.kind!=='token-history'||typeof row.input.mint!=='string'||typeof row.input.idempotencyKey!=='string'||!Number.isSafeInteger(row.input.maxTransactions))throw new Error('Saved history access could not be read. Preserve this browser’s site data.')}
 return rows as SavedJob[]
}
async function newSavedJob(mint:string,maxTransactions:number):Promise<SavedJob>{
 const bytes=crypto.getRandomValues(new Uint8Array(32)),accessKey=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
 const input:HistoryJobInput={version:1,kind:'token-history',mint,maxTransactions,idempotencyKey:crypto.randomUUID()},digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${accessKey}\0${input.idempotencyKey}`))
 const id=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,40)
 return{id,accessKey,input}
}
async function request<T>(url:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(url,{...init,cache:'no-store',signal:init.signal??AbortSignal.timeout(8000)})
 const body=await response.json() as T&{error?:string};if(!response.ok)throw new Error(body.error||'History indexing could not be reached. Try again.');return body
}

/** Only public mint addresses and independent read-only job capabilities cross
 * this boundary. The local wallet library is intentionally never imported. */
export function BackgroundJobsPanel({mint:initialMint=''}:{mint?:string}={}){
 const [mint,setMint]=useState(initialMint),[limit,setLimit]=useState('100'),[readiness,setReadiness]=useState<BackgroundJobReadiness|null>(null),[saved,setSaved]=useState<SavedJob[]>([]),[jobs,setJobs]=useState<Record<string,JobSummary>>({}),[selected,setSelected]=useState(''),[receipts,setReceipts]=useState<HistoryReceipt[]>([]),[offset,setOffset]=useState(0),[storageReady,setStorageReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0)
 const operation=useRef(false),alive=useRef(true)
 useEffect(()=>{alive.current=true;try{const rows=readSaved();setSaved(rows);setSelected(rows[0]?.id??'');setStorageReady(true)}catch(reason){setError(reason instanceof Error?reason.message:'Saved history access is unavailable.')};return()=>{alive.current=false}},[])
 useEffect(()=>{const abort=new AbortController();request<BackgroundJobReadiness>('/api/background-jobs',{signal:abort.signal}).then(setReadiness).catch(()=>{if(!abort.signal.aborted)setError('Background indexing status could not be read. Retry when the connection returns.')});return()=>abort.abort()},[refresh])
 useEffect(()=>{
  const abort=new AbortController();let polling=false
  const poll=async()=>{
   if(polling||!saved.length)return;polling=true
   try{
    const values=await Promise.allSettled(saved.map(async ref=>({ref,result:await request<{job:JobSummary;receipts:HistoryReceipt[]}>(`/api/background-jobs/${ref.id}?offset=${ref.id===selected?offset:0}&limit=${ref.id===selected?10:1}`,{headers:{[HEADER]:ref.accessKey},signal:abort.signal})})))
    if(abort.signal.aborted)return
    const received:Record<string,JobSummary>={}
    for(const [index,value] of values.entries())if(value.status==='fulfilled'){received[value.value.ref.id]=value.value.result.job;if(value.value.ref.id===selected)setReceipts(value.value.result.receipts)}else if(saved[index].id===selected){setError(value.reason instanceof Error?value.reason.message:'Saved results could not be refreshed. Retry the connection.')}
    setJobs(previous=>({...previous,...received}))
   }finally{polling=false}
  }
  void poll();const timer=setInterval(()=>{void poll()},4000);return()=>{abort.abort();clearInterval(timer)}
 },[saved,selected,offset,refresh])
 const submit=async(ref?:SavedJob)=>{
  if(operation.current)return;operation.current=true;setBusy(true);setError('');setNotice('')
  try{
   const next=ref??await newSavedJob(mint.trim(),Number(limit))
   if(!ref){if(saved.length>=12)throw new Error('This browser already has 12 saved history indexes. Remove an old result before creating another.');const rows=[next,...saved];localStorage.setItem(STORAGE,JSON.stringify(rows));setSaved(rows);setSelected(next.id);setOffset(0)}
   const result=await request<{job:JobSummary}>('/api/background-jobs',{method:'POST',headers:{'content-type':'application/json',[HEADER]:next.accessKey},body:JSON.stringify(next.input)})
   if(alive.current){setJobs(previous=>({...previous,[next.id]:result.job}));setNotice('History indexing queued. It continues on the server when this browser closes.');setRefresh(value=>value+1)}
  }catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'The index could not be queued. Your saved request can be retried safely.')}
  finally{operation.current=false;if(alive.current)setBusy(false)}
 }
 const cancel=async(ref:SavedJob)=>{if(operation.current)return;operation.current=true;setBusy(true);setError('');try{const result=await request<{job:JobSummary}>(`/api/background-jobs/${ref.id}`,{method:'DELETE',headers:{[HEADER]:ref.accessKey}});if(alive.current){setJobs(previous=>({...previous,[ref.id]:result.job}));setNotice('Indexing cancelled. Saved receipts remain available.')}}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'Cancellation could not be confirmed. Retry to check the server state.')}finally{operation.current=false;if(alive.current)setBusy(false)}}
 const remove=(ref:SavedJob)=>{try{const job=jobs[ref.id];if(job?.state==='running'||job?.state==='queued')throw new Error('Cancel or finish this index before removing access to its results.');const rows=saved.filter(row=>row.id!==ref.id);localStorage.setItem(STORAGE,JSON.stringify(rows));setSaved(rows);setSelected(rows[0]?.id??'');setOffset(0);setReceipts([]);setError('');setNotice('This browser’s saved access was removed. Any server receipts expire after seven days.')}catch(reason){setError(reason instanceof Error?reason.message:'Saved access could not be removed.')}}
 const active=saved.find(row=>row.id===selected),job=selected?jobs[selected]:undefined
 return<section className={styles.panel} aria-labelledby="background-history-title">
  <div className={styles.heading}><div className={styles.icon}><Database size={20} aria-hidden="true"/></div><div><h2 id="background-history-title">Background history indexing</h2><p>Read confirmed token receipts while you’re away.</p></div><span className={styles.readOnly}>Read only</span></div>
  <p className={styles.explanation}>Choose a token and a bounded history window. This job runs on the server with no wallet connection, signatures or SOL spending.</p>
  {!readiness?<div className={styles.status} role="status"><LoaderCircle size={16} className={styles.spinning}/>Checking background service…</div>:!readiness.available?<div className={styles.unavailable}>{readiness.reason}</div>:null}
  <form className={styles.form} onSubmit={event=>{event.preventDefault();void submit()}}>
   <label className={styles.mint}>Token mint<Input value={mint} onChange={event=>setMint(event.target.value)} placeholder="Solana mint address" autoComplete="off" spellCheck={false} required disabled={busy}/></label>
   <label>History window<select value={limit} onChange={event=>setLimit(event.target.value)} disabled={busy}><option value="25">25 transactions</option><option value="100">100 transactions</option><option value="200">200 transactions</option><option value="500">500 transactions</option></select></label>
   <Button type="submit" disabled={busy||!storageReady||!readiness?.available||!mint.trim()}>{busy?<LoaderCircle size={16} className={styles.spinning}/>:<Database size={16}/>}Index history</Button>
  </form>
  <p className={styles.limit}>Mint-address RPC history only. This does not establish complete token history, all holders or complete profit and loss.</p>
  {error?<div role="alert" className={styles.error}>{error}<Button size="sm" variant="ghost" onClick={()=>{setError('');setRefresh(value=>value+1)}}><RefreshCw size={14}/>Retry connection</Button></div>:null}
  {notice?<p role="status" className={styles.notice}>{notice}</p>:null}
  {!!saved.length&&<div className={styles.workspace}><nav className={styles.jobs} aria-label="Saved history indexes">{saved.map(ref=>{const item=jobs[ref.id];return<button key={ref.id} type="button" aria-current={selected===ref.id?'true':undefined} onClick={()=>{setSelected(ref.id);setOffset(0);setReceipts([])}}><strong>{short(ref.input.mint)}</strong><span>{item?stage(item.state):'Saved request'} · {item?`${item.scanned} / `:''}{ref.input.maxTransactions}</span></button>})}</nav>
   <div className={styles.result} aria-live="polite">{active&&job?<>
    <div className={styles.resultHeading}><div><strong>{stage(job.state)}</strong><p>{job.scanned} of up to {job.maxTransactions} receipts scanned</p></div>{(job.state==='running'||job.state==='queued')?<Button variant="secondary" size="sm" disabled={busy} onClick={()=>void cancel(active)}><Square size={12}/>Cancel index</Button>:<Button variant="ghost" size="sm" onClick={()=>remove(active)}>Remove saved access</Button>}</div>
    <progress value={job.scanned} max={job.maxTransactions} aria-label="Receipts scanned"/>
    <div className={styles.coverage}><span><b>{job.coverage.read}</b> decoded</span><span><b>{job.coverage.missing}</b> unavailable</span><span><b>{job.coverage.unsupported+job.coverage.invalid}</b> unreadable</span><span><b>{job.coverage.failed}</b> failed on chain</span></div>
    {job.error?<p className={styles.error}>{job.error}</p>:null}
    <p className={styles.limit}>{job.rpcAddressExhausted?'The RPC returned no older mint-address signatures. Other token-account history may still exist.':job.state==='succeeded'?'The requested limit was reached. Older history was not scanned.':'Progress is checkpointed after every receipt.'} Results expire {new Date(job.expiresAt).toLocaleDateString()}.</p>
    {!!receipts.length&&<div className={styles.receipts}>{receipts.map(row=><a key={row.signature} href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer"><span>{short(row.signature)}</span><span>{row.status==='confirmed'?`${row.trades.length} observed trades`:row.status}</span><ArrowUpRight size={14}/></a>)}</div>}
    {job.scanned>10?<div className={styles.pagination}><Button size="sm" variant="ghost" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-10))}>Previous</Button><span>{offset+1}–{Math.min(offset+10,job.scanned)} of {job.scanned}</span><Button size="sm" variant="ghost" disabled={offset+10>=job.scanned} onClick={()=>setOffset(value=>value+10)}>Next</Button></div>:null}
   </>:active?<div className={styles.pending}><p>This request is saved. Retry safely if the connection interrupted its creation. Removing saved access does not cancel a server job.</p><Button size="sm" variant="secondary" disabled={busy||!readiness?.available} onClick={()=>void submit(active)}>Retry saved request</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>remove(active)}>Remove saved access</Button></div>:null}</div>
  </div>}
  <div className={styles.boundary}><strong>This history job does not sign trades.</strong><span>Browser sessions require an open tab. Dedicated automation wallets have their own separate funding, approvals and limits.</span><a href="/automation-wallets" className="text-link">Open dedicated automation</a></div>
  <p className={styles.storage}>Access to your read-only indexes is saved in this browser. Clearing site data removes that access. No wallet private keys are sent to this service.</p>
 </section>
}
