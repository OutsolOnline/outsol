'use client'

import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection,useWallet} from '@solana/wallet-adapter-react'
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui'
import {VersionedTransaction} from '@solana/web3.js'
import {ArrowDownToLine,Check,ExternalLink,Layers3,Loader2,Plus,RefreshCw,ShieldCheck,Split,Trash2,Wallet} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {formatRawBalance} from '@/lib/venues/trade'
import {parseExactUnits} from '@/lib/walletOperations/model'
import {creatorPercentBps,type CreatorOperationInput,type CreatorState} from '@/lib/creatorOperations/model'
import {inspectCreatorState} from '@/lib/creatorOperations/inspect'
import {prepareCreatorOperation,submitCreatorOperation,type PreparedCreatorOperation} from '@/lib/creatorOperations/engine'
import {CreatorLookupRequired} from '@/lib/creatorOperations/native'
import {readCreatorOperationHistory,readPendingCreatorOperation,type CreatorOperationReceipt,type PendingCreatorOperation} from '@/lib/creatorOperations/history'
import {reconcilePendingCreatorOperation} from '@/lib/creatorOperations/recovery'
import styles from './CreatorOperations.module.css'

type Kind='collect'|'distribute'|'shares'
const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-6)}`
const sol=(value:string)=>formatRawBalance(value,9,9)
const description=(kind:string)=>kind==='lookup'?'Account lookup setup':kind==='shares'?'Permanent fee split finalization':kind==='distribute'?'Shared fee distribution':'Creator wallet collection'
const message=(value:unknown)=>value instanceof Error?value.message:'Creator operations are temporarily unavailable.'

export function CreatorOperationsPanel({mint}:{mint:string}){
 const {connection}=useConnection(),external=useWallet(),vault=usePlatformWalletStore(),library=useWalletLibraryStore(),id=useId()
 const [source,setSource]=useState<'external'|'vault'>('external'),[kind,setKind]=useState<Kind>('collect'),[chain,setChain]=useState<CreatorState|null>(null)
 const [shares,setShares]=useState([{address:'',percent:'100'}]),[priority,setPriority]=useState('0.0001'),[lookupTable,setLookupTable]=useState(''),[lookupNeed,setLookupNeed]=useState<string[]|null>(null)
 const [review,setReview]=useState<PreparedCreatorOperation|null>(null),[approved,setApproved]=useState(false),[pending,setPending]=useState<PendingCreatorOperation|null>(null),[history,setHistory]=useState<CreatorOperationReceipt[]>([])
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[storageError,setStorageError]=useState('')
 const alive=useRef(true),controller=useRef<AbortController|null>(null),operation=useRef(false),epoch=useRef(0),signing=useRef({source,payer:'' as string|null})
 const selected=vault.getSelectedAddress(),payer=source==='external'?external.publicKey?.toBase58()??null:selected,canSign=source==='external'?!!external.signTransaction&&!!payer:!!vault.getKeypair()&&!library.storageUnavailable&&!vault.storageUnavailable
 useLayoutEffect(()=>{signing.current={source,payer}},[source,payer])
 const readSigner=()=>{if(signing.current.source!==source||signing.current.payer!==payer)return null;return source==='vault'?usePlatformWalletStore.getState().getPublicKey():external.wallet?.adapter.publicKey?.toBase58()}
 const resetReview=()=>{setReview(null);setApproved(false);setLookupNeed(null);setError('');setNotice('')}
 const readJournal=useCallback(()=>{
  const current=readPendingCreatorOperation(),receipts=readCreatorOperationHistory();setPending(current);setHistory(receipts.filter(row=>row.intent.input.mint===mint));setStorageError('')
  return{pending:current,receipts}
 },[mint])
 const load=useCallback(async()=>{
  const generation=++epoch.current;setLoading(true);setError('')
  try{readJournal();const value=await inspectCreatorState(connection,mint);if(alive.current&&generation===epoch.current)setChain(value)}
  catch(value){if(alive.current&&generation===epoch.current){setError(message(value));setChain(null)}}
  finally{if(alive.current&&generation===epoch.current)setLoading(false)}
 },[connection,mint,readJournal])
 useEffect(()=>{alive.current=true;usePlatformWalletStore.getState().hydrateWallet();useWalletLibraryStore.getState().hydrate();return()=>{alive.current=false;controller.current?.abort()}},[])
 useEffect(()=>{controller.current?.abort();setChain(null);setReview(null);setApproved(false);setLookupNeed(null);setLookupTable('');setNotice('');setError('');setShares([{address:'',percent:'100'}]);void load();try{const data=readJournal(),lookup=data.receipts.find(row=>row.status==='confirmed'&&row.intent.input.mint===mint&&row.intent.input.kind==='lookup');if(lookup?.intent.lookupAddress)setLookupTable(lookup.intent.lookupAddress)}catch(value){setStorageError(message(value))}},[mint,load,readJournal])
 useEffect(()=>{controller.current?.abort();setReview(null);setApproved(false);setLookupNeed(null)},[payer,source,kind,priority,lookupTable,shares])
 useEffect(()=>{
  const changed=(event:StorageEvent)=>{if(event.key?.includes('creator-operation')){controller.current?.abort();setReview(null);setApproved(false);try{readJournal()}catch(value){setStorageError(message(value))}}}
  window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed)
 },[readJournal])
 const prepare=async(setup=false)=>{
  if(operation.current)return
  operation.current=true;controller.current=new AbortController();const abort=controller.current;setBusy(true);setError('');setNotice('');setReview(null);setApproved(false);setPhase('Preparing a native simulation…')
  try{
   if(!payer||!canSign)throw new Error('Connect or unlock the wallet you want to use.')
   const base={version:1 as const,mint,payer,priorityFeeLamports:parseExactUnits(priority,9,true).toString()}
   const input:CreatorOperationInput=setup?{...base,kind:'lookup',addresses:lookupNeed??[]}:{...base,kind,...(kind==='shares'?{shares:shares.map(row=>({address:row.address.trim(),shareBps:creatorPercentBps(row.percent)}))}:{}),...(lookupTable?{lookupTable:lookupTable.trim()}:{})} as CreatorOperationInput
   const prepared=await prepareCreatorOperation(connection,input,{readSigner,signal:abort.signal})
   if(!alive.current||abort.signal.aborted)throw new Error('The creator preview was cancelled.')
   setReview(prepared);setChain(prepared.state);setLookupNeed(null)
  }catch(value){if(alive.current){if(value instanceof CreatorLookupRequired){setLookupNeed(value.addresses);setError('')}else setError(message(value))}}
  finally{operation.current=false;if(alive.current){setBusy(false);setPhase('')}}
 }
 const sign=async()=>{
  if(operation.current||!review||!approved)return
  operation.current=true;controller.current=new AbortController();const abort=controller.current,selectedReview=review;setBusy(true);setError('');setNotice('');setPhase('Approve the reviewed operation in your wallet…')
  try{
   const result=await submitCreatorOperation(connection,selectedReview,{approved:true,readSigner,signal:abort.signal,signTransaction:async transaction=>{
    if(!alive.current||abort.signal.aborted)throw new Error('The creator operation was cancelled before signing.')
    const signed=source==='vault'?await usePlatformWalletStore.getState().signTransaction(transaction):await external.signTransaction!(transaction)
    if(!(signed instanceof VersionedTransaction))throw new Error('The wallet returned an unsupported transaction.')
    return signed
   },onPending:record=>{if(alive.current){setPending(record);setPhase('Confirming the saved original signature…')}}})
   if(alive.current){
    readJournal();setReview(null);setApproved(false)
    if(result.status==='confirmed'){
     if(selectedReview.intent.input.kind==='lookup'){setLookupTable(selectedReview.intent.lookupAddress!);setNotice('Account lookup setup confirmed. Wait for the next confirmed slot, then prepare a fresh operation review.')}
     else setNotice(`${description(selectedReview.intent.input.kind)} confirmed on Solana.`)
     void load()
    }else setError(result.error||'The original operation needs a confirmation check. Nothing will be resent automatically.')
   }
  }catch(value){if(alive.current){setError(message(value));setReview(null);setApproved(false);try{readJournal()}catch(storage){setStorageError(message(storage))}}}
  finally{operation.current=false;if(alive.current){setBusy(false);setPhase('')}}
 }
 const recover=async()=>{
  if(operation.current)return
  operation.current=true;setBusy(true);setError('');setPhase('Checking the original signature…')
  try{const result=await reconcilePendingCreatorOperation(connection);if(alive.current){readJournal();if(result.receipt?.status==='confirmed'&&result.receipt.intent.lookupAddress)setLookupTable(result.receipt.intent.lookupAddress);if(result.error)setError(result.error);else if(result.status==='confirmed'){setNotice('The original creator operation is confirmed.');void load()}}}
  catch(value){if(alive.current)setError(message(value))}
  finally{operation.current=false;if(alive.current){setBusy(false);setPhase('')}}
 }
 const choose=(value:Kind)=>{resetReview();setKind(value);if(value==='shares'&&chain)setShares(chain.sharing?chain.sharing.shareholders.map(row=>({address:row.address,percent:String(row.shareBps/100)})):[{address:chain.creator,percent:'100'}])}
 const total=shares.reduce((sum,row)=>{try{return sum+creatorPercentBps(row.percent)}catch{return sum}},0),blocked=!!pending||!!storageError
 const authority=chain?.sharing?.admin??chain?.creator,editable=!!chain&&!chain.holderReward&&(!chain.sharing||chain.sharing.version===2&&!chain.sharing.adminRevoked)
 return <section className={styles.panel} aria-labelledby={`${id}-title`}>
  <header className={styles.heading}><div><div className={styles.eyebrow}>CREATOR OPERATIONS · 0% OUTSOL FEE</div><h2 id={`${id}-title`}>Rewards, under your control.</h2><p>Inspect creator rewards, distribute shared fees and finalize a supported permanent fee split.</p></div><Button variant="secondary" size="sm" disabled={busy||loading} onClick={()=>{resetReview();void load()}}><RefreshCw size={14} className={loading?'animate-spin':''}/>Refresh</Button></header>
  {loading?<div className={styles.loading} role="status"><Loader2 size={18} className="animate-spin"/>Reading confirmed creator accounts…</div>:chain&&<div className={styles.facts}><div><span>{chain.sharing?'Shared creator vaults':'Creator wallet vaults · all tokens'}</span><strong>{sol(chain.vaultBalanceLamports)} <small>SOL</small></strong></div><div><span>Accruing on this token · curve + pool</span><strong>{sol((BigInt(chain.curveFeeLamports)+BigInt(chain.pool?.feeLamports??'0')).toString())} <small>SOL</small></strong></div><div><span>Snapshot</span><strong className={styles.slot}>Slot {chain.slot.toLocaleString()}</strong><small>{new Date(chain.checkedAt).toLocaleTimeString()}</small></div></div>}
  {chain?.holderReward&&<div className={styles.notice}><ShieldCheck size={17}/><p>This token permanently routes creator fees to holder rewards. Pump’s distribution authority controls payouts; your wallet cannot sign for it. <a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer">Open Pump.fun <ExternalLink size={12}/></a></p></div>}
  {storageError&&<p role="alert" className={styles.error}>{storageError}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.success}><Check size={16}/>{notice}</p>}
  {pending&&<section className={styles.pending} aria-label="Creator operation awaiting confirmation"><div className={styles.eyebrow}>SAVED ORIGINAL · CONFIRMATION CHECK</div><h3>{description(pending.intent.input.kind)}</h3><p>{pending.intent.input.mint===mint?'This operation may already have landed.':'An operation for another token is unresolved.'} Nothing is resent automatically.</p><a className={styles.address} href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">{pending.signature}<ExternalLink size={13}/></a><Button variant="secondary" disabled={busy} onClick={recover}><RefreshCw size={14}/>Check confirmation</Button></section>}
  <div className={styles.layout}><div className={styles.controls}>
   <fieldset disabled={busy||blocked}><legend className={styles.label}>Signing wallet</legend><div className={styles.tabs} role="group" aria-label="Creator operation signing source"><button type="button" aria-pressed={source==='external'} onClick={()=>setSource('external')}>Connected wallet</button><button type="button" aria-pressed={source==='vault'} onClick={()=>setSource('vault')}>Encrypted library</button></div><div className={styles.wallet}><Wallet size={16}/><div><strong>{payer?short(payer):'Choose a wallet'}</strong><span>{source==='vault'?(canSign?'Selected library wallet is unlocked':'Select and unlock a wallet in Wallets'):'Your wallet approves this one transaction'}</span></div>{source==='external'?<WalletMultiButton/>:<Link href="/wallets" className="text-link">Open wallets <ExternalLink size={12}/></Link>}</div></fieldset>
   <fieldset disabled={busy||blocked||loading||!chain||chain.holderReward}><legend className={styles.label}>Operation</legend><div className={styles.actions} role="group" aria-label="Creator operation"><button type="button" aria-pressed={kind==='collect'} onClick={()=>choose('collect')}><ArrowDownToLine size={17}/><strong>Collect</strong><span>Creator wallet vaults</span></button><button type="button" aria-pressed={kind==='distribute'} onClick={()=>choose('distribute')} disabled={!chain?.sharing}><Split size={17}/><strong>Distribute</strong><span>Current on-chain shares</span></button><button type="button" aria-pressed={kind==='shares'} onClick={()=>choose('shares')} disabled={!editable}><Layers3 size={17}/><strong>{chain?.sharing?'Finalize split':'Set up split'}</strong><span>Future creator fees</span></button></div></fieldset>
   {kind==='collect'&&<p className={styles.help}>Collection covers this creator wallet’s SOL vaults across Pump.fun and Pump AMM, including other tokens. This token’s outstanding fees are swept where the wallet is the creator. Protocol rewards, fees and rent are simulated before review.</p>}
   {kind==='distribute'&&<p className={styles.help}>Pay the current on-chain recipients. This distributes shared rewards; an escrow recipient may still need to claim through Pump.fun. Your wallet pays network fees and any required account rent.</p>}
   {chain?.sharing&&<details className={styles.details}><summary>Current fee recipients · {chain.sharing.shareholders.length}</summary><p>{chain.sharing.version===1||chain.sharing.adminRevoked?'Immutable fee distribution':'Administrator can finalize the split once'}</p><a className={styles.address} href={`https://solscan.io/account/${chain.sharing.admin}`} target="_blank" rel="noreferrer">Administrator · {short(chain.sharing.admin)}<ExternalLink size={12}/></a>{chain.sharing.shareholders.map(row=><div className={styles.currentShare} key={row.address}><span>{row.shareBps/100}%</span><a href={`https://solscan.io/account/${row.address}`} target="_blank" rel="noreferrer">{short(row.address)}<ExternalLink size={11}/></a></div>)}</details>}
   {kind==='shares'&&<fieldset disabled={busy||blocked||!editable} className={styles.shareEditor}><legend className={styles.label}>Future fee recipients</legend><p className={styles.help}>Use one to ten ordinary wallet addresses. Percentages must total exactly 100%. A charity wallet address is accepted as entered; OutSol does not verify a charity’s identity.</p>{shares.map((row,index)=><div className={styles.shareRow} key={index}><label htmlFor={`${id}-address-${index}`}>Recipient {index+1}<Input id={`${id}-address-${index}`} aria-label={`Recipient ${index+1} address`} maxLength={44} autoComplete="off" spellCheck={false} value={row.address} onChange={event=>{resetReview();setShares(previous=>previous.map((item,i)=>i===index?{...item,address:event.target.value.trim()}:item))}} placeholder="Solana wallet address"/></label><label htmlFor={`${id}-share-${index}`}>Share · %<Input id={`${id}-share-${index}`} aria-label={`Recipient ${index+1} percentage`} maxLength={6} inputMode="decimal" value={row.percent} onChange={event=>{resetReview();setShares(previous=>previous.map((item,i)=>i===index?{...item,percent:event.target.value}:item))}}/></label><button type="button" aria-label={`Remove recipient ${index+1}`} disabled={shares.length===1} onClick={()=>{resetReview();setShares(previous=>previous.filter((_,i)=>i!==index))}}><Trash2 size={16}/></button></div>)}<div className={styles.shareFoot}><button type="button" className="text-link" disabled={shares.length>=10} onClick={()=>{resetReview();setShares(previous=>[...previous,{address:'',percent:''}])}}><Plus size={14}/>Add recipient</button><span className={total===10000?styles.complete:styles.incomplete}>{total/100}% / 100%</span></div><p className={styles.help}>{chain?.sharing?'Pending rewards are paid to current recipients before the split changes.':'Setting up sharing moves the on-chain creator destination into this token’s sharing account.'} Pump automatically revokes the administrator after this final assignment. The resulting recipient addresses and percentages cannot be changed.</p>{authority&&<p className={styles.help}>Required administrator · <span className={styles.mono}>{short(authority)}</span></p>}</fieldset>}
   <details className={styles.details}><summary>Execution settings</summary><fieldset disabled={busy||blocked}><label className={styles.field} htmlFor={`${id}-priority`}>Maximum priority fee · SOL<Input id={`${id}-priority`} value={priority} inputMode="decimal" maxLength={24} onChange={event=>{resetReview();setPriority(event.target.value)}}/></label><label className={styles.field} htmlFor={`${id}-lookup`}>Account lookup table · optional<Input id={`${id}-lookup`} value={lookupTable} maxLength={44} spellCheck={false} autoComplete="off" onChange={event=>{resetReview();setLookupTable(event.target.value.trim())}} placeholder="Used for larger fee distributions"/></label><p className={styles.help}>Lookup tables store public account addresses only. A larger operation can offer a separately reviewed setup with account rent.</p></fieldset></details>
   {lookupNeed&&<div className={styles.lookup}><Layers3 size={18}/><div><h3>Prepare the public account list</h3><p>This operation needs a lookup table for {lookupNeed.length} public accounts. Review its rent and network cost first, then approve a fresh fee-operation preview.</p><Button variant="secondary" disabled={busy||blocked||!canSign} onClick={()=>void prepare(true)}>Preview lookup setup</Button></div></div>}
   <div className={styles.buttons}><Button variant="secondary" disabled={busy||blocked||loading||!chain||!canSign||chain.holderReward} onClick={()=>void prepare()}><ShieldCheck size={16}/>Preview {kind==='shares'?'fee split':kind==='distribute'?'distribution':'collection'}</Button>{busy&&<Button variant="ghost" onClick={()=>controller.current?.abort()}>Stop pending actions</Button>}</div>
  </div><aside className={styles.review} aria-label="Creator operation review"><div className={styles.eyebrow}>REVIEW BEFORE YOU SIGN</div><h3>{review?description(review.intent.input.kind):'Every account. Every cost.'}</h3><p className={styles.help}>Native Pump instructions, a fresh signed simulation and a saved original signature. Nothing is sent while preparing.</p><dl><div><dt>OutSol fee</dt><dd className={styles.complete}>0 SOL</dd></div><div><dt>Wallet</dt><dd>{payer?short(payer):'Connect or unlock'}</dd></div>{review&&<><div><dt>Scope</dt><dd>{review.intent.scope==='wallet-wide'?'Wallet-wide creator vaults':'This token'}</dd></div><div><dt>Simulated wallet {BigInt(review.preview.payerAfterLamports)>=BigInt(review.preview.payerBeforeLamports)?'credit':'debit'}</dt><dd>{sol((BigInt(review.preview.payerAfterLamports)-BigInt(review.preview.payerBeforeLamports)).toString().replace('-',''))} SOL</dd></div><div><dt>Included network fee</dt><dd>{sol(review.preview.networkFeeLamports)} SOL</dd></div>{review.preview.lookupRentLamports!=='0'&&<div><dt>Included table rent</dt><dd>{sol(review.preview.lookupRentLamports)} SOL</dd></div>}{review.preview.existingWrappedSolLamports!=='0'&&<div><dt>Existing wrapped SOL unwrapped</dt><dd>{sol(review.preview.existingWrappedSolLamports)} SOL</dd></div>}</>}</dl>
   {review&&<><p className={styles.help}>The wallet change includes network fees and account rent. Existing wrapped SOL, when shown, is your existing balance and is not new creator earnings. This preview expires after 60 seconds.</p>{review.intent.input.kind==='shares'&&<div className={styles.reviewShares}>{review.intent.input.shares.map(row=><div key={row.address}><strong>{row.shareBps/100}%</strong><span className={styles.mono}>{short(row.address)}</span></div>)}</div>}<label className={styles.approval}><input type="checkbox" checked={approved} disabled={busy||blocked} onChange={event=>setApproved(event.target.checked)}/><span>{review.intent.input.kind==='shares'?'I reviewed the signing wallet, final recipients, percentages and costs. I understand Pump will permanently revoke the administrator and this split cannot be changed.':'I reviewed the wallet, scope, recipients and costs. Sign this one operation.'}</span></label><Button className="w-full" disabled={!approved||busy||blocked||!canSign} onClick={sign}>{busy?<Loader2 size={16} className="animate-spin"/>:<ShieldCheck size={16}/>}Sign & {review.intent.input.kind==='lookup'?'set up':review.intent.input.kind==='shares'?'finalize split':review.intent.input.kind==='distribute'?'distribute':'collect'}</Button></>}
   {busy&&<p role="status" className={styles.phase}>{phase}</p>}
  </aside></div>
  {history.length>0&&<details className={styles.details}><summary>Saved creator-operation receipts · {history.length}</summary><p className={styles.help}>Public receipts on this device. This is not a complete chain history.</p>{history.slice(0,6).map(row=><article key={row.signature} className={styles.receipt}><div><strong>{description(row.intent.input.kind)}</strong><span>{row.status} · {new Date(row.resolvedAt).toLocaleString()}</span></div><a href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12}/></a></article>)}</details>}
 </section>
}
