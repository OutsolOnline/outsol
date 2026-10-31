'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection} from '@solana/wallet-adapter-react'
import {getAssociatedTokenAddressSync} from '@solana/spl-token'
import {PublicKey} from '@solana/web3.js'
import {ArrowRight,ArrowUpRight,ExternalLink,Loader2,LockKeyhole,RefreshCw,ShieldCheck,Wallet} from 'lucide-react'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog'
import {CreateManagedWallets} from '@/components/wallet/CreateManagedWallets'
import {useWalletLibraryStore,type WalletSummary} from '@/stores/walletLibraryStore'
import {scanRelayWallet} from '@/lib/relay/scan'
import {prepareRelayTransfer} from '@/lib/relay/prepare'
import {executeRelayTransfer} from '@/lib/relay/execute'
import {readRelayReceipts,reconcileRelayTransfers} from '@/lib/relay/history'
import {readRelayRoutes,saveRelayRoute,removeRelayRoute} from '@/lib/relay/routes'
import type {RelayAsset,RelayReceipt,RelayRoute,RelayWalletScan} from '@/lib/relay/types'
import {prepareSaleBatch,executeSaleBatch,type SaleRequest} from '@/lib/sales/batch'
import {readSaleHistory,reconcileSaleHistory,type SaleBatchRecord} from '@/lib/sales/history'
import {readTradePending,type PendingTrade} from '@/lib/venues/tradeHistory'
import {reconcilePendingTrade} from '@/lib/venues/tradeRecovery'
import {formatRawBalance} from '@/lib/venues/trade'
import {RelayReview,shortRelayAddress,type RelayWorkspaceReview,type ReviewedRelay} from './RelayReview'
import styles from './RelayWorkspace.module.css'

