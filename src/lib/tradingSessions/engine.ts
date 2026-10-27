import {PublicKey,VersionedTransaction,type Connection} from '@solana/web3.js'
import {inspectTradeIntent,preparePumpTrade,type PreparedTrade} from '@/lib/venues/trade'
import {clearTradePending,readTradePending,saveTradePending,saveTradeReceipt,type PendingTrade} from '@/lib/venues/tradeHistory'
import {assertSubmissionSigner,sendAndConfirmTransaction,signedTransactionSignature} from '@/lib/transactions/send'
import {fetchBounded,withTimeout} from '@/lib/transactions/http'
import {readPending} from '@/lib/launchHistory'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'
import {validateSessionConfig,solLamports} from './config'
import {saveSessionJournal} from './history'
import {readSolCurveQuote,simulateSignedTrade} from './chain'
import type {LaunchFeed,LaunchFeedItem,SessionLocks,SessionPorts,SessionSigner,TradingSessionConfig,TradingSessionJournal,TradingSessionRow} from './types'

class TimeLimit extends Error {}
const message=(tx:VersionedTransaction)=>Buffer.from(tx.message.serialize()).toString('base64')
const amount=(value:string)=>{if(typeof value!=='string'||!/^\d{1,30}$/.test(value))throw new Error('A complete trade cost could not be verified.');return BigInt(value)}
const errorText=(error:unknown)=>error instanceof Error?error.message:'The browser trading session stopped.'
function available(){if(readPending())throw new Error('A launch is pending confirmation. Check Activity first.');assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt()}
function wait(milliseconds:number,signal?:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(new Error('The session was cancelled.'));return}
 const abort=()=>{clearTimeout(timer);reject(new Error('The session was cancelled.'))}
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},milliseconds)
 signal?.addEventListener('abort',abort,{once:true})
})}
const defaults:SessionPorts={now:Date.now,wait,prepare:preparePumpTrade,readCurve:readSolCurveQuote,simulateSigned:simulateSignedTrade,send:sendAndConfirmTransaction,assertAvailable:available,fetchFeed:()=>fetchBounded('/api/pump-feed',{method:'GET',cache:'no-store',credentials:'same-origin'},async response=>await response.json() as LaunchFeed)}
function checkedFeed(value:LaunchFeed,now:number):LaunchFeedItem[]{
 if(!value||value.status!=='ready'||value.coverage!=='recent-confirmed-transactions')throw new Error('The confirmed launch feed is unavailable. The session stopped; nothing will be retried automatically.')
 if(!Array.isArray(value.items)||value.items.length>200||!Number.isFinite(Date.parse(value.fetchedAt))||Math.abs(now-Date.parse(value.fetchedAt))>60_000)throw new Error('The confirmed launch feed is stale or unreadable. The session stopped.')
 return value.items.map(item=>{
  if(!item||typeof item.name!=='string'||item.name.length>200||typeof item.symbol!=='string'||item.symbol.length>50||!Number.isSafeInteger(item.timestamp)||item.timestamp<0||typeof item.signature!=='string'||!item.signature||item.signature.length>100)throw new Error('The confirmed launch feed returned an invalid launch. The session stopped.')
  return {...item,mint:new PublicKey(item.mint).toBase58(),creator:new PublicKey(item.creator).toBase58()}
 })
}
function reserve(prepared:PreparedTrade,fee:bigint,netDebit:bigint):bigint {
 // The full encoded buy ceiling remains reserved even when today's fill is cheaper.
 // This is the same conservative maximum account-rent allowance as trade preview.
 if(prepared.input.action==='buy')return amount(prepared.maxBuyLamports)+fee+10_000_000n
 return netDebit>fee?netDebit:fee
}

