'use client'

import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useSearchParams} from 'next/navigation'
import {useConnection} from '@solana/wallet-adapter-react'
import {ArrowRight,ArrowUpRight,Check,Clock3,LockKeyhole,Pause,Radio,Repeat2,RotateCcw,ShieldCheck,TrendingUp,Wallet} from 'lucide-react'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {useLaunchStore} from '@/stores/launchStore'
import {useBundlerStore} from '@/stores/bundlerStore'
import {TradingSession} from '@/lib/tradingSessions/engine'
import {DEFAULT_SESSION_FORM,clearSessionDraft,readSessionDraft,restoreSessionDraft,saveSessionDraft,sessionConfigFromForm,sessionFormIssues,sessionModeUrl,type SessionForm} from '@/lib/tradingSessions/draft'
import {readSessionHistory} from '@/lib/tradingSessions/history'
import type {TradingSessionConfig,TradingSessionJournal} from '@/lib/tradingSessions/types'
import {readTradePending,type PendingTrade} from '@/lib/venues/tradeHistory'
import {reconcilePendingTrade} from '@/lib/venues/tradeRecovery'
import {formatRawBalance} from '@/lib/venues/trade'
import styles from './TradingSessions.module.css'

const modes=[{id:'dca',name:'Scheduled trades',description:'Space your buys or sells over time.',icon:Repeat2},{id:'cap',name:'SOL cap trigger',description:'Make one trade at your market-cap target.',icon:TrendingUp},{id:'new-launch',name:'Confirmed launch watch',description:'Buy matching launches after confirmation.',icon:Radio}] as const
const short=(address:string)=>`${address.slice(0,5)}…${address.slice(-5)}`
const sol=(lamports:string)=>formatRawBalance(lamports,9,9)
const fieldIds:Partial<Record<keyof SessionForm,string>>={mint:'session-mint',creator:'session-creator',keyword:'session-keyword',buySol:'session-buy',sellPercent:'session-sell',maxTrades:'session-count',intervalSeconds:'session-interval',durationSeconds:'session-duration',maxDebitSol:'session-budget',slippage:'session-slippage',priorityFeeSol:'session-priority',capSol:'session-cap'}
function FieldIssue({field,message}:{field:keyof SessionForm;message?:string}){return message?<p id={`${fieldIds[field]}-error`} className={styles.fieldError}>{message}</p>:null}

