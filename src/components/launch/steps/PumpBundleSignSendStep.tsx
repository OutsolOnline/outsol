'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection,useWallet} from '@solana/wallet-adapter-react'
import {VersionedTransaction} from '@solana/web3.js'
import {ArrowRight,Check,Clock3,ExternalLink,Loader2,ShieldCheck,SlidersHorizontal} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useLaunchStore,launchReviewKey,launchOutcomeFromResult,type LaunchReceipt} from '@/stores/launchStore'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {validatePumpCreation} from '@/lib/pumpProductPolicy'
import {uploadMetadataToIPFS} from '@/lib/pumpfun/api'
import {clearPendingIfMatching,readPending,saveConfirmed,savePending,type PendingLaunch} from '@/lib/launchHistory'
import {readTradePending} from '@/lib/venues/tradeHistory'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {assertNoPendingBundleReceipt,persistBundleCheckpoint} from '@/lib/bundler/pending'
import {prepareLaunchBundle} from '@/lib/launchBundle/prepare'
import {executePreparedLaunchBundle} from '@/lib/launchBundle/execute'
import {createLaunchBuyerSource} from '@/lib/launchBundle/librarySource'
import {launchBundleModeLabel,validateLaunchBundleSettings} from '@/lib/launchBundle/types'
import type {PreparedLaunchBundle} from '@/lib/launchBundle/model'
import type {LaunchConfig} from '@/lib/launchConfig'
import {creatorFeeRoutingLabel,requireSupportedCreatorFeeSelection,type VerifiedGitHubIndividual} from '@/lib/creatorFeeRouting'
import {fetchGitHubIndividual,assertGitHubIdentityUnchanged} from '@/lib/githubRecipient'
import styles from '../LaunchBuilder.module.css'
import {LaunchTokenTransfers} from './LaunchTokenTransfers'