const short=shortRelayAddress,sol=(value:string)=>formatRawBalance(value,9,9),assetId=(walletId:string,asset:RelayAsset)=>`${walletId}:${asset.account}`
const errorText=(value:unknown)=>value instanceof Error?value.message:'The operation did not complete.'
export function RelayWorkspace(){
 const {connection}=useConnection(),library=useWalletLibraryStore()
 const [groupId,setGroupId]=useState('all'),[selection,setSelection]=useState<string[]|null>(null),[assets,setAssets]=useState<Set<string>>(new Set()),[scans,setScans]=useState<Record<string,RelayWalletScan>>({}),[scanErrors,setScanErrors]=useState<Record<string,string>>({})
 const [routes,setRoutes]=useState<RelayRoute[]>([]),[sourceId,setSourceId]=useState(''),[recipientId,setRecipientId]=useState(''),[routeName,setRouteName]=useState('')
 const [status,setStatus]=useState<'idle'|'scanning'|'preparing'|'sending'|'checking'>('idle'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[progress,setProgress]=useState(''),[storageError,setStorageError]=useState(false)
 const [review,setReview]=useState<RelayWorkspaceReview|null>(null),[approved,setApproved]=useState(false),[slippage,setSlippage]=useState('5'),[priority,setPriority]=useState('0.0001')
 const [receipts,setReceipts]=useState<RelayReceipt[]>([]),[sales,setSales]=useState<SaleBatchRecord[]>([]),[pending,setPending]=useState<PendingTrade|null>(null)
 const [unlockIds,setUnlockIds]=useState<string[]>([]),[passphrase,setPassphrase]=useState('')
 const alive=useRef(true),operation=useRef(false),controller=useRef<AbortController|null>(null)
 const busy=status!=='idle',group=library.groups.find(item=>item.id===groupId),wallets=groupId==='all'?library.wallets:library.wallets.filter(item=>group?.walletIds.includes(item.id)),selectedIds=selection??wallets.map(item=>item.id),selected=wallets.filter(item=>selectedIds.includes(item.id))
 const unresolved=receipts.some(row=>row.status==='unknown'||row.status==='submitted')||!!pending,blocked=storageError||unresolved
 const refreshHistory=()=>{try{setRoutes(readRelayRoutes());setReceipts(readRelayReceipts());setSales(readSaleHistory());setPending(readTradePending());setStorageError(false)}catch(reason){setStorageError(true);setError(errorText(reason))}}
 useEffect(()=>{alive.current=true;useWalletLibraryStore.getState().hydrate();refreshHistory();window.addEventListener('storage',refreshHistory);return()=>{alive.current=false;controller.current?.abort();window.removeEventListener('storage',refreshHistory)}},[])
 const assertOpen=()=>{if(!alive.current||controller.current?.signal.aborted)throw new Error('The queue was stopped. Check submitted signatures before continuing.')}
 const task=async(kind:typeof status,action:()=>Promise<void>)=>{if(operation.current)return;operation.current=true;controller.current=new AbortController();setStatus(kind);setError('');setNotice('');try{await action()}catch(reason){if(alive.current)setError(errorText(reason))}finally{operation.current=false;if(alive.current){setStatus('idle');setProgress('');refreshHistory()}}}
 const libraryWallet=(id:string,address?:string)=>{const state=useWalletLibraryStore.getState(),wallet=state.wallets.find(item=>item.id===id);if(!wallet||(address&&wallet.publicKey!==address))throw new Error('A selected wallet changed or was removed. Review again.');return wallet}
 const signerAddress=(id:string)=>useWalletLibraryStore.getState().getKeypair(id)?.publicKey.toBase58()
 const sign=async(id:string,transaction:import('@solana/web3.js').VersionedTransaction)=>{assertOpen();const key=useWalletLibraryStore.getState().getKeypair(id);if(!key)throw new Error('Unlock the selected wallet before signing.');transaction.sign([key]);return transaction}
 const parameters=()=>{if(!/^\d+(\.\d{1,2})?$/.test(slippage)||Number(slippage)>50)throw new Error('Choose slippage between 0 and 50%.');if(!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(priority)||Number(priority)>0.01)throw new Error('Choose a priority fee between 0 and 0.01 SOL.');const [whole,fraction='']=priority.split('.');return{slippageBps:Math.round(Number(slippage)*100),priorityFeeLamports:(BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'))).toString()}}
 const scan=async(chosen:WalletSummary[])=>task('scanning',async()=>{
  if(!chosen.length)throw new Error('Select a wallet to scan.')
  const nextErrors:Record<string,string>={};let completed=0
  for(const wallet of chosen){assertOpen();libraryWallet(wallet.id,wallet.publicKey);setProgress(`Scanning ${++completed} of ${chosen.length} · ${wallet.name}`)
   try{const value=await scanRelayWallet(connection,wallet.publicKey);assertOpen();libraryWallet(wallet.id,wallet.publicKey);setScans(previous=>({...previous,[wallet.id]:value}));setAssets(previous=>{const next=new Set([...previous].filter(id=>!id.startsWith(`${wallet.id}:`)));value.assets.filter(item=>(item.eligible||item.saleEligible)&&BigInt(item.amountRaw)>0n).forEach(item=>next.add(assetId(wallet.id,item)));return next});setScanErrors(previous=>{const next={...previous};delete next[wallet.id];return next})}catch(reason){assertOpen();nextErrors[wallet.id]=errorText(reason);setScans(previous=>{const next={...previous};delete next[wallet.id];return next});setScanErrors(previous=>({...previous,[wallet.id]:errorText(reason)}))}
  }
  setNotice(Object.keys(nextErrors).length?`${completed-Object.keys(nextErrors).length} of ${completed} wallets scanned. Failed scans are shown below; they are excluded from reviews.`:`${completed} wallet${completed===1?'':'s'} scanned from the chain.`)
 })
 const chosenAssets=(chosen:WalletSummary[])=>{
  if(!chosen.length)throw new Error('Select at least one wallet.')
  if(chosen.some(wallet=>!scans[wallet.id]||scanErrors[wallet.id]))throw new Error('Scan every selected wallet successfully before reviewing the group. You can select fewer wallets.')
  return chosen.flatMap(wallet=>scans[wallet.id].assets.filter(asset=>assets.has(assetId(wallet.id,asset))&&(asset.eligible||asset.saleEligible)&&BigInt(asset.amountRaw)>0n).map(asset=>({wallet,asset})))
 }
 const reviewSales=async(chosen:WalletSummary[])=>task('preparing',async()=>{
  if(blocked)throw new Error('Check saved transactions before another operation.')
  const items=chosenAssets(chosen),requests:SaleRequest[]=[],nonAssociated:typeof items=[]
  for(const {wallet,asset} of items){const ata=getAssociatedTokenAddressSync(new PublicKey(asset.mint),new PublicKey(wallet.publicKey),false,new PublicKey(asset.tokenProgram)).toBase58();if(asset.account!==ata){nonAssociated.push({wallet,asset});continue}requests.push({walletId:wallet.id,walletName:wallet.name,payer:wallet.publicKey,mint:asset.mint,amountRaw:asset.amountRaw,decimals:asset.decimals,tokenProgram:asset.tokenProgram})}
  if(!requests.length)throw new Error(nonAssociated.length?'These balances are held in non-associated accounts. Relay them to a recipient wallet before preparing sales.':'Select at least one token balance to sell.')
  if(nonAssociated.length)throw new Error(`${nonAssociated.length} selected balances need Relay to a recipient account before selling. Deselect them to review the other sales.`)
  for(const wallet of chosen)if(!signerAddress(wallet.id))throw new Error(`Unlock ${wallet.name} before preparing sales.`)
  const options=parameters(),batch=await prepareSaleBatch(connection,requests,options,{onProgress:(completed,total)=>{if(alive.current)setProgress(`Preparing sale quotes · ${completed} of ${total}`)},assertAvailable:()=>{assertOpen();chosen.forEach(wallet=>libraryWallet(wallet.id,wallet.publicKey));if(readTradePending())throw new Error('Check the pending trade first.')}})
  assertOpen();setReview({kind:'sell',batch});setApproved(false)
 })
 const reviewRelay=async(chosen:WalletSummary[])=>task('preparing',async()=>{
  if(blocked)throw new Error('Check saved transactions before another operation.')
  const selectedItems=chosenAssets(chosen),excluded=selectedItems.filter(({asset})=>!asset.eligible).map(({wallet,asset})=>({walletName:wallet.name,mint:asset.mint,reason:asset.reason||'This token cannot be relayed.'})),items=selectedItems.filter(({asset})=>asset.eligible);if(!items.length||items.length>100)throw new Error('Select between one and 100 token accounts to relay.')
  const rows:ReviewedRelay[]=[],reserved=new Map<string,bigint>(),priorityFeeLamports=parameters().priorityFeeLamports
  for(const {wallet,asset} of items){assertOpen();if(!signerAddress(wallet.id))throw new Error(`Unlock ${wallet.name} before preparing transfers.`)
   const route=routes.find(item=>item.sourceWalletId===wallet.id);if(!route)throw new Error(`Save a recipient route for ${wallet.name} first.`)
   const recipient=libraryWallet(route.destinationWalletId)
   const prepared=await prepareRelayTransfer(connection,{source:wallet.publicKey,destination:recipient.publicKey,mint:asset.mint,sourceAccount:asset.account,tokenProgram:asset.tokenProgram,amountRaw:asset.amountRaw,decimals:asset.decimals,priorityFeeLamports});assertOpen()
   const debit=(reserved.get(wallet.id)||0n)+BigInt(prepared.preview.maxDebitLamports);if(debit>BigInt(prepared.preview.sourceBeforeLamports))throw new Error(`${wallet.name} needs more SOL for all selected account rent and fees.`);reserved.set(wallet.id,debit)
   rows.push({walletId:wallet.id,destinationWalletId:recipient.id,routeId:route.id,name:wallet.name,prepared})
  }
  setReview({kind:'relay',rows,excluded});setApproved(false)
 })
 const execute=async()=>{
  if(!review||!approved)return
  const original=review
  await task('sending',async()=>{
   if(original.kind==='sell'){
    const result=await executeSaleBatch(connection,original.batch,{approved:true,signal:controller.current!.signal,readSigner:id=>signerAddress(id),sign,assertAvailable:assertOpen,onChange:value=>{if(alive.current){setSales(previous=>[value,...previous.filter(row=>row.id!==value.id)]);setProgress(`${value.rows.filter(row=>row.status==='confirmed').length} sales confirmed`)}}})
    const changedWallets=new Set(result.rows.filter(row=>row.status==='confirmed'||row.status==='unknown').map(row=>row.walletId))
    setScans(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!changedWallets.has(id))))
    if(result.status!=='completed')throw new Error(result.error||(result.status==='partial'?'Available sales completed. Unavailable tokens remain in their wallets.':'The sale queue stopped. Check saved receipts.'))
    setNotice(`${result.rows.length} token sales confirmed. SOL proceeds remain in their signing wallets.`)
   }else{
    let confirmed=0
    for(const row of original.rows){const expected=row.prepared.input,validate=()=>{assertOpen();libraryWallet(row.walletId,expected.source);libraryWallet(row.destinationWalletId,expected.destination);const route=readRelayRoutes().find(item=>item.id===row.routeId);if(!route||route.sourceWalletId!==row.walletId||route.destinationWalletId!==row.destinationWalletId)throw new Error('The saved Relay route changed. Review a fresh transfer.')}
     validate();setProgress(`Relaying ${confirmed+1} of ${original.rows.length} · ${row.name}`)
     const fresh=await prepareRelayTransfer(connection,expected);validate();if(BigInt(fresh.preview.maxDebitLamports)>BigInt(row.prepared.preview.maxDebitLamports))throw new Error('Transfer costs increased beyond the reviewed reserve. Review again.')
     const result=await executeRelayTransfer(connection,fresh,{approved:true,readSigner:()=>signerAddress(row.walletId),sign:transaction=>sign(row.walletId,transaction),signal:controller.current!.signal,assertAvailable:validate,onChange:()=>{if(alive.current)refreshHistory()}})
     if(result.status!=='confirmed')throw new Error(result.error||'The Relay queue stopped. Check the saved original signature.')
     confirmed++;setScans(previous=>{const next={...previous};delete next[row.walletId];delete next[row.destinationWalletId];return next})
    }
    setNotice(`${confirmed} token transfers confirmed. Rescan to see recipient balances.`)
   }
  })
  if(alive.current){setReview(null);setApproved(false);refreshHistory()}
 }
 const createRoute=()=>{try{if(busy||blocked)return;saveRelayRoute({name:routeName,sourceWalletId:sourceId,destinationWalletId:recipientId},library.wallets);setRouteName('');refreshHistory();setNotice('Relay route saved on this device.')}catch(reason){setError(errorText(reason))}}
 const unlock=()=>{const ids=selected.filter(wallet=>!library.unlockedIds.includes(wallet.id)).map(wallet=>wallet.id).slice(0,20);if(!ids.length){setNotice('The selected wallets are already unlocked.');return}setUnlockIds(ids);setPassphrase('')}
 const check=()=>task('checking',async()=>{await reconcileRelayTransfers(connection);assertOpen();await reconcilePendingTrade(connection);assertOpen();reconcileSaleHistory();refreshHistory();setNotice('Saved signatures checked. Uncertain transactions remain protected; nothing was resent.')})
 const toggleWallet=(id:string)=>{setSelection(previous=>{const values=previous??wallets.map(wallet=>wallet.id);return values.includes(id)?values.filter(value=>value!==id):[...values,id]});setReview(null)}
 const newSource=(created:WalletSummary[])=>{setSourceId(created[0]?.id||'');setSelection(null);setNotice(`${created.length} encrypted source wallet${created.length===1?'':'s'} created.`)}
 const newRecipient=(created:WalletSummary[])=>{setRecipientId(created[0]?.id||'');setSelection(null);setNotice(`${created.length} encrypted recipient wallet${created.length===1?'':'s'} created.`)}
 return <div className="min-h-screen flex flex-col"><Header/><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
  <div className={styles.heading}><div><h1>Relay wallets</h1><p>Move tokens to a new wallet. Review sales in one place. The same encrypted wallets work with your sniper sessions.</p></div><Link className="secondary-action" href="/automations?mode=new-launch">Configure sniper<ArrowUpRight size={15}/></Link></div>
  <div className={styles.intro}><ShieldCheck size={20} className="shrink-0"/><span>0% OutSol fee. Token relays preserve SOL apart from fees and account rent. Sales return SOL to the signing wallet.</span></div>
  {error&&<div role="alert" className="notice notice-error mb-5">{error}</div>}{notice&&<p role="status" className="notice mb-5">{notice}</p>}{progress&&<p role="status" className="notice mb-5 flex items-center gap-3"><Loader2 size={16} className="animate-spin"/>{progress}{status==='sending'&&<Button variant="ghost" onClick={()=>controller.current?.abort()}>Stop remaining actions</Button>}</p>}
  {unresolved&&<div className="notice mb-5"><p>A saved transaction needs confirmation. Further operations remain protected.</p><Button variant="secondary" className="mt-3" disabled={busy} onClick={check}>Check saved transactions</Button><Link className="ml-4 underline text-sm" href="/activity">Open Activity</Link></div>}
  <div className={styles.grid}><section className={styles.panel} aria-label="Wallet holdings">
   <div className={styles.toolbar}><label>Wallet group<select value={groupId} disabled={busy} onChange={e=>{setGroupId(e.target.value);setSelection(null);setReview(null)}}><option value="all">All wallets · {library.wallets.length}</option>{library.groups.map(item=><option value={item.id} key={item.id}>{item.name} · {item.walletIds.length}</option>)}</select></label><div className={styles.actions}><Button variant="secondary" disabled={busy||!selected.length} onClick={()=>void scan(selected)}><RefreshCw size={15}/>{status==='scanning'?'Scanning…':'Scan selected'}</Button><Button variant="ghost" disabled={busy||!selected.length} onClick={unlock}><LockKeyhole size={15}/>Unlock</Button></div></div>
   {!library.hydrated?<div className={styles.stack} aria-busy="true" aria-label="Restoring encrypted wallet library"><div className={styles.skeleton}/><div className={styles.skeleton}/></div>:!wallets.length?<div className={styles.empty}><Wallet size={30}/><h2>Give your tokens a new home.</h2><p>Create a source and recipient wallet, or import existing wallets into your encrypted library. Nothing is transferred until you review and sign.</p><div className={`${styles.actions} justify-center`}><CreateManagedWallets title="Create source wallet" defaultPrefix="Source" disabled={busy} onCreated={newSource}/><Link className="secondary-action" href="/wallet?action=import">Import wallets</Link></div></div>:<>
    <div className={`${styles.actions} mb-5`}><Button variant="secondary" disabled={busy||blocked} onClick={()=>void reviewRelay(selected)}>Review selected relays<ArrowRight size={14}/></Button><Button disabled={busy||blocked} onClick={()=>void reviewSales(selected)}>Review selected sales<ArrowUpRight size={14}/></Button><span className={styles.quiet}>{selected.length} wallets selected</span></div>
    <div className={styles.stack}>{wallets.map(wallet=>{const value=scans[wallet.id],route=routes.find(item=>item.sourceWalletId===wallet.id),recipient=library.wallets.find(item=>item.id===route?.destinationWalletId),unlocked=library.unlockedIds.includes(wallet.id);return <article key={wallet.id} className={styles.wallet}><div className={styles.walletHead}><div className={styles.identity}><input type="checkbox" aria-label={`Select ${wallet.name}`} checked={selectedIds.includes(wallet.id)} disabled={busy} onChange={()=>toggleWallet(wallet.id)}/><div><h3>{wallet.name} <span className={styles.quiet}>· {unlocked?'Unlocked':'Locked'}</span></h3><a className={styles.address} href={`https://solscan.io/account/${wallet.publicKey}`} target="_blank" rel="noreferrer">{short(wallet.publicKey)}<ExternalLink size={11}/></a><p className={styles.balance}>{value?`${sol(value.solLamports)} SOL · ${new Date(value.scannedAt).toLocaleTimeString()}`:'Not scanned'}{recipient?` · Relay to ${recipient.name}`:''}</p></div></div><Button variant="ghost" disabled={busy} onClick={()=>void scan([wallet])}>Scan wallet</Button></div>
     {scanErrors[wallet.id]&&<p className="notice notice-error m-4" role="alert">{scanErrors[wallet.id]} Scan again before preparing this wallet.</p>}
     {value&&<div className={styles.tokens}>{value.assets.length?value.assets.map(asset=><div className={styles.token} key={asset.account}><input type="checkbox" aria-label={`Select ${asset.mint} in ${wallet.name}`} checked={assets.has(assetId(wallet.id,asset))} disabled={busy||(!asset.eligible&&!asset.saleEligible)||asset.amountRaw==='0'} onChange={e=>{setAssets(previous=>{const next=new Set(previous);if(e.target.checked)next.add(assetId(wallet.id,asset));else next.delete(assetId(wallet.id,asset));return next});setReview(null)}}/><div className={styles.tokenInfo}><a href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer">{short(asset.mint)}<ExternalLink size={11} className="inline ml-1"/></a><p>{asset.eligible?asset.tokenProgram==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'?'SPL Token':'Token-2022':asset.saleEligible?'Sale review available · Relay unavailable':asset.reason||'Unavailable'}</p></div><span className={styles.amount}>{asset.eligible||asset.saleEligible?formatRawBalance(asset.amountRaw,asset.decimals,9):`${asset.amountRaw} raw units`}</span></div>):<p className="py-6 text-sm text-muted">No token balances found in this scan.</p>}</div>}
     {value&&<div className={styles.walletActions}><Button variant="ghost" disabled={busy||blocked||!route} onClick={()=>void reviewRelay([wallet])}>Relay this wallet</Button><Button variant="ghost" disabled={busy||blocked} onClick={()=>void reviewSales([wallet])}>Sell this wallet</Button></div>}
    </article>})}</div>
   </>}
  </section><aside className={styles.stack}><section className={styles.panel}><h2>Source → recipient</h2><p className={styles.sub}>Save a route for each source wallet. Recipient wallets stay available here for holding or selling the tokens they receive.</p><div className={styles.routeForm}><label className={styles.field}>Route name<Input maxLength={64} value={routeName} placeholder="Sniper → holding wallet" disabled={busy||blocked} onChange={e=>setRouteName(e.target.value)}/></label><label className={styles.field}>Source wallet<select value={sourceId} disabled={busy||blocked} onChange={e=>setSourceId(e.target.value)}><option value="">Choose a wallet</option>{library.wallets.map(wallet=><option value={wallet.id} key={wallet.id}>{wallet.name} · {short(wallet.publicKey)}</option>)}</select></label><CreateManagedWallets title="Create source wallet" defaultPrefix="Sniper" maxCount={20} disabled={busy||blocked} onCreated={newSource}/><label className={styles.field}>Recipient wallet<select value={recipientId} disabled={busy||blocked} onChange={e=>setRecipientId(e.target.value)}><option value="">Choose a wallet</option>{library.wallets.filter(wallet=>wallet.id!==sourceId).map(wallet=><option value={wallet.id} key={wallet.id}>{wallet.name} · {short(wallet.publicKey)}</option>)}</select></label><CreateManagedWallets title="Create recipient wallet" defaultPrefix="Recipient" maxCount={20} disabled={busy||blocked} onCreated={newRecipient}/><Button disabled={busy||blocked||!routeName.trim()||!sourceId||!recipientId||sourceId===recipientId} onClick={createRoute}>Save route<ArrowRight size={14}/></Button></div>
    <div className={`${styles.stack} mt-5`}>{routes.map(route=><div className={styles.route} key={route.id}><p>{route.name}</p><small>{library.wallets.find(wallet=>wallet.id===route.sourceWalletId)?.name||'Missing source'} → {library.wallets.find(wallet=>wallet.id===route.destinationWalletId)?.name||'Missing recipient'}</small><Button variant="ghost" disabled={busy||blocked} onClick={()=>{try{removeRelayRoute(route.id);refreshHistory()}catch(reason){setError(errorText(reason))}}}>Remove route</Button></div>)}</div>
   </section><section className={styles.panel}><h2>Execution settings</h2><div className={styles.routeForm}><label className={styles.field}>Sale slippage · %<Input type="number" min="0" max="50" step="0.1" value={slippage} disabled={busy} onChange={e=>{setSlippage(e.target.value);setReview(null)}}/></label><label className={styles.field}>Priority fee ceiling · SOL<Input inputMode="decimal" value={priority} disabled={busy} onChange={e=>{setPriority(e.target.value);setReview(null)}}/></label></div><p className={`${styles.quiet} mt-4`}>Sales use native Pump.fun or a validated Jupiter market route. Tokens with no available market or unsupported transfer rules stay visible and remain in the wallet.</p><Link className={`${styles.link} text-sm inline-block mt-4`} href="/wallet">Wallet groups, funding & withdrawals</Link></section></aside></div>
  {(receipts.length>0||sales.length>0)&&<section className={`${styles.panel} ${styles.ledger}`}><div className={styles.toolbar}><div><h2>Recent operations</h2><p className={styles.sub}>Saved on this device. Refreshing never restarts a queue.</p></div><Button variant="secondary" disabled={busy} onClick={check}>Check saved transactions</Button></div>{sales.slice(0,5).map(batch=><div className={styles.ledgerRow} key={batch.id}><div><strong>Token sales · {batch.rows.filter(row=>row.status==='confirmed').length}/{batch.rows.length} confirmed</strong><p>{new Date(batch.updatedAt).toLocaleString()}{batch.error?` · ${batch.error}`:''}</p>{batch.rows.filter(row=>row.signature).map(row=><a key={row.signature} className="inline-flex text-xs underline mr-4 mt-2 gap-1" href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">{row.walletName} · {short(row.mint)}<ExternalLink size={11}/></a>)}</div><span className={styles.status}>{batch.status}</span></div>)}{receipts.slice(0,8).map(receipt=><div className={styles.ledgerRow} key={receipt.signature}><div><strong>Relay · {short(receipt.mint)}</strong><p>{short(receipt.source)} → {short(receipt.destination)} · {new Date(receipt.createdAt).toLocaleString()}</p><a className="inline-flex text-xs underline mt-2 gap-1" href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer">Original transaction<ExternalLink size={11}/></a></div><span className={styles.status}>{receipt.status}</span></div>)}</section>}
  <RelayReview review={review} busy={status==='sending'} approved={approved} onApprove={setApproved} onClose={()=>{if(!busy){setReview(null);setApproved(false)}}} onExecute={()=>void execute()}/>
  <Dialog open={unlockIds.length>0} onOpenChange={next=>{if(!next&&!busy){setUnlockIds([]);setPassphrase('')}}}><DialogContent><DialogTitle>Unlock {unlockIds.length} wallets</DialogTitle><DialogDescription>Use the passphrase that encrypts these wallets. Keys stay in this browser session. Unlock larger groups in batches of up to 20.</DialogDescription><form className="space-y-5" onSubmit={e=>{e.preventDefault();void task('preparing',async()=>{await library.unlockWallets(unlockIds,passphrase);setPassphrase('');setUnlockIds([]);setNotice('Selected wallets unlocked for this session.')})}}><label className={styles.field}>Wallet passphrase<Input type="password" autoComplete="current-password" required value={passphrase} disabled={busy} onChange={e=>setPassphrase(e.target.value)}/></label>{error&&<p role="alert" className="notice notice-error">{error}</p>}<Button className="w-full" disabled={busy||!passphrase}>Unlock wallets</Button></form></DialogContent></Dialog>
 </main><Footer/></div>
}