export function TradingSessionsContent({initialMode='dca'}:{initialMode?:TradingSessionConfig['mode']}={}){
 const {connection}=useConnection(),library=useWalletLibraryStore()
 const search=useSearchParams(),queryModes=search.getAll('mode'),requestedMode=queryModes.length===1&&['dca','cap','new-launch'].includes(queryModes[0])?queryModes[0] as SessionForm['mode']:undefined
 const [form,setForm]=useState<SessionForm>(()=>({...DEFAULT_SESSION_FORM,mode:initialMode})),[walletId,setWalletId]=useState(''),[approved,setApproved]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(''),[journal,setJournal]=useState<TradingSessionJournal|null>(null),[history,setHistory]=useState<TradingSessionJournal[]>([]),[pending,setPending]=useState<PendingTrade|null>(null),[checking,setChecking]=useState(false)
 const [draftReady,setDraftReady]=useState(false),[draftMessage,setDraftMessage]=useState('Restoring your public setup…'),[draftError,setDraftError]=useState(''),[touched,setTouched]=useState<Partial<Record<keyof SessionForm,boolean>>>({})
 const restored=useRef(false),lastRequestedMode=useRef(requestedMode)
 const alive=useRef(true),operation=useRef(false),controller=useRef<AbortController|null>(null),activeWallet=useRef<string|null>(null)
 const wallet=library.wallets.find(item=>item.id===walletId),unlocked=!!wallet&&library.unlockedIds.includes(walletId)
 const issues=sessionFormIssues(form),hasIssues=Object.keys(issues).length>0
 const fieldError=(field:keyof SessionForm)=>(touched[field]||(field==='intervalSeconds'&&form.mode==='new-launch'))?issues[field]:undefined
 const fieldValidation=(field:keyof SessionForm)=>({'aria-invalid':!!fieldError(field),'aria-describedby':fieldError(field)?`${fieldIds[field]}-error`:undefined,onBlur:()=>setTouched(previous=>({...previous,[field]:true}))})
 const persist=(next:SessionForm,nextWalletId:string)=>{try{saveSessionDraft({form:next,walletId:nextWalletId});setDraftError('');setDraftMessage('Public setup saved in this browser.')}catch(reason){setDraftError(reason instanceof Error?reason.message:'Setup could not be saved in this browser.')}}
 const edit=<K extends keyof SessionForm>(field:K,value:SessionForm[K])=>{const next={...form,[field]:value};setForm(next);setApproved(false);persist(next,walletId)}
 const chooseMode=(mode:SessionForm['mode'])=>{edit('mode',mode);window.history.replaceState(null,'',sessionModeUrl(window.location.href,mode))}
 const resetSetup=()=>{
  try{clearSessionDraft();setForm({...DEFAULT_SESSION_FORM,mode:form.mode});setApproved(false);setTouched({});setDraftError('');setDraftMessage('Saved setup reset. Your next edit will be saved.')}catch(reason){setDraftError(reason instanceof Error?reason.message:'Saved setup could not be reset.')}
 }
 const reviewFields=()=>{setTouched(Object.fromEntries(Object.keys(issues).map(field=>[field,true])));const first=Object.keys(issues)[0] as keyof SessionForm|undefined;if(first)document.getElementById(fieldIds[first]||'')?.focus()}
 const refresh=()=>{try{setHistory(readSessionHistory());setPending(readTradePending())}catch(reason){setError(reason instanceof Error?reason.message:'Public recovery storage is unavailable.')}}
 useEffect(()=>{
  alive.current=true;refresh()
  const changed=()=>refresh()
  window.addEventListener('storage',changed)
  const unsubscribe=useWalletLibraryStore.subscribe(state=>{if(activeWallet.current&&!state.getKeypair(activeWallet.current))controller.current?.abort()})
  return()=>{alive.current=false;controller.current?.abort();activeWallet.current=null;unsubscribe();window.removeEventListener('storage',changed)}
 },[])
 useEffect(()=>{
  if(!library.hydrated)return
  if(restored.current){if(running)return;if(requestedMode&&requestedMode!==lastRequestedMode.current){const next={...form,mode:requestedMode};setForm(next);setApproved(false);try{saveSessionDraft({form:next,walletId});setDraftError('');setDraftMessage('Public setup saved in this browser.')}catch(reason){setDraftError(reason instanceof Error?reason.message:'Setup could not be saved in this browser.')}}lastRequestedMode.current=requestedMode;return}
  restored.current=true
  try{
   const saved=readSessionDraft(),setup=restoreSessionDraft(saved,requestedMode??(saved?undefined:initialMode))
   setForm(setup.form)
   setWalletId(setup.walletId?(library.wallets.some(item=>item.id===setup.walletId)?setup.walletId:''):library.activeId||library.wallets[0]?.id||'')
   setDraftMessage(saved?'Saved public setup restored. Review and approve it to begin.':'Your public setup saves as you edit.')
  }catch(reason){setDraftError(reason instanceof Error?reason.message:'Saved setup could not be restored.');setWalletId(library.activeId||library.wallets[0]?.id||'')}
  setApproved(false);setDraftReady(true)
 },[library.hydrated,library.activeId,library.wallets,initialMode,requestedMode,running,form,walletId])
 useEffect(()=>{if(!unlocked)setApproved(false)},[unlocked])
 const arm=async()=>{
  if(operation.current)return
  setError('')
  try{
   if(!approved)throw new Error('Approve the complete session summary before arming.')
   if(!wallet)throw new Error('Choose a wallet from your library.')
   if(!useWalletLibraryStore.getState().getKeypair(walletId))throw new Error('Unlock the chosen wallet in Wallets first.')
   const config=sessionConfigFromForm(form,walletId,wallet.publicKey)
   operation.current=true;setRunning(true);setApproved(false);activeWallet.current=walletId
   const abort=new AbortController();controller.current=abort
   const session=new TradingSession(connection,config)
   const result=await session.run({approved:true,signal:abort.signal,
    readSigner:()=>useWalletLibraryStore.getState().getKeypair(config.walletId)?.publicKey.toBase58(),
    sign:async transaction=>{
     if(!alive.current||abort.signal.aborted)throw new Error('The browser session stopped before signing.')
     const key=useWalletLibraryStore.getState().getKeypair(config.walletId)
     if(!key||key.publicKey.toBase58()!==config.payer)throw new Error('The selected wallet locked or changed. Nothing was signed.')
     transaction.sign([key]);return transaction
    },
    assertAvailable:()=>{
     if(!alive.current)throw new Error('The session workspace closed. No new trades will be sent.')
     if(useLaunchStore.getState().isLoading||useBundlerStore.getState().isExecuting)throw new Error('Finish the active launch or bundle before running another trade.')
    },
    onChange:value=>{if(alive.current){setJournal(value);try{setPending(readTradePending())}catch{setError('Recovery storage cannot be read. Preserve browser data and check Manage token.')}}},
   })
   if(alive.current){setJournal(result);refresh()}
  }catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'The session could not be armed.')}
  finally{operation.current=false;activeWallet.current=null;controller.current=null;if(alive.current)setRunning(false)}
 }
 const recover=async()=>{
  if(operation.current||checking)return
  setChecking(true);setError('')
  try{const result=await reconcilePendingTrade(connection);if(alive.current){setPending(result.pending);if(result.error)setError(result.error);refresh()}}
  catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'The original signature could not be checked.')}
  finally{if(alive.current)setChecking(false)}
 }
 const current=journal||history[0],action=form.mode==='new-launch'?'buy':form.action,tradeCount=form.mode==='cap'?'1':form.maxTrades
 return <div className="min-h-screen flex flex-col"><Header/><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1"><div className="max-w-6xl mx-auto">
  <div className="page-heading"><div className="eyebrow">BOUNDED BROWSER SESSIONS</div><h1>Your rules.<br/>A measured next move.</h1><p>Schedule Pump.fun trades, set a SOL market-cap target, or watch for a matching confirmed launch.</p></div>
  <div className={`${styles.draftBar} ${draftError?styles.draftError:''}`}>
   <div className={styles.draftContent}><ShieldCheck size={18}/><div><strong>Your session setup</strong><p role="status" aria-live="polite">{draftError||draftMessage}</p><span>Public settings only. Every visit needs a fresh approval.</span></div></div>
   <div className={styles.draftActions}>{draftError&&<Button variant="secondary" size="sm" disabled={running||!draftReady} onClick={()=>persist(form,walletId)}>Retry saving</Button>}<Button variant="ghost" size="sm" disabled={running||!draftReady} onClick={resetSetup}><RotateCcw size={13}/>Reset setup</Button></div>
  </div>
  <div className={styles.modeGrid}>{modes.map(mode=>{const Icon=mode.icon;return <button key={mode.id} disabled={running||!draftReady} aria-pressed={form.mode===mode.id} className={`${styles.mode} ${form.mode===mode.id?styles.selected:''}`} onClick={()=>chooseMode(mode.id)}><Icon size={18}/><strong>{mode.name}</strong><span>{mode.description}</span></button>})}</div>
  <div className={styles.columns}><div className="space-y-6">
   <section className="form-section"><div className={styles.sectionHeading}><Wallet size={16}/><h2>Your library wallet</h2>{wallet&&<span className={`${styles.walletBadge} ${unlocked?styles.walletReady:''}`}>{unlocked?'Unlocked':'Locked'}</span>}</div>
    {library.hydrated&&!library.wallets.length?<div className={styles.walletPrompt}><strong>Add your signing wallet.</strong><p>Create or import a wallet in your library, then return here to review this session. Your public setup will be waiting.</p><Button asChild variant="secondary" size="sm"><Link href="/wallet-operations">Add a wallet<ArrowRight size={14}/></Link></Button></div>:<fieldset disabled={running||!draftReady}>
     <label className="field-label" htmlFor="session-wallet">Signing wallet</label><select id="session-wallet" className={styles.select} value={walletId} onChange={event=>{setWalletId(event.target.value);setApproved(false);persist(form,event.target.value)}}><option value="">Choose a wallet</option>{library.wallets.map(item=><option key={item.id} value={item.id}>{item.name} · {short(item.publicKey)}{library.unlockedIds.includes(item.id)?' · unlocked':' · locked'}</option>)}</select>
     {wallet&&<p className="field-help font-mono break-all">{wallet.publicKey}</p>}
     <p className="field-help">{!draftReady?'Loading your wallet library…':unlocked?'This wallet is ready to sign after you approve the session.':wallet?<>Unlock this wallet in <Link className="text-accent underline" href="/wallet-operations">Wallets</Link>, then return to approve your saved setup.</>:'Choose the library wallet that will sign and pay for these trades.'}</p>
     {wallet&&!unlocked&&<Link className="text-link mt-3" href="/wallet-operations">Unlock in Wallets<ArrowRight size={14}/></Link>}
    </fieldset>}
   </section>
   <section className="form-section"><div className={styles.sectionHeading}>{form.mode==='new-launch'?<Radio size={16}/>:<TrendingUp size={16}/>}<h2>{form.mode==='new-launch'?'Choose what to watch':'Choose your trade'}</h2></div><fieldset disabled={running||!draftReady} className="space-y-5">
    {form.mode==='new-launch'?<><div><label className="field-label" htmlFor="session-creator">Exact creator address</label><Input {...fieldValidation('creator')} id="session-creator" value={form.creator} autoComplete="off" onChange={event=>edit('creator',event.target.value.trim())} placeholder="Creator public address · optional"/><FieldIssue field="creator" message={fieldError('creator')}/></div><div><label className="field-label" htmlFor="session-keyword">Name or symbol keyword</label><Input {...fieldValidation('keyword')} id="session-keyword" value={form.keyword} autoComplete="off" maxLength={80} onChange={event=>edit('keyword',event.target.value)} placeholder="At least 3 characters · optional"/><FieldIssue field="keyword" message={fieldError('keyword')}/></div><p className="field-help">Set at least one filter. When both are set, both must match. The creator is checked against the on-chain curve before buying.</p><div className="notice">This watches a limited sample of recent confirmed transactions, refreshed about every 20 seconds. The first poll sets a baseline and makes no trades. It may miss launches and does not promise first-block access.</div></>:<><div><label className="field-label" htmlFor="session-mint">Pump.fun mint address</label><Input {...fieldValidation('mint')} id="session-mint" value={form.mint} onChange={event=>edit('mint',event.target.value.trim())} placeholder="An active SOL-quoted Pump.fun token" autoComplete="off"/><FieldIssue field="mint" message={fieldError('mint')}/></div><div className="launch-mode-tabs" role="group" aria-label="Session direction">{(['buy','sell'] as const).map(direction=><button key={direction} className={`launch-mode-tab ${form.action===direction?'selected':''}`} aria-pressed={form.action===direction} onClick={()=>edit('action',direction)}>{direction==='buy'?'Buy':'Sell'}</button>)}</div></>}
    {action==='buy'?<div><label className="field-label" htmlFor="session-buy">Maximum buy amount per trade · SOL</label><Input {...fieldValidation('buySol')} id="session-buy" maxLength={24} inputMode="decimal" value={form.buySol} onChange={event=>edit('buySol',event.target.value)}/><FieldIssue field="buySol" message={fieldError('buySol')}/><p className="field-help">Each buy also reserves the quoted network fee and up to 0.01 SOL for account rent inside your total session ceiling.</p></div>:<div><label className="field-label" htmlFor="session-sell">Sell % of the remaining token balance per trade</label><Input {...fieldValidation('sellPercent')} id="session-sell" type="number" min="1" max="100" step="1" value={form.sellPercent} onChange={event=>edit('sellPercent',event.target.value)}/><FieldIssue field="sellPercent" message={fieldError('sellPercent')}/><p className="field-help">Every sale recalculates this percentage from your current associated token balance. For example, two 50% sales leave about 25% of the starting balance.</p></div>}
    {form.mode==='cap'&&<><div className={styles.fieldPair}><div><label className="field-label" htmlFor="session-cap-direction">Trade when SOL market cap is</label><select id="session-cap-direction" className={styles.select} value={form.capDirection} onChange={event=>edit('capDirection',event.target.value as typeof form.capDirection)}><option value="at-or-above">At or above</option><option value="at-or-below">At or below</option></select></div><div><label className="field-label" htmlFor="session-cap">Market cap · SOL</label><Input {...fieldValidation('capSol')} id="session-cap" maxLength={24} value={form.capSol} inputMode="decimal" onChange={event=>edit('capSol',event.target.value)}/><FieldIssue field="capSol" message={fieldError('capSol')}/></div></div><p className="field-help">The trigger checks the observed on-chain SOL curve cap again before signing and sending. Prices can move before the transaction lands; your slippage setting still applies.</p></>}
   </fieldset></section>
   <section className="form-section"><div className={styles.sectionHeading}><Clock3 size={16}/><h2>Give this session limits</h2></div><fieldset disabled={running||!draftReady} className="space-y-5"><div className={styles.fieldPair}><div><label className="field-label" htmlFor="session-count">Maximum trades · 1–10</label><Input {...fieldValidation('maxTrades')} id="session-count" type="number" min="1" max="10" disabled={form.mode==='cap'} value={tradeCount} onChange={event=>edit('maxTrades',event.target.value)}/><FieldIssue field="maxTrades" message={fieldError('maxTrades')}/></div><div><label className="field-label" htmlFor="session-interval">{form.mode==='dca'?'Wait between trades':'Poll interval'} · seconds</label><Input {...fieldValidation('intervalSeconds')} id="session-interval" type="number" min={form.mode==='new-launch'?20:5} max="300" value={form.intervalSeconds} onChange={event=>edit('intervalSeconds',event.target.value)}/><FieldIssue field="intervalSeconds" message={fieldError('intervalSeconds')}/></div></div><div className={styles.fieldPair}><div><label className="field-label" htmlFor="session-duration">Stop after · seconds, up to 300</label><Input {...fieldValidation('durationSeconds')} id="session-duration" type="number" min="5" max="300" value={form.durationSeconds} onChange={event=>edit('durationSeconds',event.target.value)}/><FieldIssue field="durationSeconds" message={fieldError('durationSeconds')}/></div><div><label className="field-label" htmlFor="session-budget">Total wallet debit ceiling · SOL</label><Input {...fieldValidation('maxDebitSol')} id="session-budget" maxLength={24} inputMode="decimal" value={form.maxDebitSol} onChange={event=>edit('maxDebitSol',event.target.value)}/><FieldIssue field="maxDebitSol" message={fieldError('maxDebitSol')}/></div></div><p className="field-help">The ceiling includes buy amounts, fees and rent reserves. Sales reserve at least their network fee; sale proceeds never replenish the approved budget. The session may stop before its trade count when budget or time runs out.</p><div className={styles.fieldPair}><div><label className="field-label" htmlFor="session-slippage">Slippage · 0–50%</label><Input {...fieldValidation('slippage')} id="session-slippage" type="number" min="0" max="50" step="0.1" value={form.slippage} onChange={event=>edit('slippage',event.target.value)}/><FieldIssue field="slippage" message={fieldError('slippage')}/></div><div><label className="field-label" htmlFor="session-priority">Priority fee ceiling · SOL</label><Input {...fieldValidation('priorityFeeSol')} id="session-priority" type="number" min="0" max="0.01" step="0.00001" value={form.priorityFeeSol} onChange={event=>edit('priorityFeeSol',event.target.value)}/><FieldIssue field="priorityFeeSol" message={fieldError('priorityFeeSol')}/></div></div></fieldset></section>
  </div><aside className="space-y-6">
   <section className={`form-section ${styles.approval}`}>
    <div className="eyebrow">YOUR SESSION APPROVAL</div><h2 className="text-xl mt-3">Bounded from the start.</h2>
    <dl className={styles.summary}>
     <div><dt>Wallet</dt><dd>{wallet?.name||'Choose a wallet'}</dd></div>
     {form.mode==='new-launch'?<><div><dt>Creator filter</dt><dd>{form.creator?short(form.creator):'Any creator'}</dd></div><div><dt>Keyword filter</dt><dd>{form.keyword||'Any keyword'}</dd></div></>:<div><dt>Token</dt><dd>{form.mint?short(form.mint):'Choose a mint'}</dd></div>}
     {form.mode==='cap'&&<div><dt>SOL cap trigger</dt><dd>{form.capDirection==='at-or-above'?'≥':'≤'} {form.capSol} SOL</dd></div>}
     <div><dt>Trade limit</dt><dd>{tradeCount} {action}{tradeCount==='1'?'':'s'}</dd></div><div><dt>Per trade</dt><dd>{action==='buy'?`${form.buySol} SOL maximum`:`${form.sellPercent}% of remaining tokens`}</dd></div>
     <div><dt>Complete debit ceiling</dt><dd>{form.maxDebitSol} SOL</dd></div><div><dt>Time limit</dt><dd>{form.durationSeconds} seconds</dd></div><div><dt>{form.mode==='dca'?'Minimum wait':'Poll interval'}</dt><dd>{form.intervalSeconds} seconds</dd></div>
     <div><dt>Slippage</dt><dd>{form.slippage}%</dd></div><div><dt>Priority fee ceiling</dt><dd>{form.priorityFeeSol} SOL</dd></div>
    </dl>
    {!running&&<div className={styles.nextStep} aria-live="polite">
     {!draftReady?<p>Restoring your setup before approval…</p>:!wallet?<><strong>{library.wallets.length?'Choose a signing wallet':'Start with a library wallet'}</strong><p>{library.wallets.length?'Select the wallet for this session above.':'Add a wallet, then return to finish your saved session setup.'}</p></>:!unlocked?<><strong>Unlock your signing wallet</strong><p>Open Wallets and unlock {wallet.name} before approving this session.</p><Link className="text-link" href="/wallet-operations">Open Wallets<ArrowRight size={13}/></Link></>:pending?<><strong>Check your saved transaction first</strong><p>Resolve the original signature below before starting another session.</p></>:hasIssues?<><strong>Complete your trade settings</strong><p>Check the required addresses, amounts and session limits.</p><button className={styles.reviewButton} onClick={reviewFields}>Review {Object.keys(issues).length} {Object.keys(issues).length===1?'setting':'settings'}<ArrowRight size={13}/></button></>:<><strong className={styles.summaryReady}><Check size={14}/>Ready for your review</strong><p>Confirm the summary, then approve and arm this session.</p></>}
    </div>}
    <label className={styles.checkbox}><input type="checkbox" checked={approved} disabled={running||!draftReady||hasIssues||!unlocked||!!pending} onChange={event=>setApproved(event.target.checked)}/><span>I approve this wallet, these trade rules and the complete debit ceiling for this browser session.</span></label>
    {running?<Button className="w-full" variant="secondary" onClick={()=>controller.current?.abort()}><Pause size={15}/>Stop new trades</Button>:<Button className="w-full" onClick={()=>void arm()} disabled={!draftReady||hasIssues||!approved||!unlocked||!!pending||checking}>Arm session<ArrowRight size={16}/></Button>}
    <p className={styles.costNote}><strong>0% OutSol fee.</strong> Pump.fun fees, Solana network fees and account rent still apply within your approved ceiling.</p>
    <p className="field-help mt-4">Keep this page and browser open. Closing the page, locking the wallet or stopping cancels future broadcasts. Transactions already sent remain on chain.</p><div className={styles.smallNotice}><LockKeyhole size={14}/><span>The library locks after 15 minutes without keyboard or pointer activity. Sessions last at most 5 minutes and never rearm after reload.</span></div>
   </section>
   {error&&<p role="alert" className="notice notice-error">{error}</p>}
   {pending&&<section className="form-section"><div className="eyebrow">ORIGINAL SIGNATURE SAVED</div><h2 className="text-lg mt-3">Check this trade first.</h2><p className="field-help">Confirmation is still pending. New sessions stay blocked until it is resolved.</p><a className="text-link my-4" href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">View original transaction<ArrowUpRight size={14}/></a><Button className="w-full" variant="secondary" disabled={running||checking} onClick={()=>void recover()}>{checking?'Checking confirmation…':'Check saved signature'}</Button><Link className="text-link mt-4" href={`/manage?mint=${pending.mint}`}>Open Manage token<ArrowRight size={14}/></Link></section>}
   <section className="form-section" aria-live="polite"><div className={styles.sectionHeading}><ShieldCheck size={16}/><h2>{running?'Session in progress':'Public session progress'}</h2></div>{current?<><div className={styles.liveStatus}><span className={running?styles.pulse:styles.dot}/><strong>{current.status==='running'?current.phase:current.status}</strong><span>{current.rows.filter(row=>row.status==='confirmed').length}/{current.config.maxTrades} confirmed</span></div><p className="field-help">Reserved debit: {sol(current.reservedDebitLamports)} / {current.config.maxDebitSol} SOL</p>{current.lastCapLamports&&<p className="field-help">Last observed SOL market cap: {sol(current.lastCapLamports)} SOL</p>}{current.message&&<p className="notice mt-4">{current.message}</p>}<div className={styles.receipts}>{current.rows.map(row=><article key={`${current.id}-${row.index}`}><div><strong>Trade {row.index+1} · {row.action}</strong><span>{row.status}</span></div><Link href={`/manage?mint=${row.mint}`} className="font-mono text-xs text-muted">{short(row.mint)}</Link>{row.signature&&<a className="text-link" href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">Original transaction<ArrowUpRight size={13}/></a>}{row.error&&<p className="field-help">{row.error}</p>}</article>)}</div></>:<p className="text-sm text-muted leading-relaxed">Review a session above, then arm it to begin. Only public settings and transaction receipts are saved here.</p>}</section>
  </aside></div>
  {history.length>1&&<section className="form-section mt-7"><div className="eyebrow">PREVIOUS BROWSER SESSIONS</div><div className={styles.history}>{history.filter(item=>item.id!==current?.id).slice(0,5).map(item=><button key={item.id} disabled={running} onClick={()=>setJournal(item)}><span>{modes.find(mode=>mode.id===item.config.mode)?.name}<small>{new Date(item.armedAt).toLocaleString()}</small></span><span>{item.rows.filter(row=>row.status==='confirmed').length} confirmed · {item.status}</span></button>)}</div></section>}
 </div></main><Footer/></div>
}
