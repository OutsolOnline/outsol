'use client'

import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection,useWallet} from '@solana/wallet-adapter-react'
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui'
import {VersionedTransaction} from '@solana/web3.js'
import {Check,ExternalLink,Loader2,LockKeyhole,RefreshCw,ShieldCheck} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {parseExactUnits} from '@/lib/walletOperations/model'
import {formatRawBalance} from '@/lib/venues/trade'
import {readSupplyLockPosition} from '@/lib/supplyLocks/position'
import {prepareSupplyLock,submitSupplyLock,type PreparedSupplyLock} from '@/lib/supplyLocks/engine'
import {readPendingSupplyLock,readSupplyLockHistory,type PendingSupplyLock,type SupplyLockReceipt} from '@/lib/supplyLocks/history'
import {reconcilePendingSupplyLock} from '@/lib/supplyLocks/recovery'
import type {SupplyLockPosition} from '@/lib/supplyLocks/model'
import styles from './TokenLockPanel.module.css'

const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-6)}`
const errorText=(value:unknown)=>value instanceof Error?value.message:'The supply lock could not be prepared.'
function tomorrow(){const date=new Date(Date.now()+86400000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}

export function TokenLockPanel({mint}:{mint:string}){
 const {connection}=useConnection(),external=useWallet(),vault=usePlatformWalletStore(),library=useWalletLibraryStore(),id=useId(),[source,setSource]=useState<'external'|'vault'>('external')
 const payer=source==='external'?external.publicKey?.toBase58()??null:vault.getSelectedAddress(),canSign=source==='external'?!!payer&&!!external.signTransaction:!!vault.getKeypair()&&!library.storageUnavailable&&!vault.storageUnavailable
 const [amount,setAmount]=useState('1'),[recipient,setRecipient]=useState(''),[unlock,setUnlock]=useState(''),[priority,setPriority]=useState('0.0001'),[position,setPosition]=useState<SupplyLockPosition|null>(null),[review,setReview]=useState<PreparedSupplyLock|null>(null),[approved,setApproved]=useState(false)
 const [pending,setPending]=useState<PendingSupplyLock|null>(null),[history,setHistory]=useState<SupplyLockReceipt[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[storageError,setStorageError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[phase,setPhase]=useState('')
 const alive=useRef(true),operation=useRef(false),controller=useRef<AbortController|null>(null),epoch=useRef(0),current=useRef({source,payer})
 useLayoutEffect(()=>{current.current={source,payer}},[source,payer])
 const readSigner=()=>{if(current.current.source!==source||current.current.payer!==payer)return null;return source==='vault'?usePlatformWalletStore.getState().getPublicKey():external.wallet?.adapter.publicKey?.toBase58()}
 const journal=useCallback(()=>{const next=readPendingSupplyLock(),receipts=readSupplyLockHistory();setPending(next);setHistory(receipts.filter(row=>row.intent.mint===mint));setStorageError('');return next},[mint])
 const load=useCallback(async()=>{
  const generation=++epoch.current;setPosition(null);if(!payer){setLoading(false);return}setLoading(true)
  try{const result=await readSupplyLockPosition(connection,mint,payer);if(alive.current&&generation===epoch.current)setPosition(result)}catch(value){if(alive.current&&generation===epoch.current)setError(errorText(value))}finally{if(alive.current&&generation===epoch.current)setLoading(false)}
 },[connection,mint,payer])
 useEffect(()=>{alive.current=true;usePlatformWalletStore.getState().hydrateWallet();useWalletLibraryStore.getState().hydrate();return()=>{alive.current=false;controller.current?.abort()}},[])
 useEffect(()=>{setUnlock(tomorrow());setRecipient('');setNotice('');try{journal()}catch(value){setStorageError(errorText(value))}},[mint,journal])
 useEffect(()=>{controller.current?.abort();setReview(null);setApproved(false);setError('');void load()},[load,source])
 useEffect(()=>{controller.current?.abort();setReview(null);setApproved(false)},[amount,recipient,unlock,priority])
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key?.includes('supply-lock')){controller.current?.abort();setReview(null);setApproved(false);try{journal()}catch(value){setStorageError(errorText(value))}}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed)},[journal])
 const preview=async()=>{
  if(operation.current)return;operation.current=true;controller.current=new AbortController();const abort=controller.current;setBusy(true);setPhase('Verifying the live protocol fee and exact escrow…');setError('');setNotice('');setReview(null);setApproved(false)
  try{
   if(!payer||!canSign||!position)throw new Error('Connect or unlock a wallet and load its supported token balance.')
   const unlockAt=Math.floor(new Date(unlock).getTime()/1000)
   const next=await prepareSupplyLock(connection,{version:1,mint,payer,recipient:recipient.trim()||payer,amountRaw:parseExactUnits(amount,position.decimals).toString(),unlockAt,priorityFeeLamports:parseExactUnits(priority,9,true).toString()},{readSigner,signal:abort.signal})
   if(!alive.current||abort.signal.aborted)throw new Error('The lock preview was cancelled.')
   setReview(next);setPosition(next.position)
  }catch(value){if(alive.current)setError(errorText(value))}finally{operation.current=false;if(alive.current){setBusy(false);setPhase('')}}
 }
 const sign=async()=>{
  if(operation.current||!review||!approved)return;operation.current=true;controller.current=new AbortController();const abort=controller.current;setBusy(true);setError('');setNotice('');setPhase('Approve the reviewed immutable lock in your wallet…')
  try{
   const result=await submitSupplyLock(connection,review,{approved:true,readSigner,signal:abort.signal,signTransaction:async tx=>{if(!alive.current||abort.signal.aborted)throw new Error('The lock was cancelled before signing.');const value=source==='vault'?await usePlatformWalletStore.getState().signTransaction(tx):await external.signTransaction!(tx);if(!(value instanceof VersionedTransaction))throw new Error('The wallet returned an unsupported transaction.');return value},onPending:record=>{if(alive.current){setPending(record);setPhase('Confirming the saved original lock signature…')}}})
   if(alive.current){journal();setReview(null);setApproved(false);if(result.status==='confirmed'){setNotice('Token lock confirmed. The recipient can claim through Streamflow after its unlock date.');void load()}else setError(result.error||'The original lock needs a confirmation check. Nothing will be resent.')}
  }catch(value){if(alive.current){setError(errorText(value));setReview(null);setApproved(false);try{journal()}catch(storage){setStorageError(errorText(storage))}}}finally{operation.current=false;if(alive.current){setBusy(false);setPhase('')}}
 }
 const recover=async()=>{
  if(operation.current)return;operation.current=true;setBusy(true);setPhase('Checking the original signature…');setError('')
  try{const result=await reconcilePendingSupplyLock(connection);if(alive.current){journal();if(result.error)setError(result.error);else if(result.status==='confirmed'){setNotice('The original token lock is confirmed.');void load()}}}catch(value){if(alive.current)setError(errorText(value))}finally{operation.current=false;if(alive.current){setBusy(false);setPhase('')}}
 }
 const blocked=!!pending||!!storageError,raw=(value:string)=>formatRawBalance(value,position?.decimals??6,9),sol=(value:string)=>formatRawBalance(value,9,9)
 return <section className={styles.panel} aria-labelledby={`${id}-title`}><header className={styles.heading}><div><div className={styles.eyebrow}>STREAMFLOW · TOKEN SUPPLY ESCROW</div><h2 id={`${id}-title`}>Give your supply a date.</h2><p>Lock an exact token amount for a recipient until a fixed date. Live protocol fees, account rent and network costs are reviewed before signing.</p></div><LockKeyhole size={23}/></header>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{storageError&&<p role="alert" className={styles.error}>{storageError}</p>}{notice&&<p role="status" className={styles.success}><Check size={16}/>{notice}</p>}
  {pending&&<div className={styles.pending}><div className={styles.eyebrow}>SAVED ORIGINAL · CONFIRMATION CHECK</div><p>{pending.intent.mint===mint?'This lock may already have landed.':'A lock for another token is unresolved.'} Nothing is resent automatically.</p><a href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer" className={styles.address}>{pending.signature}<ExternalLink size={12}/></a><Button variant="secondary" disabled={busy} onClick={recover}><RefreshCw size={14}/>Check confirmation</Button></div>}
  <div className={styles.layout}><div className={styles.form}><fieldset disabled={busy||blocked}><legend>Signing wallet</legend><div className={styles.tabs} role="group" aria-label="Lock signing wallet"><button type="button" aria-pressed={source==='external'} onClick={()=>setSource('external')}>Connected wallet</button><button type="button" aria-pressed={source==='vault'} onClick={()=>setSource('vault')}>Encrypted library</button></div><div className={styles.wallet}><span>{payer?short(payer):'Connect or select a wallet'}</span>{source==='external'?<WalletMultiButton/>:<Link href="/wallets" className="text-link">Select & unlock <ExternalLink size={12}/></Link>}</div></fieldset>
   <div className={styles.balance}><span>Available token balance</span><strong>{loading?<Loader2 size={14} className="animate-spin"/>:position?raw(position.balanceRaw):'Choose a supported wallet'}</strong><button type="button" disabled={busy||loading||!payer} aria-label="Refresh lock balance and fees" onClick={()=>{setError('');setReview(null);setApproved(false);void load()}}><RefreshCw size={14}/></button></div>
   <fieldset disabled={busy||blocked||!position} className={styles.fields}><label htmlFor={`${id}-amount`}>Net tokens to lock<Input id={`${id}-amount`} value={amount} inputMode="decimal" maxLength={40} onChange={event=>setAmount(event.target.value)}/><span>The Streamflow token fee is charged in addition to this amount.</span></label><label htmlFor={`${id}-recipient`}>Recipient wallet<Input id={`${id}-recipient`} value={recipient} autoComplete="off" spellCheck={false} maxLength={44} onChange={event=>setRecipient(event.target.value.trim())} placeholder={payer||'Defaults to the signing wallet'}/></label><label htmlFor={`${id}-unlock`}>Unlock date & time · your local time<Input id={`${id}-unlock`} type="datetime-local" value={unlock} onChange={event=>setUnlock(event.target.value)}/><span>Five minutes to ten years after confirmed chain time.</span></label></fieldset>
   <details className={styles.details}><summary>Priority fee</summary><label className={styles.field} htmlFor={`${id}-priority`}>Maximum priority fee · SOL<Input id={`${id}-priority`} value={priority} maxLength={24} inputMode="decimal" disabled={busy||blocked} onChange={event=>setPriority(event.target.value)}/></label></details>
   <p className={styles.help}>This creates a token-supply escrow. Liquidity-provider locks use a separate flow. Supported tokens have fixed supply, revoked mint and freeze authorities, and compatible metadata extensions.</p><div className={styles.buttons}><Button variant="secondary" disabled={busy||blocked||loading||!position||!canSign} onClick={preview}><ShieldCheck size={16}/>Preview immutable lock</Button>{busy&&<Button variant="ghost" onClick={()=>controller.current?.abort()}>Stop pending actions</Button>}</div>
  </div><aside className={styles.review} aria-label="Immutable token lock review"><div className={styles.eyebrow}>REVIEW BEFORE YOU SIGN</div><h3>Locked means locked.</h3><p>The sender and recipient cannot cancel, redirect, pause, top up or change the unlock schedule. The recipient claims through Streamflow after unlocking.</p><dl><div><dt>LaunchPier fee</dt><dd className={styles.accent}>0 SOL</dd></div>{position&&<><div><dt>Streamflow token fee</dt><dd>{position.feeUnits/10000}%</dd></div><div><dt>Streamflow creation fee</dt><dd>{sol(position.creationFeeLamports)} SOL</dd></div></>}{review&&<><div><dt>Net tokens locked</dt><dd>{raw(review.intent.amountRaw)}</dd></div><div><dt>Protocol token fee</dt><dd>{raw(review.intent.tokenFeeRaw)}</dd></div><div><dt>Total token debit</dt><dd>{raw(review.intent.sourceDebitRaw)}</dd></div><div><dt>Recipient</dt><dd className={styles.address}>{review.intent.recipient}</dd></div><div><dt>Unlock</dt><dd>{new Date(review.intent.unlockAt*1000).toLocaleString()}</dd></div><div><dt>Total SOL debit</dt><dd>{sol(review.preview.maxDebitLamports)} SOL</dd></div><div><dt>Included account rent</dt><dd>{sol(review.preview.rentLamports)} SOL</dd></div><div><dt>Included network fee</dt><dd>{sol(review.preview.networkFeeLamports)} SOL</dd></div></>}</dl>{review&&<><label className={styles.approval}><input type="checkbox" checked={approved} disabled={busy||blocked} onChange={event=>setApproved(event.target.checked)}/><span>I reviewed the token, recipient, date and costs. I understand this lock cannot be cancelled or redirected.</span></label><Button disabled={!approved||busy||blocked||!canSign} onClick={sign}>{busy?<Loader2 size={16} className="animate-spin"/>:<LockKeyhole size={16}/>}Sign & lock tokens</Button><p className={styles.help}>Preview expires after60 seconds. A fresh signed simulation must confirm the exact escrow and costs.</p></>}{busy&&<p role="status" className={styles.accent}>{phase}</p>}</aside></div>
  {history.length>0&&<details className={styles.details}><summary>Saved supply-lock receipts · {history.length}</summary><p className={styles.help}>Public receipts on this device. Open Streamflow to inspect the current escrow and claim status.</p>{history.slice(0,6).map(row=><article key={row.signature} className={styles.receipt}><div><strong>{formatRawBalance(row.intent.amountRaw,row.intent.decimals)} tokens · {row.status}</strong><span>Unlock {new Date(row.intent.unlockAt*1000).toLocaleString()}</span></div><div><a href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">Transaction <ExternalLink size={12}/></a>{row.status==='confirmed'&&<a href={`https://app.streamflow.finance/contract/solana/mainnet/${row.intent.metadata}`} target="_blank" rel="noreferrer">Open escrow <ExternalLink size={12}/></a>}</div></article>)}</details>}
 </section>
}
