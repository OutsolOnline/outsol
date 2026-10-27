'use client'

import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {useConnection,useWallet} from '@solana/wallet-adapter-react'
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui'
import {VersionedTransaction} from '@solana/web3.js'
import {ArrowDownLeft,ArrowUpRight,ArrowRight,Check,ExternalLink,Loader2,RefreshCw,ShieldCheck,Wallet} from 'lucide-react'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {BuyPresets} from '@/components/launch/BuyPresets'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {readPending} from '@/lib/launchHistory'
import {withTimeout} from '@/lib/transactions/http'
import {sendAndConfirmTransaction,signedTransactionSignature} from '@/lib/transactions/send'
import {formatRawBalance,inspectTradeIntent,preparePumpTrade,readTokenPosition,type PreparedTrade,type TokenPosition,type TradeInput} from '@/lib/venues/trade'
import {clearTradePending,readTradeHistory,readTradePending,saveTradePending,type PendingTrade,type TradeReceipt} from '@/lib/venues/tradeHistory'
import {reconcilePendingTrade,reconcileTradeRecord,type TradeRecoveryResult} from '@/lib/venues/tradeRecovery'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'

type Status='idle'|'loading'|'preparing'|'ready'|'signing'|'sending'|'checking'|'confirmed'|'failed'|'unknown'
const short=(address:string)=>`${address.slice(0,6)}…${address.slice(-6)}`
const sol=(raw:string)=>formatRawBalance(raw,9,9)

