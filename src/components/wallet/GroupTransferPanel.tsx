'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection,useWallet} from '@solana/wallet-adapter-react'
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui'
import {VersionedTransaction} from '@solana/web3.js'
import {ArrowDownLeft,ArrowRight,ArrowUpRight,Check,ExternalLink,KeyRound,Loader2,RefreshCw,ShieldCheck,Square} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {useBundlerStore} from '@/stores/bundlerStore'
import {readPending} from '@/lib/launchHistory'
import {readTradePending} from '@/lib/venues/tradeHistory'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {formatUnits} from '@/lib/walletOperations/model'
import {prepareGroupOperation} from '@/lib/walletGroups/prepare'
import {submitReviewedGroupOperation} from '@/lib/walletGroups/submission'
import {reconcilePendingGroupOperation} from '@/lib/walletGroups/recovery'
import {assertNoPendingGroupOperation,readPendingGroupOperation,readGroupOperationHistory} from '@/lib/walletGroups/history'
import type {GroupWallet,PreparedGroupOperation,GroupOperationRecord} from '@/lib/walletGroups/types'
import styles from './GroupTransferPanel.module.css'
const sol=(raw:string)=>`${formatUnits(raw,9)} SOL`
const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-6)}`
interface Props{wallets:GroupWallet[];groupId?:string;groupName:string;onBusyChange?:(busy:boolean)=>void;onDone?:()=>void;onUnlock?:(ids:string[])=>void}
export function GroupTransferPanel({wallets,groupId,groupName,onBusyChange,onDone,onUnlock}:Props){
 const {connection}=useConnection(),external=useWallet(),vault=usePlatformWalletStore(),library=useWalletLibraryStore()
 const [kind,setKind]=useState<'fund'|'withdraw'>('fund'),[source,setSource]=useState<'vault'|'external'>('vault'),[amount,setAmount]=useState('0.01'),[priority,setPriority]=useState('0.00001')
 const [destination,setDestination]=useState(''),[amountMode,setAmountMode]=useState<'available'|'fixed'>('available'),[reserve,setReserve]=useState('0')
 const [prepared,setPrepared]=useState<PreparedGroupOperation|null>(null),[approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[storageBlocked,setStorageBlocked]=useState(false)
 const [pending,setPending]=useState<GroupOperationRecord|null>(null),[record,setRecord]=useState<GroupOperationRecord|null>(null),[history,setHistory]=useState<GroupOperationRecord[]>([])
 const mounted=useRef(true),operation=useRef(false),controller=useRef<AbortController|null>(null),sourceRef=useRef(source),externalRef=useRef(external.wallet?.adapter),reviewEpoch=useRef(0)
 const payer=source==='vault'?vault.getPublicKey()||vault.getSelectedAddress():external.publicKey?.toBase58(),walletSignature=wallets.map(value=>`${value.id}:${value.address}`).join('|')
 useEffect(()=>{sourceRef.current=source;externalRef.current=external.wallet?.adapter},[source,external.wallet?.adapter])
 const refreshRecords=()=>{try{setPending(readPendingGroupOperation());setHistory(readGroupOperationHistory());setStorageBlocked(false)}catch(e){setStorageBlocked(true);setError(e instanceof Error?e.message:'Group recovery data cannot be read. Preserve this browser’s data.')}}
 useEffect(()=>{mounted.current=true;refreshRecords();window.addEventListener('storage',refreshRecords);return()=>{mounted.current=false;controller.current?.abort();window.removeEventListener('storage',refreshRecords)}},[]) // Recovery records outlive this view.
 useEffect(()=>{reviewEpoch.current++;setPrepared(null);setApproved(false)},[walletSignature,groupId,payer])
 useEffect(()=>{onBusyChange?.(busy||!!pending||storageBlocked)},[busy,pending,storageBlocked,onBusyChange])
 const reset=()=>{reviewEpoch.current++;setPrepared(null);setApproved(false);setError('')}
 const otherAvailable=()=>{if(!mounted.current)throw new Error('The group operation screen was closed. No further transfers will be sent.');if(readPending()||readTradePending())throw new Error('Check the pending launch or trade in Activity before moving group funds.');assertNoPendingWalletOperation();assertNoPendingBundleReceipt();if(useBundlerStore.getState().isExecuting)throw new Error('Finish the active bundle before moving group funds.')}
 const isUnlocked=(address:string)=>{const state=useWalletLibraryStore.getState(),wallet=state.wallets.find(value=>value.publicKey===address);return !!(wallet&&state.getKeypair(wallet.id))}
 const canSign=(address:string)=>{
  if(kind==='withdraw')return isUnlocked(address)
  if(sourceRef.current==='vault')return usePlatformWalletStore.getState().getPublicKey()===address
  return externalRef.current?.publicKey?.toBase58()===address&&!!external.signTransaction
 }
 const signTransaction=async(address:string,transaction:VersionedTransaction)=>{
  if(!canSign(address))throw new Error('A signing wallet changed or locked. Unlock it and prepare a fresh group preview.')
  if(kind==='fund'&&sourceRef.current==='external'){if(!external.signTransaction)throw new Error('Connect a wallet that can sign.');return external.signTransaction(transaction)}
  const state=useWalletLibraryStore.getState(),wallet=state.wallets.find(value=>value.publicKey===address),key=wallet?state.getKeypair(wallet.id):usePlatformWalletStore.getState().getKeypair()
  if(!key||key.publicKey.toBase58()!==address)throw new Error('The reviewed signing wallet is unavailable.')
  transaction.sign([key]);return transaction
 }
 const prepare=async()=>{
  if(operation.current)return;operation.current=true;const epoch=++reviewEpoch.current;setBusy(true);setError('');setPrepared(null);setApproved(false);setRecord(null)
  try{otherAvailable();assertNoPendingGroupOperation();if(kind==='fund'&&!payer)throw new Error('Choose and unlock a funding wallet, or connect an external wallet.');const base={groupId,groupName,wallets,priorityFeeSol:priority};const next=await prepareGroupOperation(connection,kind==='fund'?{...base,kind,payer:payer!,amountSol:amount}:{...base,kind,destination,amountMode,amountSol:amount,reserveSol:reserve});if(!mounted.current)return;if(reviewEpoch.current!==epoch)throw new Error('The wallet selection changed while preparing. Review a fresh group preview.');otherAvailable();assertNoPendingGroupOperation();setPrepared(next)}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The group operation could not be prepared.')}finally{operation.current=false;if(mounted.current)setBusy(false)}
 }
 const submit=async()=>{
  if(operation.current||!prepared||!approved||!prepared.transactions.length)return;operation.current=true;controller.current=new AbortController();setBusy(true);setSubmitting(true);setError('')
  try{const result=await submitReviewedGroupOperation(connection,prepared,{approved,canSign,signTransaction,assertAvailable:otherAvailable,signal:controller.current.signal,onProgress:value=>{if(mounted.current){setRecord(value);setPending(value.status==='running'||value.status==='unknown'?value:null)}}});if(mounted.current){setRecord(result);setPrepared(null);setApproved(false);refreshRecords();onDone?.()}}
  catch(e){if(mounted.current){setError(e instanceof Error?e.message:'The group operation stopped. Check the saved record before making another transfer.');setPrepared(null);setApproved(false);refreshRecords();onDone?.()}}finally{operation.current=false;controller.current=null;if(mounted.current){setBusy(false);setSubmitting(false)}}
 }
 const reconcile=async()=>{
  if(operation.current)return;operation.current=true;setBusy(true);setError('')
  try{const result=await reconcilePendingGroupOperation(connection);if(mounted.current){setRecord(result);refreshRecords();onDone?.()}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Group confirmation could not be checked.')}finally{operation.current=false;if(mounted.current)setBusy(false)}
 }
 const blocked=busy||!!pending||storageBlocked,tooMany=wallets.length>20
 const allReady=prepared?.transactions.every(value=>kind==='withdraw'?library.wallets.some(wallet=>wallet.publicKey===value.intent.payer&&library.unlockedIds.includes(wallet.id)):source==='vault'?vault.getPublicKey()===value.intent.payer:external.publicKey?.toBase58()===value.intent.payer&&!!external.signTransaction)??false
 return <section className="workspace-card"><div className="flex flex-wrap gap-4 items-start justify-between"><div><h2 className="text-xl">Group funds</h2><p className="text-sm text-muted mt-2">{groupName} · {wallets.length} wallets. Review every transfer before signing.</p></div>{kind==='withdraw'&&onUnlock&&<Button variant="secondary" disabled={blocked||tooMany} onClick={()=>onUnlock(wallets.map(value=>value.id))}><KeyRound size={15}/>Unlock group</Button>}</div>
  {tooMany&&<p className="notice mt-5">Choose a named group with up to 20 wallets for a group operation.</p>}
  <div className="launch-mode-tabs mt-6" role="group" aria-label="Group operation"><button className={`launch-mode-tab ${kind==='fund'?'selected':''}`} disabled={blocked} aria-pressed={kind==='fund'} onClick={()=>{setKind('fund');reset()}}><ArrowDownLeft size={16}/>Fund group</button><button className={`launch-mode-tab ${kind==='withdraw'?'selected':''}`} disabled={blocked} aria-pressed={kind==='withdraw'} onClick={()=>{setKind('withdraw');reset()}}><ArrowUpRight size={16}/>Withdraw group</button></div>
  <fieldset disabled={blocked||tooMany} className={`${styles.settings} mt-6`}>
   {kind==='fund'?<><div className={styles.full}><label className="field-label" htmlFor="group-funding-source">Funding wallet</label><select id="group-funding-source" value={source} onChange={e=>{sourceRef.current=e.target.value as typeof source;setSource(e.target.value as typeof source);reset()}}><option value="vault">Active local wallet{library.getActiveWallet()?` · ${library.getActiveWallet()!.name}`:''}</option><option value="external">Connected external wallet</option></select>{source==='external'?<div className="mt-3"><WalletMultiButton/></div>:<p className="field-help">Choose the active signer in the wallet list above. {vault.getPublicKey()?'Local signer unlocked.':'Unlock it before signing.'}</p>}{payer&&<p className="font-mono text-xs text-muted break-all mt-2">{payer}</p>}</div><div><label className="field-label" htmlFor="group-amount">SOL per wallet</label><Input id="group-amount" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);reset()}}/><p className="field-help">Each eligible group member receives this amount. The funder pays network fees separately.</p></div></>:<><div className={styles.full}><label className="field-label" htmlFor="group-withdraw-destination">Withdraw to wallet address</label><Input id="group-withdraw-destination" autoComplete="off" spellCheck={false} value={destination} onChange={e=>{setDestination(e.target.value);reset()}} placeholder="One Solana destination for the whole group"/></div><div><label className="field-label" htmlFor="group-withdraw-mode">Withdrawal amount</label><select id="group-withdraw-mode" value={amountMode} onChange={e=>{setAmountMode(e.target.value as typeof amountMode);reset()}}><option value="available">Available SOL after fees and reserve</option><option value="fixed">Fixed SOL from each wallet</option></select></div>{amountMode==='fixed'&&<div><label className="field-label" htmlFor="group-fixed-amount">SOL from each wallet</label><Input id="group-fixed-amount" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);reset()}}/></div>}<div><label className="field-label" htmlFor="group-reserve">SOL to leave in each wallet</label><Input id="group-reserve" inputMode="decimal" value={reserve} onChange={e=>{setReserve(e.target.value);reset()}}/><p className="field-help">Available withdrawals subtract the quoted fee and this reserve. Unspendable wallets are shown as skipped.</p></div></>}
   <div><label className="field-label" htmlFor="group-priority">Priority fee budget per transaction · SOL</label><Input id="group-priority" inputMode="decimal" value={priority} onChange={e=>{setPriority(e.target.value);reset()}}/><p className="field-help">0–0.01 SOL. OutSol platform fee: 0.</p></div>
   <div className={styles.full}><Button onClick={()=>void prepare()} disabled={blocked||tooMany||!wallets.length}>{busy?<Loader2 size={15} className="animate-spin"/>:<ShieldCheck size={15}/>}Preview {kind==='fund'?'group funding':'group withdrawal'}<ArrowRight size={15}/></Button></div>
  </fieldset>
  {error&&<p role="alert" className="notice notice-error mt-5">{error}</p>}
  {prepared&&<section className={styles.review} aria-label="Reviewed group operation"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg">Review {prepared.groupName}</h3><p className="field-help mt-2">{prepared.summary.transactionCount} transaction{prepared.summary.transactionCount===1?'':'s'} · preview expires after 60 seconds</p></div><span className="text-sm text-accent">0% OutSol fee</span></div><dl className={styles.summary}><div><dt>Total transfers</dt><dd>{sol(prepared.summary.totalTransferLamports)}</dd></div><div><dt>Network fees</dt><dd>{sol(prepared.summary.totalNetworkFeeLamports)}</dd></div>{prepared.summary.payerAfterLamports!==undefined&&<div><dt>Funder remaining SOL</dt><dd>{sol(prepared.summary.payerAfterLamports)}</dd></div>}{prepared.summary.destinationAfterLamports!==undefined&&<div><dt>Destination after transfers</dt><dd>{sol(prepared.summary.destinationAfterLamports)}</dd></div>}</dl>
   <div className={styles.rows}>{prepared.rows.map(value=><div className={styles.row} key={value.walletId}><div><h4 className="text-sm font-medium">{value.name}</h4><p className="text-xs font-mono text-muted mt-1">{short(value.address)}</p></div><div><span className="field-label">{prepared.kind==='fund'?'Receives':'Withdraws'}</span><span className="text-sm tabular-nums">{sol(value.transferLamports)}</span></div><div><span className="field-label">Balance after</span><span className="text-sm tabular-nums">{sol(value.afterLamports)}</span></div>{value.status==='skipped'?<p className="text-sm text-muted col-span-full">Skipped: {value.reason}</p>:prepared.kind==='withdraw'&&<p className="field-help col-span-full">Network fee paid by this wallet: {sol(value.networkFeeLamports)}.</p>}</div>)}</div>
   <p className="field-help mt-5">Group transfers are sequential. Confirmed transactions remain completed if a later wallet fails or you cancel. A lost response stops the group and preserves its signature; no transfer is automatically resent.</p>
   {!prepared.transactions.length?<p className="notice mt-5">No eligible transfers were found. Review the skipped wallets above.</p>:<><label className="flex gap-3 text-sm text-muted leading-6 mt-5"><input type="checkbox" className="accent-[#a4dac5] mt-1" disabled={blocked} checked={approved} onChange={e=>setApproved(e.target.checked)}/>I reviewed every wallet, destination, transfer, fee and remaining balance. Submit this group operation.</label>{!allReady&&<p className="field-help mt-3">Unlock all sending wallets or connect the reviewed funder before signing.</p>}<Button className="mt-5" disabled={!approved||!allReady||blocked} onClick={()=>void submit()}>{busy?<Loader2 size={15} className="animate-spin"/>:<Check size={15}/>}Sign and {kind==='fund'?'fund group':'withdraw group'}</Button></>}
  </section>}
  {busy&&<div className="notice flex flex-wrap gap-4 justify-between items-center mt-5" role="status"><span><Loader2 className="animate-spin inline mr-2" size={15}/>{submitting?'Signing and confirming group transfers…':'Preparing or checking the reviewed group operation…'}</span>{submitting&&<Button variant="secondary" size="sm" onClick={()=>controller.current?.abort()}><Square size={13}/>Stop remaining transfers</Button>}</div>}
  {pending&&<section className="notice mt-5"><h3 className="text-base">Saved group needs a confirmation check</h3><p className="text-sm text-muted mt-3">A transfer may already have landed. Check its original signature before another spending operation.</p><Button variant="secondary" className="mt-4" disabled={busy} onClick={()=>void reconcile()}><RefreshCw size={14}/>Check group confirmation</Button></section>}
  {(record||pending)&&<GroupReceipt record={(record||pending)!}/>}
  {history.length>0&&<details className="mt-6"><summary className="cursor-pointer text-sm text-muted">Recent group operations · this device</summary>{history.slice(0,5).map(value=><GroupReceipt key={value.id} record={value}/>)}</details>}
  <p className="field-help mt-5">For individual token transfers and eligible empty-account cleanup, use <Link href="/wallet-operations?view=manual" className="text-accent underline">manual wallet operations</Link>.</p>
 </section>
}
function GroupReceipt({record}:{record:GroupOperationRecord}){
 const completed=record.packets.filter(value=>value.status==='confirmed').length
 return <section className={styles.receipt}><div className="flex flex-wrap justify-between gap-3"><h3 className="text-base">{record.kind==='fund'?'Group funding':'Group withdrawal'} · {record.groupName}</h3><span className={record.status==='confirmed'?'text-accent':'text-muted'}>{record.status}</span></div><p className="text-sm text-muted mt-3">{completed} of {record.packets.length} transactions confirmed. Unsubmitted transfers were not resumed.</p>{record.error&&<p className="text-sm text-muted mt-3">{record.error}</p>}{record.packets.map(packet=><div className="border-t border-border mt-4 pt-4" key={packet.index}><p className="text-sm">Transaction {packet.index+1} · {packet.status}</p><p className="font-mono text-xs text-muted break-all mt-2">From {packet.intent.payer}</p>{packet.intent.recipients?.map(recipient=><p className="text-xs text-muted font-mono break-all mt-2" key={recipient.address}>{sol(recipient.rawAmount)} → {recipient.address}</p>)}{packet.signature&&<a className="text-link text-sm mt-3" href={`https://solscan.io/tx/${packet.signature}`} target="_blank" rel="noreferrer">Check signature<ExternalLink size={12}/></a>}{packet.error&&<p className="text-sm text-muted mt-2">{packet.error}</p>}</div>)}</section>
}
