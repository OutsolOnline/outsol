'use client'

import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection,useWallet} from '@solana/wallet-adapter-react'
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui'
import {VersionedTransaction} from '@solana/web3.js'
import {Check,ExternalLink,Layers3,Loader2,Upload,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {LaunchRecovery} from '@/components/launch/LaunchRecovery'
import {CreatorFeeFields} from '@/components/launch/CreatorFeeFields'
import {creatorFeeRoutingLabel,type CreatorFeeSelection,type VerifiedGitHubIndividual} from '@/lib/creatorFeeRouting'
import {loadLaunchDrafts,type LaunchDraft} from '@/lib/launchDrafts'
import {getArtwork,saveArtwork,validateArtwork} from '@/lib/artworkLibrary'
import {readMultiLaunchDraft,saveMultiLaunchDraft,validateMultiLaunchDesign,type MultiLaunchDraft} from '@/lib/multiLaunch/draft'
import {formatRawBalance} from '@/lib/venues/trade'
import {prepareMultiLaunch,type MultiLaunchReview,type MultiLaunchRowInput,type MultiLaunchSession} from '@/lib/multiLaunch/session'
import {readBatchJournal,type BatchJournal} from '@/lib/multiLaunch/history'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'

const sol=(value:string)=>formatRawBalance(value,9,9)
const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-6)}`
const blank=():MultiLaunchRowInput=>({name:'',symbol:'',buySol:'0'})

export function MultiLaunchContent(){
 const {connection}=useConnection(),external=useWallet(),vault=usePlatformWalletStore(),library=useWalletLibraryStore()
 const [drafts,setDrafts]=useState<LaunchDraft[]>([]),[draftId,setDraftId]=useState(''),[rows,setRows]=useState<MultiLaunchRowInput[]>([blank(),blank()])
 const [description,setDescription]=useState(''),[website,setWebsite]=useState(''),[twitter,setTwitter]=useState(''),[telegram,setTelegram]=useState('')
 const [creatorFeeSelection,setCreatorFeeSelection]=useState<CreatorFeeSelection>({kind:'deployer'})
 const previousGitHubRecipient=useRef<VerifiedGitHubIndividual|undefined>(undefined)
 const [image,setImage]=useState<Blob|null>(null),[imageLabel,setImageLabel]=useState(''),[imageUrl,setImageUrl]=useState('')
 const [source,setSource]=useState<'external'|'vault'>('external'),[slippage,setSlippage]=useState(5),[priority,setPriority]=useState(0.0005),[tip,setTip]=useState(0.00001)
 const [busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[review,setReview]=useState<MultiLaunchReview|null>(null),[approved,setApproved]=useState(false),[error,setError]=useState('')
 const [journal,setJournal]=useState<BatchJournal|null>(null),[interrupted,setInterrupted]=useState(false)
 const [artworkId,setArtworkId]=useState<string|undefined>(),[artworkBusy,setArtworkBusy]=useState(false),[draftReady,setDraftReady]=useState(false),[draftWarning,setDraftWarning]=useState(''),[artworkWarning,setArtworkWarning]=useState(''),[attempted,setAttempted]=useState(false),[expired,setExpired]=useState(false)
 const canAutosave=useRef(true)
 const session=useRef<MultiLaunchSession|null>(null),operation=useRef(false),controller=useRef<AbortController|null>(null),alive=useRef(true),draftRequest=useRef(0)
 const externalNow=useRef(external),sourceNow=useRef(source)
 useLayoutEffect(()=>{externalNow.current=external;sourceNow.current=source},[external,source])
 const payer=source==='vault'?vault.getPublicKey():external.publicKey?.toBase58()
 const signerNow=()=>sourceNow.current==='vault'?usePlatformWalletStore.getState().getPublicKey():externalNow.current.wallet?.adapter.publicKey?.toBase58()

 useEffect(()=>{
  alive.current=true;const request=++draftRequest.current;library.hydrate();vault.hydrateWallet()
  try {setDrafts(loadLaunchDrafts())}catch(e){setError(e instanceof Error?e.message:'Saved kits could not be read.')}
  try {const saved=readBatchJournal();setJournal(saved);setInterrupted(saved?.status==='running')}catch(e){setError(e instanceof Error?e.message:'Saved receipts could not be read.')}
  try {
   const saved=readMultiLaunchDraft()
   if(saved){setRows(saved.rows);setCreatorFeeSelection(saved.creatorFeeSelection??{kind:'deployer'});setDescription(saved.description);setWebsite(saved.website);setTwitter(saved.twitter);setTelegram(saved.telegram);setSource(saved.source);setSlippage(saved.slippage??NaN);setPriority(saved.priority??NaN);setTip(saved.tip??NaN);setDraftId(saved.kitId);setArtworkId(saved.artworkId)
    if(saved.artworkId){setArtworkBusy(true);void getArtwork(saved.artworkId).then(asset=>{if(!alive.current||request!==draftRequest.current)return;if(!asset){setError('Your saved artwork is unavailable on this device. Choose an image to continue.');return}setImage(asset.blob);setImageLabel(asset.label)}).catch(reason=>{if(alive.current&&request===draftRequest.current)setError(reason instanceof Error?reason.message:'Saved artwork could not be loaded.')}).finally(()=>{if(alive.current&&request===draftRequest.current)setArtworkBusy(false)})}
   }
  }catch(reason){canAutosave.current=false;setDraftWarning(reason instanceof Error?reason.message:'The saved design could not be read. Your previous browser data is preserved.')}
  setDraftReady(true)
  return()=>{alive.current=false;controller.current?.abort();session.current=null}
 // Stores expose stable methods; hydration runs once for this workspace.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])
 useEffect(()=>{if(!image){setImageUrl('');return}const url=URL.createObjectURL(image);setImageUrl(url);return()=>URL.revokeObjectURL(url)},[image])
 useEffect(()=>{session.current=null;setReview(null);setApproved(false)},[payer,source])
 const design:MultiLaunchDraft={version:1,rows,creatorFeeSelection,description,website,twitter,telegram,source,slippage:Number.isFinite(slippage)?slippage:null,priority:Number.isFinite(priority)?priority:null,tip:Number.isFinite(tip)?tip:null,kitId:draftId,...(artworkId?{artworkId}:{})}
 const fieldErrors=attempted?validateMultiLaunchDesign(design,{hasArtwork:!!image,hasSigner:!!payer}):{}
 const issue=(id:string)=>fieldErrors[id]?<p id={`${id}-error`} className="field-help text-red-300">{fieldErrors[id]}</p>:null
 const fieldProps=(id:string)=>({'aria-invalid':!!fieldErrors[id],'aria-describedby':fieldErrors[id]?`${id}-error`:undefined})
 useEffect(()=>{
  if(!draftReady||!canAutosave.current)return
  try{saveMultiLaunchDraft({version:1,rows,creatorFeeSelection,description,website,twitter,telegram,source,slippage:Number.isFinite(slippage)?slippage:null,priority:Number.isFinite(priority)?priority:null,tip:Number.isFinite(tip)?tip:null,kitId:draftId,...(artworkId?{artworkId}:{})});setDraftWarning('')}
  catch(reason){setDraftWarning(reason instanceof Error?reason.message:'Your latest design was not saved. Keep this page open.')}
 },[draftReady,rows,creatorFeeSelection,description,website,twitter,telegram,source,slippage,priority,tip,draftId,artworkId])
 useEffect(()=>{
  setExpired(false)
  if(!review||busy)return
  const expire=()=>{setExpired(true);setApproved(false)}
  if(review.expiresAt<=Date.now()){expire();return}
  const timeout=setTimeout(expire,review.expiresAt-Date.now())
  return()=>clearTimeout(timeout)
 },[review,busy])
 const invalidate=()=>{session.current=null;setReview(null);setApproved(false);setError('')}
 const chooseImage=async(file:File)=>{
  const request=++draftRequest.current;invalidate();setArtworkBusy(true)
  try{await validateArtwork(file);if(!alive.current||request!==draftRequest.current)return;setImage(file);setImageLabel(file.name);setArtworkId(undefined);setArtworkWarning('')
   try{const asset=await saveArtwork(file,file.name);if(alive.current&&request===draftRequest.current)setArtworkId(asset.id)}catch(reason){if(alive.current&&request===draftRequest.current)setArtworkWarning(`${reason instanceof Error?reason.message:'Artwork could not be saved.'} Choose the image again if you leave this page.`)}
  }catch(reason){if(alive.current&&request===draftRequest.current)setError(reason instanceof Error?reason.message:'Choose valid raster artwork.')}
  finally{if(alive.current&&request===draftRequest.current)setArtworkBusy(false)}
 }
 const changeRow=(index:number,key:keyof MultiLaunchRowInput,value:string)=>{invalidate();setRows(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,[key]:value}:row))}
 const resize=(count:number)=>{invalidate();setRows(current=>Array.from({length:count},(_,index)=>current[index]??{...current[0]}))}
 const chooseDraft=async(id:string)=>{
  const request=++draftRequest.current;invalidate();setDraftId(id);setImage(null);setImageLabel('');setArtworkId(undefined);setArtworkBusy(false);setArtworkWarning('')
  if(!id){setRows([blank(),blank()]);setDescription('');setWebsite('');setTwitter('');setTelegram('');return}
  const draft=drafts.find(item=>item.id===id);if(!draft)return
  setRows(current=>current.map(()=>({name:draft.metadata.name,symbol:draft.metadata.symbol,buySol:String(draft.config.devBuySol)})))
  setDescription(draft.metadata.description);setWebsite(draft.metadata.website||'');setTwitter(draft.metadata.twitter||'');setTelegram(draft.metadata.telegram||'')
  setSlippage(draft.config.slippage);setPriority(Math.min(draft.config.priorityFeeSol,0.01));setTip(draft.config.jitoTipSol)
  setCreatorFeeSelection(draft.config.creatorFeeSelection)
  if(!draft.artworkId){setError('This kit has no saved local artwork. Add an image below to upload metadata for each new token.');return}
  setArtworkBusy(true)
  try {const asset=await getArtwork(draft.artworkId);if(!alive.current||request!==draftRequest.current)return;if(!asset)throw new Error('This kit’s local artwork is missing. Add an image below.');setImage(asset.blob);setImageLabel(asset.label);setArtworkId(asset.id)}catch(e){if(alive.current&&request===draftRequest.current)setError(e instanceof Error?e.message:'Artwork could not be loaded.')}finally{if(alive.current&&request===draftRequest.current)setArtworkBusy(false)}
 }
 const prepare=async()=>{
  if(operation.current||artworkBusy||!draftReady)return
  setAttempted(true)
  const errors=validateMultiLaunchDesign(design,{hasArtwork:!!image,hasSigner:!!payer})
  if(Object.keys(errors).length){setError('Complete the highlighted fields before publishing metadata.');const target=document.getElementById(Object.keys(errors)[0]);target?.closest('details')?.setAttribute('open','');target?.focus();target?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return}
  operation.current=true;setBusy(true);setPhase('Uploading public metadata and checking every launch…');invalidate();controller.current=new AbortController()
  try {
   if(!payer||!image)throw new Error('Choose an unlocked signing wallet and local token artwork.')
   const prepared=await prepareMultiLaunch(connection,{payer,rows,creatorFeeSelection,shared:{description,image,website,twitter,telegram},slippage,priorityFeeSol:priority,jitoTipSol:tip},{readSigner:signerNow,signal:controller.current.signal,previousGitHubRecipient:previousGitHubRecipient.current})
   if(!alive.current)return
   session.current=prepared;setReview(prepared.review());setPhase('All tokens are ready for your review.')
   previousGitHubRecipient.current=prepared.review().rows[0].creatorFeeRouting.github
  }catch(e){if(alive.current){setError(e instanceof Error?e.message:'The batch could not be prepared.');setPhase('Preparation stopped.')}}
  finally {operation.current=false;if(alive.current)setBusy(false)}
 }
 const launch=async()=>{
  if(!session.current||!review||!approved||operation.current||expired)return
  if(!navigator.locks){setError('Use a current browser that can coordinate transaction signing across tabs.');return}
  operation.current=true;setBusy(true);setError('');setInterrupted(false);setPhase('Waiting for the launch workspace…')
  const currentSession=session.current,expectedPayer=review.payer
  controller.current=new AbortController()
  try {
    const result=await currentSession.run({approved:true,readSigner:signerNow,signal:controller.current!.signal,onChange:record=>{if(alive.current){setJournal(record);const index=record.rows.findIndex(row=>row.status==='signing'||row.status==='sending');setPhase(index>=0?`Token ${index+1} of ${record.rows.length}: ${record.rows[index].status==='signing'?'waiting for signature':'confirming on Solana'}`:'Updating public batch receipts…')}},sign:async packets=>{
     const signed:VersionedTransaction[]=[]
     if(sourceNow.current==='vault'){
      for(const packet of packets){if(signerNow()!==expectedPayer)throw new Error('The local wallet was locked or changed.');const key=usePlatformWalletStore.getState().getKeypair();if(!key||key.publicKey.toBase58()!==expectedPayer)throw new Error('Unlock the reviewed local wallet.');packet.sign([key]);signed.push(packet)}
     }else if(externalNow.current.signAllTransactions){const result=await externalNow.current.signAllTransactions(packets);if(signerNow()!==expectedPayer)throw new Error('The signing wallet changed.');signed.push(...result)}
     else if(externalNow.current.signTransaction){for(const packet of packets){const result=await externalNow.current.signTransaction(packet);if(signerNow()!==expectedPayer)throw new Error('The signing wallet changed.');signed.push(result)}}
     else throw new Error('This wallet cannot sign the reviewed launch.')
     return signed
    }})
    if(alive.current){setJournal(result);setError(result.error||'');setPhase(result.status==='confirmed'?'Every token confirmed on Solana.':result.status==='cancelled'?'Pending launches cancelled.':'The batch stopped. Review the saved receipts below.')}
  }catch(e){if(alive.current){setError(e instanceof Error?e.message:'The batch stopped.');setPhase('The batch stopped.')}}
  finally {operation.current=false;session.current=null;if(alive.current){setBusy(false);setApproved(false);setReview(null)}}
 }
 const unknown=journal?.status==='unknown'
 return <div className="space-y-6">
  <LaunchRecovery />
  <p className="field-help" role="status">{!draftReady?'Restoring your batch design…':artworkBusy?'Saving or restoring local artwork…':draftWarning?'Your design is available on this page.':'Design saved in this browser. Fresh mints and approval are always required.'}</p>
  {draftWarning&&<div className="notice notice-error" role="status">{draftWarning}<Button variant="link" className="mt-2 block px-0" onClick={()=>{try{saveMultiLaunchDraft(design);canAutosave.current=true;setDraftWarning('')}catch(reason){setDraftWarning(reason instanceof Error?reason.message:'Your design could not be saved.')}}}>Retry saving design</Button></div>}
  {artworkWarning&&<p className="notice notice-error" role="status">{artworkWarning}</p>}
  {interrupted&&<div className="notice" role="status">The previous batch was interrupted. Its public receipt is shown below. No remaining token will launch automatically. <Link href="/activity" className="underline">Check Activity for submitted signatures.</Link></div>}
  <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
   <div className="space-y-5">
    <section className="form-section space-y-5"><div><h2 className="text-lg">Choose a design</h2><p className="field-help">Reuse a saved kit or start here. Every token receives a fresh mint address.</p></div>
     <fieldset disabled={busy||artworkBusy||!draftReady} className="space-y-5">
      <div><label className="field-label" htmlFor="multi-kit">Saved launch kit</label><select id="multi-kit" value={draftId} onChange={e=>void chooseDraft(e.target.value)} className="w-full rounded-lg border border-border bg-background p-3 text-sm"><option value="">Start with a new design</option>{drafts.map(draft=><option key={draft.id} value={draft.id}>{draft.name}</option>)}</select><p className="field-help">Kits are saved in <Link href="/launch" className="text-accent underline">Launch studio</Link>. Artwork stays on this device until you prepare.</p></div>
      <div className="flex items-center gap-4">{imageUrl&&<img src={imageUrl} alt="Shared token artwork" className="w-16 h-16 object-cover rounded-xl border border-border"/>}<div className="flex-1"><label className="field-label" htmlFor="multi-image">Shared token artwork</label><Input id="multi-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" {...fieldProps('multi-image')} onChange={e=>{const file=e.target.files?.[0];if(file)void chooseImage(file);e.target.value=''}}/><p className="field-help">{imageLabel||'PNG, JPEG, GIF or WebP · up to 5 MB'}</p>{issue('multi-image')}{image&&<Button size="sm" variant="ghost" onClick={()=>{draftRequest.current++;invalidate();setImage(null);setImageLabel('');setArtworkId(undefined);setArtworkWarning('')}}><X size={13}/>Remove image</Button>}</div></div>
      <div><label className="field-label" htmlFor="multi-description">Shared description</label><textarea id="multi-description" {...fieldProps('multi-description')} value={description} maxLength={1000} rows={3} onChange={e=>{invalidate();setDescription(e.target.value)}} className="w-full rounded-lg border border-border bg-background p-3 text-sm"/>{issue('multi-description')}</div>
      <details><summary className="cursor-pointer text-sm text-muted">Shared website and social links</summary><div className="grid gap-3 mt-4">{([['Website',website,setWebsite],['X post or profile',twitter,setTwitter],['Telegram',telegram,setTelegram]] as const).map(([label,value,setter],index)=><div key={label}><label className="field-label" htmlFor={`multi-link-${index}`}>{label}</label><Input id={`multi-link-${index}`} type="url" maxLength={300} {...fieldProps(`multi-link-${index}`)} value={value} placeholder="https://" onChange={e=>{invalidate();setter(e.target.value)}}/>{issue(`multi-link-${index}`)}</div>)}</div></details>
     </fieldset>
    </section>
    <section className="form-section" id="multi-creator-fees"><CreatorFeeFields value={creatorFeeSelection} onChange={value=>{invalidate();setCreatorFeeSelection(value)}} disabled={busy||artworkBusy||!draftReady} idPrefix="multi-creator-fees" error={fieldErrors['multi-creator-fees']}/><p className="field-help">This selection applies to every token. Each token receives its own derived rewards or sharing account. Recipient setup counts toward the complete five-packet cost preview.</p></section>
    <section className="form-section space-y-5"><div className="flex items-center justify-between gap-4"><div><h2 className="text-lg">Your launch sequence</h2><p className="field-help">Separate Pump.fun launches, sent in this order.</p></div><div><label className="sr-only" htmlFor="multi-count">Number of tokens</label><select id="multi-count" value={rows.length} disabled={busy||artworkBusy||!draftReady} onChange={e=>resize(Number(e.target.value))} className="rounded-lg border border-border bg-background p-2 text-sm">{[2,3,4,5].map(count=><option key={count} value={count}>{count} tokens</option>)}</select></div></div>
     <fieldset disabled={busy||artworkBusy||!draftReady} className="space-y-4">{rows.map((row,index)=><div key={index} className="rounded-xl border border-border p-4 space-y-3"><p className="text-xs text-accent">TOKEN {index+1}</p><div className="grid sm:grid-cols-2 gap-3"><div><label className="field-label" htmlFor={`multi-name-${index}`}>Name</label><Input id={`multi-name-${index}`} maxLength={128} {...fieldProps(`multi-name-${index}`)} value={row.name} onChange={e=>changeRow(index,'name',e.target.value)}/>{issue(`multi-name-${index}`)}</div><div><label className="field-label" htmlFor={`multi-symbol-${index}`}>Symbol</label><Input id={`multi-symbol-${index}`} maxLength={40} {...fieldProps(`multi-symbol-${index}`)} value={row.symbol} onChange={e=>changeRow(index,'symbol',e.target.value)}/>{issue(`multi-symbol-${index}`)}</div></div><div><label className="field-label" htmlFor={`multi-buy-${index}`}>Maximum first buy · SOL</label><Input id={`multi-buy-${index}`} maxLength={64} {...fieldProps(`multi-buy-${index}`)} inputMode="decimal" value={row.buySol} onChange={e=>changeRow(index,'buySol',e.target.value)}/>{issue(`multi-buy-${index}`)}<p className="field-help">0 creates the token without buying. Protocol charges stay within this buy budget.</p></div></div>)}</fieldset>
    </section>
    <section className="form-section space-y-5"><h2 id="multi-signer" tabIndex={-1} className="text-lg">Signing wallet</h2>{issue('multi-signer')}<fieldset disabled={busy||artworkBusy||!draftReady} className="space-y-4"><div className="flex gap-4 text-sm"><label><input type="radio" name="multi-source" checked={source==='external'} onChange={()=>{invalidate();setSource('external')}}/> External wallet</label><label><input type="radio" name="multi-source" checked={source==='vault'} onChange={()=>{invalidate();setSource('vault')}}/> Local wallet</label></div>{source==='external'?<WalletMultiButton/>:<><label className="field-label" htmlFor="multi-local-wallet">Selected local wallet</label><select id="multi-local-wallet" value={library.activeId??''} onChange={e=>{invalidate();library.selectWallet(e.target.value||null)}} className="w-full rounded-lg border border-border bg-background p-3 text-sm"><option value="">Previous vault wallet</option>{library.wallets.map(wallet=><option value={wallet.id} key={wallet.id}>{wallet.name} · {short(wallet.publicKey)}{library.unlockedIds.includes(wallet.id)?'':' · locked'}</option>)}</select><p className="field-help"><Link href="/wallet" className="text-accent underline">Unlock or manage wallets</Link> before preparing.</p></>}<p className="text-xs text-muted font-mono break-all">{payer||'No unlocked signing wallet selected'}</p></fieldset></section>
    <details className="form-section"><summary className="text-sm cursor-pointer">Execution settings</summary><fieldset disabled={busy||artworkBusy||!draftReady} className="grid sm:grid-cols-3 gap-4 mt-5">{([['Slippage · %',slippage,setSlippage,0.1,50],['Priority fee · SOL',priority,setPriority,0,0.01],['Bundle tip · SOL',tip,setTip,0.000001,0.1]] as const).map(([label,value,setter,min,max],index)=><div key={label}><label className="field-label" htmlFor={`multi-setting-${index}`}>{label}</label><Input id={`multi-setting-${index}`} {...fieldProps(`multi-setting-${index}`)} type="number" step="any" min={min} max={max} value={Number.isNaN(value)?'':value} onChange={e=>{invalidate();setter(e.target.valueAsNumber)}}/>{issue(`multi-setting-${index}`)}</div>)}</fieldset><p className="field-help mt-4">A validator tip is used only if one token needs a split launch bundle for its metadata, buy or recipient setup. There is no bundle across different tokens.</p></details>
    {error&&<div className="notice notice-error" role="alert">{error}{unknown&&<p className="mt-2"><Link href="/activity" className="underline">Check original signatures in Activity</Link></p>}</div>}
    <div className="flex flex-wrap gap-3">{!review&&<Button onClick={()=>void prepare()} disabled={busy||artworkBusy||!draftReady}>{busy?<Loader2 size={15} className="animate-spin"/>:<Upload size={15}/>}Upload metadata &amp; prepare all</Button>}{busy&&<Button variant="secondary" onClick={()=>controller.current?.abort()}><X size={15}/>Cancel pending actions</Button>}</div>
    <p className="field-help">Preparing publishes the selected artwork, names, descriptions and links to public token metadata. It does not submit a transaction.</p>
   </div>
   <aside className="workspace-card p-5 lg:sticky lg:top-24 space-y-5"><div className="flex gap-2 items-center text-accent"><Layers3 size={18}/><h2 className="text-base">Review the whole batch</h2></div><p className="text-sm text-muted">{rows.length} Pump.fun tokens · Solana · 0 SOL OutSol fee.</p>
    {phase&&<p className="text-sm" role="status">{phase}</p>}
    {review?<><div className="space-y-4">{review.rows.map((row,index)=><div className="border-b border-border pb-4 space-y-2" key={row.mint}><h3 className="text-sm">{index+1}. {row.name} <span className="text-muted">${row.symbol}</span></h3><p className="font-mono text-xs text-muted break-all">{row.mint}</p><p className="text-sm">Creator fees: {creatorFeeRoutingLabel(row.creatorFeeRouting)}</p>{row.creatorFeeRouting.github&&<p className="field-help">Verified individual ID {row.creatorFeeRouting.github.userId} · {row.creatorFeeRouting.github.profileUrl}</p>}<p className="field-help break-all">Effective recipient: {row.creatorFeeRouting.effectiveCreator}</p><dl className="text-xs space-y-1 text-muted"><div className="flex justify-between gap-2"><dt>First-buy ceiling</dt><dd>{sol(row.maxBuyLamports)} SOL</dd></div><div className="flex justify-between gap-2"><dt>Network + priority</dt><dd>{sol(row.networkFeeLamports)} SOL</dd></div><div className="flex justify-between gap-2"><dt>Validator tip</dt><dd>{sol(row.tipLamports)} SOL</dd></div><div className="flex justify-between gap-2 text-foreground"><dt>Complete simulated debit</dt><dd>{sol(row.debitLamports)} SOL</dd></div></dl><p className="field-help">{row.atomicBundle?`${row.packetCount} packets in this token’s bundle`:'One transaction'}. Account rent and protocol charges are included in the debit.</p><a href={row.metadataUri.replace('ipfs://','https://ipfs.io/ipfs/')} target="_blank" rel="noreferrer" className="text-xs text-accent inline-flex gap-1 items-center">Public metadata<ExternalLink size={11}/></a></div>)}</div><dl className="space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted">Reviewed wallet balance</dt><dd>{sol(review.balanceLamports)} SOL</dd></div><div className="flex justify-between gap-3 text-accent"><dt>Total wallet requirement</dt><dd>{sol(review.totalDebitLamports)} SOL</dd></div></dl><p className="field-help">This is the exact sum of the simulated row debits. Each row is checked again before sending; any changed cost stops the remaining launches. Review expires after 60 seconds.</p>{expired&&<p className="notice" role="status">This review has expired. Prepare a fresh review before signing. Metadata will be uploaded again.</p>}<label className="flex items-start gap-3 text-sm text-muted leading-relaxed"><input type="checkbox" className="mt-1" checked={approved} disabled={busy||expired||artworkBusy||!draftReady} onChange={e=>setApproved(e.target.checked)}/>I reviewed every token, public metadata and the total requirement. These launches execute one at a time; earlier successful tokens remain live if a later launch stops.</label>{expired?<Button className="w-full" disabled={busy||artworkBusy} onClick={()=>void prepare()}>Prepare a fresh review</Button>:<Button className="w-full" onClick={()=>void launch()} disabled={!approved||busy}>{busy?<Loader2 size={15} className="animate-spin"/>:<Check size={15}/>}Sign &amp; launch {review.rows.length} tokens</Button>}</>:<p className="text-sm text-muted">Prepare every token to see fresh mint addresses, fees, public metadata and the complete wallet requirement.</p>}
    <p className="field-help">Keep this page open. Cancel stops pending browser actions. Submitted transactions retain their original signatures and are never automatically resent.</p>
   </aside>
  </div>
  {journal&&<section className="form-section space-y-4"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg">{interrupted?'Interrupted batch':'Latest batch'} <span className="text-sm text-muted">· {interrupted?'check saved receipts':journal.status}</span></h2><Link href="/activity" className="text-sm text-accent underline">Open Activity</Link></div><p className="field-help">Public records only. Reloading does not resume launches.</p><ol className="space-y-3">{journal.rows.map((row,index)=><li key={row.mint} className="rounded-lg border border-border p-3 text-sm"><div className="flex justify-between gap-3"><span>{index+1}. {row.name} · ${row.symbol}</span><span className="text-muted">{row.status}</span></div><p className="font-mono text-xs text-muted break-all mt-2">{row.mint}</p><p className="field-help">Creator fees: {row.creatorFeeRouting?creatorFeeRoutingLabel(row.creatorFeeRouting):'Legacy receipt · routing unverified'}</p>{row.signatures.length>0&&<div className="flex flex-wrap gap-3 mt-2">{row.signatures.map((signature,packetIndex)=><a key={signature} href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="text-xs text-accent underline">Original transaction {packetIndex+1}</a>)}</div>}{row.status==='confirmed'&&<Link href={`/manage?mint=${row.mint}`} className="text-xs text-accent underline inline-block mt-2">Manage token</Link>}</li>)}</ol></section>}
 </div>
}