export function ManageContent({embedded=false,initialMint=''}:{embedded?:boolean;initialMint?:string}={}){
  const {connection}=useConnection(),external=useWallet(),vault=usePlatformWalletStore()
  const [source,setSource]=useState<'external'|'vault'>('external')
  const [mint,setMint]=useState(()=>initialMint||(typeof window!=='undefined'?new URLSearchParams(window.location.search).get('mint')||'':''))
  const [action,setAction]=useState<'buy'|'sell'>('buy'),[buySol,setBuySol]=useState('0.1'),[sellPercent,setSellPercent]=useState(25)
  const [slippage,setSlippage]=useState(5),[priority,setPriority]=useState(0.0005)
  const [position,setPosition]=useState<TokenPosition|null>(null),[prepared,setPrepared]=useState<PreparedTrade|null>(null),[approved,setApproved]=useState(false)
  const [status,setStatus]=useState<Status>('idle'),[error,setError]=useState(''),[pending,setPending]=useState<PendingTrade|null>(null),[history,setHistory]=useState<TradeReceipt[]>([])
  const operation=useRef(false),alive=useRef(true),controller=useRef<AbortController|null>(null)
  const unlockedVault=vault.getPublicKey(),externalAddress=external.publicKey?.toBase58()
  const payer=source==='vault'?(unlockedVault||vault.getSelectedAddress()):externalAddress
  const canSign=source==='vault'?!!unlockedVault:!!(externalAddress&&external.signTransaction)
  const busy=['loading','preparing','signing','sending','checking'].includes(status)
  const blocked=!!pending||status==='unknown'
  const currentPosition=position&&position.payer===payer&&position.mint===mint.trim()?position:null

  useEffect(()=>{
    alive.current=true
    const recover=()=>{try{setPending(readTradePending());setHistory(readTradeHistory())}catch(e){setError(e instanceof Error?e.message:'Recovery storage is unavailable');setStatus('unknown')}}
    recover();window.addEventListener('storage',recover)
    return()=>{alive.current=false;controller.current?.abort();window.removeEventListener('storage',recover)}
  },[])
  useEffect(()=>{setPrepared(null);setApproved(false);setPosition(null)},[payer])

  const resetReview=()=>{setPrepared(null);setApproved(false);setError('');if(!pending)setStatus('idle')}
  const signerNow=()=>source==='vault'?usePlatformWalletStore.getState().getPublicKey():external.wallet?.adapter.publicKey?.toBase58()
  const assertAvailable=()=>{
    if(!alive.current)throw new Error('The trade screen was closed. Nothing was submitted.')
    if(readPending())throw new Error('A launch is awaiting confirmation. Resolve it on the launch page before trading.')
    if(readTradePending())throw new Error('Check the saved trade before preparing another transaction.')
    assertNoPendingWalletOperation()
    assertNoPendingGroupOperation()
    assertNoPendingBundleReceipt()
  }
  const load=async()=>{
    if(operation.current||!payer)return
    operation.current=true;setError('');setStatus('loading');setPrepared(null);setApproved(false)
    try{const loaded=await readTokenPosition(connection,mint.trim(),payer);if(alive.current){setPosition(loaded);setStatus('idle')}}
    catch(e){if(alive.current){setPosition(null);setError(e instanceof Error?e.message:'Token balances could not be loaded');setStatus('failed')}}
    finally{operation.current=false}
  }
  const prepare=async()=>{
    if(operation.current||!payer||!canSign)return
    operation.current=true;setError('');setPrepared(null);setApproved(false);setStatus('preparing')
    try{
      assertAvailable()
      const input:TradeInput={action,mint:mint.trim(),payer,buySol,sellPercent,slippage,priorityFeeSol:priority}
      const next=await preparePumpTrade(connection,input)
      if(!alive.current||signerNow()!==payer)throw new Error('The signing wallet changed. Prepare again with the current wallet.')
      setPosition(next.position);setPrepared(next);setStatus('ready')
    }catch(e){if(alive.current){setError(e instanceof Error?e.message:'The trade could not be prepared');setStatus('failed')}}
    finally{operation.current=false}
  }
  const applyRecovery=(result:TradeRecoveryResult)=>{
    if(alive.current){
      setPending(result.pending);setHistory(readTradeHistory())
      setStatus(result.pending?'unknown':result.status==='confirmed'||result.status==='failed'?result.status:'idle')
      setError(result.error||(result.status==='changed'?'The recovery record changed. Check the latest saved transaction.':''))
    }
    return result.pending||!['confirmed','failed'].includes(result.status)?'unknown':result.status
  }
  const resolve=async(record:PendingTrade)=>applyRecovery(await reconcileTradeRecord(connection,{expectedSignature:record.signature}))
  const reconcile=async()=>{
    if(operation.current)return
    operation.current=true;setStatus('checking');setError('')
    try{applyRecovery(await reconcilePendingTrade(connection))}
    catch(e){setStatus('unknown');setError(e instanceof Error?e.message:'Confirmation could not be checked')}
    finally{operation.current=false}
  }
  const sign=async()=>{
    if(operation.current||!prepared||!approved||!canSign)return
    if(!navigator.locks){setError('Use a current browser with secure cross-tab transaction coordination.');return}
    operation.current=true;setError('')
    try{
      await navigator.locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
        if(!lock)throw new Error('Another tab is signing or submitting a transaction. Finish it there first.')
        assertAvailable()
        if(signerNow()!==prepared.input.payer)throw new Error('The wallet changed or its vault was locked. Prepare again.')
        if(Date.now()-prepared.createdAt>60_000||!(await withTimeout(connection.isBlockhashValid(prepared.transaction.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('This preview expired. Refresh the preview for current prices and fees.')
        controller.current=new AbortController();setStatus('signing')
        const unsigned=VersionedTransaction.deserialize(prepared.transaction.serialize())
        const signed=source==='vault'?await usePlatformWalletStore.getState().signTransaction(unsigned) as VersionedTransaction:await external.signTransaction!(unsigned)
        if(Buffer.from(signed.message.serialize()).toString('base64')!==prepared.message)throw new Error('The wallet changed the reviewed trade. Nothing was submitted.')
        inspectTradeIntent(signed,prepared.input,BigInt(prepared.maxSellRaw))
        if(!alive.current||controller.current.signal.aborted||signerNow()!==prepared.input.payer)throw new Error('The wallet disconnected, vault locked or trade screen closed. Nothing was submitted.')
        const validity=await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash,{commitment:'confirmed'}))
        if(!validity.value)throw new Error('The trade expired while signing. Prepare a new preview.')
        const recoveryBound=await withTimeout(connection.getLatestBlockhash({commitment:'confirmed',minContextSlot:validity.context.slot}))
        const signature=signedTransactionSignature(signed)
        const record:PendingTrade={action:prepared.input.action,mint:prepared.input.mint,payer:prepared.input.payer,signature,blockhash:signed.message.recentBlockhash,submittedAt:new Date().toISOString(),maxBuyLamports:prepared.maxBuyLamports,maxSellRaw:prepared.maxSellRaw,expiryBlockHeight:recoveryBound.lastValidBlockHeight}
        let saved=false
        const receipt=await sendAndConfirmTransaction(connection,signed,{signal:controller.current.signal,onBroadcast:()=>{
          assertAvailable()
          if(signerNow()!==prepared.input.payer)throw new Error('The signing wallet is no longer available')
          saveTradePending(record);saved=true
          if(alive.current){setPending(record);setStatus('sending')}
        }})
        if(receipt.submitted===false){if(saved)clearTradePending(signature);if(alive.current)setPending(null);throw new Error(receipt.error||'Nothing was submitted')}
        if(!alive.current)return
        setPrepared(null);setApproved(false)
        if(receipt.status==='confirmed'||receipt.status==='failed'){
          if(await resolve(record)!=='unknown'){
            try{setPosition(await readTokenPosition(connection,record.mint,record.payer))}catch{ /* The receipt remains confirmed if a later balance refresh fails. */ }
            return
          }
        }
        setStatus('unknown');setError(receipt.error||'Confirmation is unknown. Check the saved signature before trading again.')
      })
    }catch(e){if(alive.current){let saved:PendingTrade|null=null;try{saved=readTradePending();setPending(saved)}catch{}setStatus(saved?'unknown':'failed');setError(e instanceof Error?e.message:'The trade did not complete');setPrepared(null)}}
    finally{operation.current=false;controller.current=null}
  }

  const ContentTag=embedded?'div':'main'
  return <div className={embedded?'':'min-h-screen flex flex-col'}>{!embedded&&<Header/>}<ContentTag id={embedded?undefined:'workspace-content'} tabIndex={-1} className={embedded?'':'workspace-main flex-1'}><div className="max-w-6xl mx-auto">
    <div className="page-heading"><div className="eyebrow">TOKEN MANAGEMENT</div><h1>Manage your token.</h1><p>Check your Pump.fun position, review the price and make your next move.</p></div>
    <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)] gap-7 items-start">
      <div className="space-y-6">
        <section className="form-section"><div className="flex items-center gap-2 mb-5"><Wallet size={16} className="text-accent"/><h2 className="text-base">Your trading wallet</h2></div>
          <fieldset disabled={busy} className="space-y-4"><div className="launch-mode-tabs" role="group" aria-label="Trading wallet"><button className={`launch-mode-tab ${source==='external'?'selected':''}`} aria-pressed={source==='external'} onClick={()=>{setSource('external');resetReview()}}>Connected wallet</button><button className={`launch-mode-tab ${source==='vault'?'selected':''}`} aria-pressed={source==='vault'} onClick={()=>{setSource('vault');resetReview()}}>Local vault</button></div>
            {source==='external'?<WalletMultiButton/>:<p className="text-sm text-muted">{unlockedVault?'Your local vault is unlocked.':<>Unlock your <Link className="text-accent underline" href="/wallet">encrypted wallet vault</Link> before signing.</>}</p>}
            {payer&&<p className="font-mono text-xs text-muted break-all">{payer}</p>}
          </fieldset>
        </section>
        <section className="form-section"><h2 className="text-base mb-5">Load your token</h2><label className="field-label" htmlFor="manage-mint">Solana mint address</label><div className="flex flex-col sm:flex-row gap-3"><Input id="manage-mint" autoComplete="off" spellCheck={false} placeholder="Paste a token mint address" value={mint} disabled={busy} onChange={event=>{setMint(event.target.value);setPosition(null);resetReview()}}/><Button variant="secondary" disabled={busy||!payer||!mint.trim()} onClick={load}>{status==='loading'?<Loader2 size={15} className="animate-spin"/>:'Load token'}</Button></div>
          <p className="field-help">Solana mainnet · available tokens are held in your wallet’s associated token account.</p>
          {currentPosition&&<div className="grid grid-cols-2 gap-4 mt-6"><div className="rounded-xl bg-white/[0.025] border border-border p-4"><div className="eyebrow">TOKEN BALANCE</div><p className="text-lg mt-2 font-mono break-all">{formatRawBalance(currentPosition.tokenRaw,currentPosition.decimals)}</p></div><div className="rounded-xl bg-white/[0.025] border border-border p-4"><div className="eyebrow">WALLET SOL</div><p className="text-lg mt-2 font-mono">{sol(currentPosition.solLamports)}</p></div></div>}
        </section>
        {currentPosition?.status==='active'?<section className="form-section"><div className="flex items-center justify-between mb-5"><h2 className="text-base">Make a manual trade</h2><span className="text-xs tracking-wider text-accent uppercase">Native Pump.fun</span></div>
          <fieldset disabled={busy||blocked} className="space-y-6"><div className="launch-mode-tabs" role="group" aria-label="Trade direction"><button className={`launch-mode-tab ${action==='buy'?'selected':''}`} aria-pressed={action==='buy'} onClick={()=>{setAction('buy');resetReview()}}><ArrowDownLeft size={16}/>Buy</button><button className={`launch-mode-tab ${action==='sell'?'selected':''}`} aria-pressed={action==='sell'} onClick={()=>{setAction('sell');resetReview()}}><ArrowUpRight size={16}/>Sell</button></div>
            {action==='buy'?<div><label className="field-label" htmlFor="trade-sol">Maximum trade amount · SOL</label><Input id="trade-sol" inputMode="decimal" value={buySol} onChange={event=>{setBuySol(event.target.value);resetReview()}}/><p className="field-help">Protocol costs fit inside this trade ceiling. Network fees and new token-account rent are additional.</p><div className="mt-4"><BuyPresets value={Number(buySol)} onChange={amount=>{setBuySol(amount.toFixed(9).replace(/\.?0+$/,''));resetReview()}} disabled={busy||blocked} includeZero={false}/></div></div>:<div><label className="field-label" htmlFor="trade-percent">Percentage of your available tokens</label><div className="flex gap-2 mb-3">{[25,50,100].map(percent=><Button key={percent} variant={sellPercent===percent?'default':'secondary'} size="sm" onClick={()=>{setSellPercent(percent);resetReview()}}>{percent}%</Button>)}</div><Input id="trade-percent" type="number" min="1" max="100" step="1" value={sellPercent} onChange={event=>{setSellPercent(event.target.valueAsNumber);resetReview()}}/></div>}
            <details><summary className="text-sm text-muted cursor-pointer">Slippage & network settings</summary><div className="grid sm:grid-cols-2 gap-4 mt-5"><div><label className="field-label" htmlFor="trade-slippage">Slippage · %</label><Input id="trade-slippage" type="number" min="0" max="50" step="0.1" value={Number.isNaN(slippage)?'':slippage} onChange={event=>{setSlippage(event.target.valueAsNumber);resetReview()}}/></div><div><label className="field-label" htmlFor="trade-priority">Priority fee budget · SOL</label><Input id="trade-priority" type="number" min="0" max="0.01" step="0.00001" value={Number.isNaN(priority)?'':priority} onChange={event=>{setPriority(event.target.valueAsNumber);resetReview()}}/></div></div></details>
            <Button className="w-full" onClick={prepare} disabled={!canSign}>{status==='preparing'?<><Loader2 className="animate-spin mr-2" size={15}/>Preparing & simulating</>:<>Preview {action}<ArrowRight size={15} className="ml-2"/></>}</Button>
          </fieldset>
        </section>:currentPosition?<section className="form-section"><h2 className="text-base mb-3">{currentPosition.status==='graduated'?'This token has graduated.':'Open the token’s trading venue.'}</h2><p className="text-sm text-muted leading-relaxed">Native trading here supports active SOL Pump.fun curves. For this token, continue on the venue where it trades.</p><div className="flex flex-wrap gap-4 mt-5"><a className="text-accent text-sm inline-flex gap-1 items-center" href={`https://pump.fun/coin/${currentPosition.mint}`} target="_blank" rel="noreferrer">Pump.fun<ExternalLink size={12}/></a><a className="text-accent text-sm inline-flex gap-1 items-center" href={`https://raydium.io/swap/?inputMint=sol&outputMint=${currentPosition.mint}`} target="_blank" rel="noreferrer">Raydium<ExternalLink size={12}/></a><a className="text-accent text-sm inline-flex gap-1 items-center" href="https://app.meteora.ag/" target="_blank" rel="noreferrer">Meteora<ExternalLink size={12}/></a></div></section>:null}
        {error&&<div className="notice notice-error" role="alert">{error}</div>}
        {status==='confirmed'&&!pending&&<div className="notice"><Check size={16} className="inline text-accent mr-2"/>Trade confirmed on Solana. Your updated balance is shown above.</div>}
        {pending&&<section className="form-section border-yellow-500/30" aria-live="polite"><div className="eyebrow">SAVED TRADE · CONFIRMATION CHECK</div><p className="text-sm text-muted mt-3 leading-relaxed">This {pending.action} may already have landed. It will never be resent automatically.</p><a className="text-xs text-accent font-mono break-all inline-block mt-4" href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">{pending.signature}</a><Button variant="secondary" className="mt-5" disabled={busy} onClick={reconcile}><RefreshCw size={14} className={`mr-2 ${status==='checking'?'animate-spin':''}`}/>Check confirmation</Button></section>}
      </div>
      <aside className="launch-summary"><div className="eyebrow">REVIEW BEFORE YOU SIGN</div><h2 className="text-2xl tracking-tight mt-4">Your move, clearly priced.</h2><dl className="mt-6"><div className="summary-row"><dt>OutSol platform fee</dt><dd className="!text-accent">0 SOL · always</dd></div><div className="summary-row"><dt>Network</dt><dd>Solana mainnet</dd></div><div className="summary-row"><dt>Wallet</dt><dd>{payer?short(payer):'Connect or unlock'}</dd></div></dl>
        {prepared&&<div className="mt-6 space-y-5"><div className="notice"><ShieldCheck size={15} className="inline mr-2"/>Native transaction · live simulation passed</div><dl><div className="summary-row"><dt>{prepared.input.action==='buy'?'Tokens received':'Tokens sold'}</dt><dd>{formatRawBalance((BigInt(prepared.tokenChangeRaw)<0n?-BigInt(prepared.tokenChangeRaw):BigInt(prepared.tokenChangeRaw)).toString(),prepared.position.decimals)}</dd></div><div className="summary-row"><dt>{BigInt(prepared.solChangeLamports)<0n?'Estimated SOL debit':'Estimated SOL credit'}</dt><dd>{sol((BigInt(prepared.solChangeLamports)<0n?-BigInt(prepared.solChangeLamports):BigInt(prepared.solChangeLamports)).toString())}</dd></div><div className="summary-row"><dt>Included network fee</dt><dd>{sol(prepared.networkFeeLamports)} SOL</dd></div>{prepared.input.action==='sell'&&<div className="summary-row"><dt>Minimum sale output</dt><dd>{sol(prepared.minimumSolOut)} SOL</dd></div>}</dl><p className="field-help">The estimate includes simulated protocol costs, network fees and account rent. Prices can move; the encoded spend ceiling or minimum sale output still applies. Preview expires after 60 seconds.</p><label className="text-xs text-muted leading-relaxed flex gap-3"><input type="checkbox" className="accent-[#b6f5c5] mt-1" disabled={busy||blocked} checked={approved} onChange={event=>setApproved(event.target.checked)}/>I reviewed the token address, amounts and costs. Submit this one trade.</label><Button className="w-full" disabled={!approved||busy||blocked||!canSign} onClick={sign}>{status==='signing'?'Approve in your wallet':status==='sending'?'Confirming trade':`Sign & ${prepared.input.action}`}{busy&&<Loader2 className="animate-spin ml-2" size={15}/>}</Button></div>}
        {!prepared&&<div className="notice mt-6"><ShieldCheck size={15} className="inline mr-2"/>Nothing is sent while loading balances or preparing a preview. Every trade needs your review and signature.</div>}
      </aside>
    </div>
    {history.length>0&&<section className="form-section mt-8"><div className="eyebrow mb-5">RECENT TRADES · THIS DEVICE</div><div className="space-y-4">{history.slice(0,8).map(receipt=><div key={receipt.signature} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-0 last:pb-0"><div><p className="text-sm capitalize">{receipt.action} · {short(receipt.mint)} <span className={receipt.status==='confirmed'?'text-accent':'text-red-300'}>{receipt.status}</span></p><p className="text-sm text-muted mt-1">{new Date(receipt.resolvedAt).toLocaleString()}</p></div><a className="inline-flex text-xs text-accent gap-1 items-center" href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer">View transaction<ExternalLink size={12}/></a></div>)}</div></section>}
  </div></ContentTag>{!embedded&&<Footer/>}</div>
}