/** Single-use, browser-bound approval. No keypair or signed transaction is persisted. */
export class TradingSession {
 #connection:Connection;#config:TradingSessionConfig;#ports:SessionPorts;#used=false
 constructor(connection:Connection,config:TradingSessionConfig,ports:Partial<SessionPorts>={}){this.#connection=connection;this.#config=validateSessionConfig(config);this.#ports={...defaults,...ports}}
 async run(signer:SessionSigner):Promise<TradingSessionJournal>{
  if(this.#used)throw new Error('This session was already used. Review a new configuration to rearm it.')
  if(signer.approved!==true)throw new Error('Explicit session approval is required.')
  this.#used=true
  const config=this.#config,ports=this.#ports,connection=this.#connection,armedAt=ports.now(),deadline=armedAt+config.durationMs,budget=solLamports(config.maxDebitSol)
  const journal:TradingSessionJournal={version:1,id:crypto.randomUUID(),config,status:'running',phase:'monitoring',armedAt,updatedAt:armedAt,reservedDebitLamports:'0',rows:[]}
  const seen=new Set<string>();let baseline=false,submitted=false,pending:PendingTrade|null=null,active:TradingSessionRow|undefined
  const guard=(expected?:string)=>{
   assertSubmissionSigner(config.payer,signer.readSigner,signer.signal)
   if(ports.now()>=deadline)throw new TimeLimit('The approved session time limit was reached.')
   ports.assertAvailable();signer.assertAvailable?.()
   const current=readTradePending(ports.storage)
   if(expected?current?.signature!==expected:!!current)throw new Error(expected?'The saved pending trade changed. Check Manage token before continuing.':'A trade is pending confirmation. Check Manage token first.')
  }
  const checkpoint=()=>{journal.updatedAt=ports.now();saveSessionJournal(journal,ports.storage);signer.onChange?.(structuredClone(journal))}
  const capMatches=(cap:string)=>config.capDirection==='at-or-above'?amount(cap)>=solLamports(config.capSol):amount(cap)<=solLamports(config.capSol)
  const assertCap=(cap:string)=>{if(config.mode==='cap'&&!capMatches(cap))throw new Error('The SOL market cap moved outside the approved threshold. The session stopped before sending.')}
  const pause=async()=>{journal.phase='monitoring';checkpoint();guard();await ports.wait(Math.min(config.intervalMs,Math.max(1,deadline-ports.now())),signer.signal);guard()}
  const trade=async(mint:string)=>{
   const locks=ports.locks??(typeof navigator!=='undefined'?navigator.locks as unknown as SessionLocks:undefined)
   if(!locks)throw new Error('Use a current browser with secure cross-tab transaction coordination.')
   await locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is signing, submitting or recovering a transaction. This session stopped.')
    guard();submitted=false;pending=null
    const quote=await ports.readCurve(connection,mint,()=>guard());guard()
    assertCap(quote.capLamports)
    if(config.mode==='new-launch'&&config.creator&&quote.creator!==config.creator)throw new Error('The on-chain curve creator differs from the approved creator filter.')
    active={index:journal.rows.length,mint,action:config.action,status:'preparing',debitReservedLamports:'0',createdAt:ports.now()};journal.rows.push(active);journal.phase='preparing';checkpoint();guard()
    const input={action:config.action,mint,payer:config.payer,buySol:config.buySol,sellPercent:config.sellPercent,slippage:config.slippage,priorityFeeSol:config.priorityFeeSol}
    const prepared=await ports.prepare(connection,input);guard()
    if(JSON.stringify(prepared.input)!==JSON.stringify(input)||prepared.position.payer!==config.payer||prepared.position.mint!==mint||prepared.position.status!=='active')throw new Error('The native trade preview differs from the approved session.')
    const expectedBuy=input.action==='buy'?solLamports(input.buySol):0n,expectedSell=input.action==='sell'?amount(prepared.position.tokenRaw)*BigInt(input.sellPercent)/100n:0n
    if(amount(prepared.maxBuyLamports)!==expectedBuy||amount(prepared.maxSellRaw)!==expectedSell)throw new Error('The quoted buy ceiling or sell balance differs from the approved native preview.')
    if(message(prepared.transaction)!==prepared.message)throw new Error('The prepared message changed.')
    inspectTradeIntent(prepared.transaction,input,amount(prepared.maxSellRaw))
    let debit=reserve(prepared,amount(prepared.networkFeeLamports),prepared.solChangeLamports.startsWith('-')?BigInt(prepared.solChangeLamports)*-1n:0n)
    const remaining=budget-amount(journal.reservedDebitLamports)
    if(debit>remaining)throw new Error('The remaining session debit ceiling cannot cover this trade, its fee and account rent.')
    if(config.mode==='cap'){const freshQuote=await ports.readCurve(connection,mint,()=>guard());guard();assertCap(freshQuote.capLamports)}
    active.status='signing';journal.phase='signing';checkpoint();guard()
    const signed=await signer.sign(VersionedTransaction.deserialize(prepared.transaction.serialize()));guard()
    if(message(signed)!==prepared.message)throw new Error('The wallet changed the approved native trade message. Nothing was sent.')
    inspectTradeIntent(signed,input,amount(prepared.maxSellRaw))
    const signature=signedTransactionSignature(signed)
    if(journal.rows.some(row=>row.signature===signature))throw new Error('A fresh trade returned an already-used signature. No duplicate was submitted.')
    const validity=await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash,{commitment:'confirmed'}));guard()
    if(!validity.value)throw new Error('The signed trade expired. No automatic replacement will be sent.')
    const recovery=await withTimeout(connection.getLatestBlockhash({commitment:'confirmed',minContextSlot:validity.context.slot}));guard()
    if(!Number.isSafeInteger(recovery.lastValidBlockHeight)||recovery.lastValidBlockHeight<1)throw new Error('The trade recovery boundary could not be verified.')
    const simulation=await ports.simulateSigned(connection,signed,prepared,()=>guard());guard()
    if(config.mode==='cap'){const freshQuote=await ports.readCurve(connection,mint,()=>guard());guard();assertCap(freshQuote.capLamports)}
    debit=reserve(prepared,amount(simulation.networkFeeLamports),amount(simulation.netDebitLamports))
    if(amount(simulation.netDebitLamports)>debit||debit>remaining||debit>amount(simulation.walletBeforeLamports))throw new Error('The signed trade debit exceeds the wallet balance or remaining session ceiling.')
    if(message(signed)!==prepared.message||signedTransactionSignature(signed)!==signature)throw new Error('The signed message or signature changed after simulation.')
    inspectTradeIntent(signed,input,amount(prepared.maxSellRaw));guard()
    pending={action:config.action,mint,payer:config.payer,signature,blockhash:signed.message.recentBlockhash,submittedAt:new Date(ports.now()).toISOString(),maxBuyLamports:prepared.maxBuyLamports,maxSellRaw:prepared.maxSellRaw,expiryBlockHeight:recovery.lastValidBlockHeight}
    saveTradePending(pending,ports.storage)
    guard(signature)
    active.signature=signature;active.status='sending';active.debitReservedLamports=debit.toString();journal.reservedDebitLamports=(amount(journal.reservedDebitLamports)+debit).toString();journal.phase='sending';checkpoint();guard(signature)
    const receipt=await ports.send(connection,signed,{signal:signer.signal,onBroadcast:()=>{
     guard(signature)
     if(message(signed)!==prepared.message||signedTransactionSignature(signed)!==signature)throw new Error('The signed trade changed before broadcast.')
     inspectTradeIntent(signed,input,amount(prepared.maxSellRaw));submitted=true
    }})
    // Run the live boundary check after confirmation too, while still preserving a
    // confirmed public receipt if the user locked or cancelled during that wait.
    let stopped:unknown
    try{guard(signature)}catch(error){stopped=error}
    if(!submitted&&receipt.submitted===false){clearTradePending(signature,ports.storage);pending=null;active.status='not-submitted';throw new Error(receipt.error||'Nothing was submitted.')}
    if(receipt.signature!==signature||!submitted)throw new Error('Submission did not acknowledge the original signature. Preserve it in Manage token.')
    if(receipt.status==='unknown'){active.status='unknown';throw new Error(receipt.error||'Confirmation is unknown. The session stopped; check the original saved signature in Manage token.')}
    if(readTradePending(ports.storage)?.signature!==signature)throw new Error('The recovery record changed during confirmation. Preserve the original signature.')
    saveTradeReceipt(pending,receipt.status,receipt.error,ports.storage)
    pending=null;submitted=false;active.status=receipt.status;checkpoint()
    if(receipt.status==='failed')throw new Error(receipt.error||'The trade failed on chain. No further trades were attempted.')
    if(stopped)throw stopped
   });guard()
  }
  try{
   guard();checkpoint();guard()
   if(await withTimeout(connection.getGenesisHash())!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Browser trading sessions support Solana mainnet Pump.fun curves only.');guard()
   while(journal.rows.filter(row=>row.status==='confirmed').length<config.maxTrades){
    guard();let target=config.mint
    if(config.mode==='new-launch'){
     let feed:LaunchFeed
     try{feed=await ports.fetchFeed();guard()}catch{guard();throw new Error('The confirmed launch feed is unavailable. The session stopped; no automatic retry was armed.')}
     const items=checkedFeed(feed,ports.now())
     if(!baseline){items.forEach(item=>seen.add(item.mint));baseline=true;await pause();continue}
     const newlySeen=items.filter(item=>!seen.has(item.mint));newlySeen.forEach(item=>seen.add(item.mint))
     target=newlySeen.find(item=>item.timestamp>=Math.ceil(armedAt/1000)&&item.timestamp<=Math.floor(ports.now()/1000)+30&&(!config.creator||item.creator===config.creator)&&(!config.keyword||`${item.name} ${item.symbol}`.toLocaleLowerCase('en-US').includes(config.keyword.toLocaleLowerCase('en-US'))))?.mint
    }else if(config.mode==='cap'){
     const quote=await ports.readCurve(connection,config.mint!,()=>guard());guard();journal.lastCapLamports=quote.capLamports;checkpoint();guard()
     const current=amount(quote.capLamports),threshold=solLamports(config.capSol)
     if(config.capDirection==='at-or-above'?current<threshold:current>threshold)target=undefined
    }
    if(target)await trade(target)
    guard()
    if(journal.rows.filter(row=>row.status==='confirmed').length>=config.maxTrades)break
    await pause()
   }
   journal.status='completed';journal.message='The approved trade count was reached.'
  }catch(error){
   const unsentPending=pending as PendingTrade|null
   if(unsentPending&&!submitted){try{clearTradePending(unsentPending.signature,ports.storage)}catch{/* Preserve unreadable recovery storage; never retry. */}}
   if(active&&['preparing','signing','sending'].includes(active.status))active.status=submitted?'unknown':'not-submitted'
   if(active&&active.status!=='confirmed')active.error=errorText(error)
   journal.status=submitted?'unknown':error instanceof TimeLimit?'completed':signer.signal?.aborted||signer.readSigner()!==config.payer?'stopped':'failed'
   journal.message=errorText(error)
  }
  journal.phase='idle'
  try{checkpoint()}catch(error){journal.status=submitted?'unknown':'failed';journal.message=`${journal.message||''} ${errorText(error)}`.trim();signer.onChange?.(structuredClone(journal))}
  return structuredClone(journal)
 }
}