type Status='idle'|'preparing'|'ready'|'signing'|'sending'|'error'|'unknown'
const sol=(value:string|number)=>(Number(value)/1e9).toLocaleString(undefined,{maximumFractionDigits:9})
const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-6)}`

export function PumpBundleSignSendStep(){
 const {connection}=useConnection(),wallet=useWallet(),platform=usePlatformWalletStore(),store=useLaunchStore()
 const {metadata,metadataUri,imageFile,bannerFile,config,bundleSettings,usePlatformWallet}=store
 const payer=usePlatformWallet?platform.getPublicKey():wallet.publicKey?.toBase58()
 const [status,setStatus]=useState<Status>('idle'),[error,setError]=useState(''),[approved,setApproved]=useState(false),[progress,setProgress]=useState('')
 const [prepared,setPrepared]=useState<PreparedLaunchBundle|null>(null),[uploadedUri,setUploadedUri]=useState('')
 const [reviewedGitHub,setReviewedGitHub]=useState<VerifiedGitHubIndividual|null>(null)
 const githubIdentity=useRef<VerifiedGitHubIndividual|null>(null),preparedKey=useRef<string|null>(null),currentWallet=useRef(wallet)
 useEffect(()=>{currentWallet.current=wallet},[wallet])
 const operation=useRef(false),controller=useRef(new AbortController()),buyers=useRef<ReturnType<typeof createLaunchBuyerSource>|null>(null)
 useEffect(()=>{controller.current=new AbortController();return()=>{controller.current.abort();useLaunchStore.getState().setIsLoading(false)}},[])
 const busy=['preparing','signing','sending'].includes(status),blocked=busy||status==='unknown'
 const errors=[...validatePumpCreation(config),...validateLaunchBundleSettings(bundleSettings)]
 const activeBuyers=bundleSettings.wallets.filter(value=>value.buySol>0)
 const signerNow=()=>useLaunchStore.getState().usePlatformWallet?usePlatformWalletStore.getState().getPublicKey():currentWallet.current.wallet?.adapter.publicKey?.toBase58()
 const readReviewKey=()=>launchReviewKey(useLaunchStore.getState(),signerNow())
 const reviewKey=launchReviewKey(store,payer)
 useEffect(()=>{if(operation.current)return;setPrepared(null);setApproved(false);preparedKey.current=null;setStatus(value=>['signing','sending','unknown'].includes(value)?value:'idle')},[reviewKey,imageFile,bannerFile])
 useEffect(()=>{if(config.creatorFeeSelection.kind!=='github'||githubIdentity.current?.username.toLowerCase()!==config.creatorFeeSelection.username.toLowerCase()){githubIdentity.current=null;setReviewedGitHub(null)}},[config.creatorFeeSelection])
 const assertReview=(expected:string)=>{if(controller.current.signal.aborted||readReviewKey()!==expected)throw new Error('The launch details, fee recipient, selected wallets or signer changed. Prepare a fresh review.')}
 const available=()=>{
  if(readPending())throw new Error('A previous launch needs a confirmation check. Open Activity before starting another.')
  if(readTradePending())throw new Error('A previous trade needs a confirmation check in Activity.')
  assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt()
  const current=useLaunchStore.getState(),invalid=[...validatePumpCreation(current.config),...validateLaunchBundleSettings(current.bundleSettings)]
  if(invalid.length)throw new Error(invalid.join(' '))
  if(controller.current.signal.aborted)throw new Error('The launch screen was closed. Nothing new was sent.')
 }
 const update=(patch:Partial<LaunchConfig>)=>{store.setConfig(patch);setPrepared(null);setApproved(false);setError('');setStatus('idle')}
 const prepare=async()=>{
  if(operation.current)return
  if(controller.current.signal.aborted)controller.current=new AbortController()
  operation.current=true;store.setIsLoading(true);setStatus('preparing');setError('');setApproved(false);setPrepared(null)
  try{
   available()
   const mint=store.getMintKeypair()
   if(!payer||!mint||!metadata)throw new Error('Choose your token details, a fresh mint address and a signing wallet.')
   const expected=readReviewKey(),selection=requireSupportedCreatorFeeSelection(config.creatorFeeSelection)
   const github=selection.kind==='github'?await fetchGitHubIndividual(selection.username,controller.current.signal):undefined
   assertReview(expected)
   if(github){const previous=githubIdentity.current;githubIdentity.current=github;setReviewedGitHub(github);assertGitHubIdentityUnchanged(previous,github)}
   const readBuyer=createLaunchBuyerSource(()=>useWalletLibraryStore.getState(),bundleSettings)
   let uri=metadataUri||uploadedUri
   if(!uri){
    if(!imageFile)throw new Error('Add your token artwork or a public metadata URI in Token details.')
    const uploaded=await uploadMetadataToIPFS({...metadata,image:imageFile},bannerFile||undefined)
    if(!uploaded.success||!uploaded.metadataUri)throw new Error(uploaded.error||'Metadata upload did not complete.')
    uri=uploaded.metadataUri
   }
   if(!/^(https:\/\/|ipfs:\/\/)/.test(uri)||new TextEncoder().encode(uri).length>200)throw new Error('Use an HTTPS or IPFS metadata URI up to 200 bytes.')
   assertReview(expected)
   setUploadedUri(uri)
   const preview=await prepareLaunchBundle(connection,{payer,mintKeypair:mint,metadata:{name:metadata.name,symbol:metadata.symbol,uri},devBuySol:config.devBuySol,slippage:config.slippage,priorityFeeSol:config.priorityFeeSol,jitoTipSol:config.jitoTipSol,settings:bundleSettings,creatorFeeSelection:selection,githubRecipient:github},{readBuyer,readSigner:signerNow,signal:controller.current.signal,assertAvailable:()=>{available();assertReview(expected)}})
   assertReview(expected);preparedKey.current=expected;buyers.current=readBuyer;setPrepared(preview);setStatus('ready')
  }catch(e){setError(e instanceof Error?e.message:'Launch preparation failed.');setStatus('error')}
  finally{operation.current=false;store.setIsLoading(false)}
 }
 const signCreator=async(packets:VersionedTransaction[]):Promise<VersionedTransaction[]>=>{
  setStatus('signing')
  if(usePlatformWallet){const key=usePlatformWalletStore.getState().getKeypair();if(!key)throw new Error('Unlock your signing wallet to continue.');return packets.map(tx=>{tx.sign([key]);return tx})}
  if(wallet.signAllTransactions)return wallet.signAllTransactions(packets)
  if(wallet.signTransaction){const signed:VersionedTransaction[]=[];for(const tx of packets)signed.push(await wallet.signTransaction(tx));return signed}
  throw new Error('This wallet cannot sign the reviewed launch.')
 }
 const sign=async()=>{
  if(!prepared||!approved||!buyers.current||operation.current)return
  if(!navigator.locks){setError('Use a current browser that supports secure transaction coordination.');return}
  await navigator.locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
   if(!lock){setError('Another tab is signing or checking a transaction. Finish it there first.');return}
   operation.current=true;store.setIsLoading(true);setStatus('signing');setError('')
   let confirmed:LaunchReceipt|undefined,original:PendingLaunch|undefined
   try{
    available()
    if(!preparedKey.current)throw new Error('Prepare the current launch before signing.')
    assertReview(preparedKey.current)
    const result=await executePreparedLaunchBundle(prepared,{approved:true,signCreator,readSigner:signerNow,readBuyer:buyers.current!,signal:controller.current.signal,assertAvailable:available,
     onInitialBroadcast:pending=>{assertReview(preparedKey.current!);savePending(pending);original=pending;setStatus('sending')},
     onInitialNotSubmitted:pending=>clearPendingIfMatching(pending),
     onInitialConfirmed:pending=>{confirmed=saveConfirmed({...pending,bundleExecution:{mode:prepared.review.mode,buyerCount:prepared.review.wallets.length,status:prepared.review.followups.length?'partial':'confirmed',...(pending.bundleExecution?.transfers?{transfers:pending.bundleExecution.transfers}:{}),...(prepared.review.followups.length?{message:'Creation confirmed. Browser-only wallet buys were still pending; check Activity for the final recorded outcome. Closing the page stops remaining buys.'}:{})}});store.setMetadataUri(prepared.review.metadataUri)},
     onReceipt:receipt=>persistBundleCheckpoint(receipt),
     onProgress:message=>{setProgress(message);if(!message.startsWith('Waiting for the signing wallet'))setStatus('sending')},
    })
    if(result.status==='unknown'){setStatus('unknown');setError(result.error||'A transaction needs a confirmation check. Your original signatures are saved in Activity.');return}
    if(confirmed&&original){
     const signatures=[...new Set([...confirmed.signatures,...(result.buySignatures||[])])],receipt=saveConfirmed({...original,signatures,bundleExecution:launchOutcomeFromResult(prepared.review.mode,prepared.review.wallets.length,result)})
     store.setReceipt(receipt)
     store.setStep('result');return
    }
    setStatus('error');setError(result.error||'Nothing was launched. Prepare a fresh preview before trying again.');setPrepared(null);setApproved(false)
   }catch(e){setError(e instanceof Error?e.message:'The launch did not complete.');setStatus(original?'unknown':'error');setPrepared(null);setApproved(false)}
   finally{operation.current=false;store.setIsLoading(false)}
  })
 }
 const review=prepared?.review
 const label=status==='preparing'?'Preparing your launch':status==='signing'?'Waiting for your signature':status==='sending'?'Executing your reviewed plan':status==='ready'?'Ready for your review':status==='unknown'?'Confirmation needs a check':'Review your commitment'
 return <div className={styles.reviewGrid}><div className="space-y-5">
  <section className="form-section"><div className={styles.sectionHeading}><span className={styles.sectionIcon}><ShieldCheck size={18}/></span><div><h2>Your launch plan</h2><p>One token. One reviewed execution plan.</p></div></div><dl className={styles.costList}><div><dt>Execution mode</dt><dd>{launchBundleModeLabel(bundleSettings.mode)}</dd></div><div><dt>Creator fee recipient</dt><dd>{creatorFeeRoutingLabel(review?.creatorFeeRouting||config.creatorFeeSelection)}</dd></div><div><dt>Developer first-buy ceiling</dt><dd>{config.devBuySol||0} SOL</dd></div><div><dt>Additional buyers</dt><dd>{activeBuyers.length} wallets · {activeBuyers.reduce((sum,row)=>sum+row.buySol,0).toLocaleString(undefined,{maximumFractionDigits:9})} SOL</dd></div></dl><p className="field-help mt-4">{bundleSettings.mode==='block0'?'Creation and selected buyer transactions are submitted together in one Jito bundle. First-block inclusion is not guaranteed.':bundleSettings.mode==='organic'?`Creation confirms first, then wallet buys use a ${bundleSettings.intervalMinSeconds}–${bundleSettings.intervalMaxSeconds} second gap. Keep this page open; closing it stops remaining actions.`:'Creation confirms first. Additional wallet buys use their individual delays and fresh quotes. Keep this page open for pending actions.'}</p><Button variant="secondary" className="mt-5" disabled={blocked} onClick={()=>store.setStep('launch-settings')}>Edit launch settings</Button></section>
  {(reviewedGitHub||review?.creatorFeeRouting.selection.kind==='holder-rewards')&&<section className="form-section"><h2 className="text-lg mb-3">Creator fee destination</h2>{reviewedGitHub&&<p className="field-help"><a href={reviewedGitHub.profileUrl} target="_blank" rel="noreferrer" className="underline">@{reviewedGitHub.username}</a> · GitHub user ID {reviewedGitHub.userId}. Permanent 100% sharing to this identity’s Pump social escrow. Claims take place in Pump.fun with the linked GitHub account.</p>}{review?.creatorFeeRouting.selection.kind==='holder-rewards'&&<p className="field-help">All creator fees go to this token’s holder-reward account. This is permanent. Pump controls distribution to holders.</p>}</section>}{activeBuyers.length>0&&<section className="form-section"><h2 className="text-lg mb-5">Participating wallets</h2><div className="space-y-4">{activeBuyers.map(row=><div key={row.walletId} className="flex flex-wrap justify-between gap-3 border-b border-border pb-4"><div><p className="text-sm">{row.name}</p><p className="text-xs text-muted font-mono">{short(row.publicKey)}</p></div><div className="text-right text-sm tabular-nums"><p>{row.buySol} SOL maximum buy</p><p className="text-xs text-muted">{bundleSettings.mode==='block0'?'With creation':bundleSettings.mode==='organic'?'Organic interval':`${row.delaySeconds}s after confirmation`}</p></div></div>)}</div></section>}
  <LaunchTokenTransfers transfers={review?.transfers} wallets={review?.wallets}/>
  <details className="form-section"><summary className="flex items-center gap-2 cursor-pointer text-sm"><SlidersHorizontal size={15}/>Advanced execution settings<span className="ml-auto text-xs text-muted">{config.slippage}% slippage</span></summary><fieldset disabled={blocked} className="grid sm:grid-cols-2 gap-5 mt-6"><div><label className="field-label" htmlFor="bundle-slippage">Slippage · %</label><Input id="bundle-slippage" type="number" min="0.1" max="50" step="0.1" value={Number.isNaN(config.slippage)?'':config.slippage} onChange={e=>update({slippage:e.target.valueAsNumber})}/></div><div><label className="field-label" htmlFor="bundle-priority">Priority budget per transaction · SOL</label><Input id="bundle-priority" type="number" min="0" max="0.01" step="0.00001" value={Number.isNaN(config.priorityFeeSol)?'':config.priorityFeeSol} onChange={e=>update({priorityFeeSol:e.target.valueAsNumber})}/></div><div className="sm:col-span-2"><label className="field-label" htmlFor="bundle-tip">Bundle validator tip reserve · SOL</label><Input id="bundle-tip" type="number" min="0.000001" max="0.1" step="0.000001" value={Number.isNaN(config.jitoTipSol)?'':config.jitoTipSol} onChange={e=>update({jitoTipSol:e.target.valueAsNumber})}/><p className="field-help">Used for Block-0 and multi-transaction creation. Single-transaction Manual and Organic creation pays no bundle tip.</p></div></fieldset></details>
  {(error||errors.length>0)&&<div className="notice notice-error" role="alert">{error||errors.join(' ')}{status==='unknown'&&<p className="mt-3"><Link href="/activity" className="underline">Open Activity to check saved signatures</Link></p>}</div>}
  {busy&&progress&&<p className="notice" role="status" aria-live="polite">{progress}</p>}
  <div className="flex flex-wrap justify-between gap-3"><Button variant="ghost" disabled={blocked} onClick={store.prevStep}>Back to signing wallet</Button><Button disabled={blocked||errors.length>0} onClick={prepare}>{status==='preparing'?<Loader2 size={15} className="animate-spin"/>:<ArrowRight size={15}/>} {prepared?'Refresh preview':'Prepare launch'}</Button></div>
  {busy&&<Button variant="secondary" onClick={()=>controller.current.abort()}>Stop remaining browser actions</Button>}
 </div><aside className={styles.launchReview}><div className={styles.reviewStatus}>{busy?<Loader2 size={15} className="animate-spin"/>:prepared?<Check size={15}/>:<Clock3 size={15}/>} {label}</div><div className={styles.reviewToken}><img src={store.imagePreview||'/favicon.svg'} alt={store.imagePreview?'Token artwork':''}/><div><h2>{metadata?.name||'Your token'}</h2><span>${metadata?.symbol||'TOKEN'}</span></div></div><dl className={styles.costList}><div><dt>Destination</dt><dd>Pump.fun · Solana</dd></div><div><dt>Signing wallet</dt><dd className="font-mono">{payer?short(payer):'Not selected'}</dd></div><div><dt>OutSol platform fee</dt><dd>0 SOL · forever</dd></div>{review&&<><div><dt>Network + priority · initial plan</dt><dd>{sol(review.networkFeeLamports)} SOL</dd></div><div><dt>Account creation / rent</dt><dd>Included in simulated debit</dd></div><div><dt>Protocol charges</dt><dd>Included in buy spend</dd></div><div><dt>Validator tip</dt><dd>{sol(review.jitoTipLamports)} SOL</dd></div><div><dt>Initial execution</dt><dd>{review.packetCount} transaction{review.packetCount===1?'':'s'}</dd></div><div><dt>Creator · simulated debit</dt><dd>{sol(review.creatorDebitLamports)} SOL</dd></div>{review.wallets.map(row=><div key={row.walletId}><dt>{row.name} · {review.followups.length?'budget + reserve':'simulated debit'}</dt><dd>{sol(row.requiredLamports)} SOL</dd></div>)}</>}<div className={styles.costTotal}><dt>{review?.followups.length?'Total funds required across wallets':'Complete simulated wallet outflow'}</dt><dd>{review?`${sol(review.totalRequirementLamports)} SOL`:'Prepare for a live quote'}</dd></div></dl><p className="field-help">{review?.followups.length?'Creation costs are simulated. Later buys use the maximum buy amount plus the displayed network/rent reserve; fresh quotes are checked before execution. Unused reserves stay in the buyer wallets.':'The preview includes all participating wallets, buy spend, account rent and protocol charges. Buy allocations are user funds, not OutSol fees. Rent and protocol charges are included but not individually itemized.'}</p>{review&&<div className="space-y-4 mt-5"><a className="text-sm inline-flex items-center gap-1.5 text-accent" href={review.metadataUri.replace('ipfs://','https://ipfs.io/ipfs/')} target="_blank" rel="noreferrer">Review public metadata<ExternalLink size={13}/></a>{review.atomic&&<p className="field-help">Jito inclusion is subject to network conditions. Every saved signature is checked, including any partial execution.</p>}<label className="flex items-start gap-3 text-sm leading-relaxed text-muted"><input className="mt-1 accent-slate-300" type="checkbox" checked={approved} disabled={blocked} onChange={e=>setApproved(e.target.checked)}/>I reviewed the token, creator fee recipient, selected wallets, timing, buy ceilings, token transfer recipients and exact amounts, and total requirements.</label><Button className="w-full" disabled={!approved||blocked} onClick={sign}>{busy&&<Loader2 size={15} className="animate-spin"/>}{status==='signing'?'Approve in your wallet':status==='sending'?'Launch in progress':'Sign & launch'}</Button></div>}</aside></div>
}
