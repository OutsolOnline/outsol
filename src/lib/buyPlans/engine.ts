import {Connection,Keypair,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {OnlinePumpSdk} from '@pump-fun/pump-sdk'
import {buildNativeBuyTransaction} from '@/lib/pumpfun/api'
import {simulateAtomicBundle,type AtomicTokenExpectation} from '@/lib/bundler/jito'
import {nativeBuyOutput,composeNativeBuyTransfer,validateComposedNativeBuy,launchTokenExpectations,assertLaunchTokenEvidence,type NativeBuyTransferPolicy} from '@/lib/launchBundle/transfers'
import type {LaunchBundleTransfer} from '@/lib/launchBundle/receipt'
import {validatePumpTransaction} from '@/lib/transactions/validatePumpTransaction'
import {sendAndConfirmTransaction,signedTransactionSignature,throwIfAborted} from '@/lib/transactions/send'
import {fetchBounded,withTimeout} from '@/lib/transactions/http'
import {readPending} from '@/lib/launchHistory'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'
import {assertNoPendingRelayTransfer} from '@/lib/relay/history'
import {readTradePending,saveTradePending,clearTradePending,saveTradeReceipt,type PendingTrade,type TradeStorage} from '@/lib/venues/tradeHistory'
import {parseBuyPlan,orderedBuyRows,solLamports,type BuyPlan,type BuyPlanRow} from './model'
import {BUY_PLAN_HISTORY_KEY,assertNoPendingBuyPlan,readBuyPlanJournals,saveBuyPlanJournal,type BuyPlanJournal,type BuyPlanJournalRow,type BuyPlanLocks} from './history'
import {ObservedBuyWatcher} from '@/lib/tradingSessions/observedTrades'

export interface NativeBuyDraft {transaction:VersionedTransaction;creator:string;protocolFeeRecipients:readonly string[]}
export interface BuyPlanPorts {
 now:()=>number;wait:(milliseconds:number,signal?:AbortSignal)=>Promise<void>;assertAvailable:()=>void
 build:(connection:Connection,row:BuyPlanRow,mint:string,plan:BuyPlan)=>Promise<NativeBuyDraft>
 simulate:typeof simulateAtomicBundle;send:typeof sendAndConfirmTransaction
 fetchMarket:(mint:string)=>Promise<unknown>
}
export interface BuyPlanOptions {readKeypair:(walletId:string)=>Keypair|null;assertCurrent:()=>void;ownAddresses?:readonly string[];signal?:AbortSignal;storage?:TradeStorage;locks?:BuyPlanLocks;approved?:true;onChange?:(journal:BuyPlanJournal)=>void}
export interface BuyPlanReviewRow extends BuyPlanRow {tokenRaw:string;minimumTokenRaw:string;simulatedDebitLamports:string;balanceLamports:string;networkFeeLamports:string;baseNetworkFeeLamports:string;priorityFeeLamports:string;accountHeadroomLamports:string}
export interface BuyPlanReview {planId:string;name:string;mint:string;mode:BuyPlan['mode'];createdAt:number;expiresAt:number;rows:BuyPlanReviewRow[];totalCeilingLamports:string;previousReservedLamports:string;planCeilingLamports:string}
export interface PreparedBuyPlan {review:BuyPlanReview}
interface Runtime {connection:Connection;plan:BuyPlan;rows:BuyPlanReviewRow[];review:BuyPlanReview;ports:BuyPlanPorts;used:boolean;historyRaw:string|null}
interface BuiltBuy {transaction:VersionedTransaction;native:VersionedTransaction;policy:NativeBuyTransferPolicy;transfer?:LaunchBundleTransfer;expectations:AtomicTokenExpectation[];tokenRaw:string}
const runtime=new WeakMap<PreparedBuyPlan,Runtime>()
const message=(transaction:VersionedTransaction)=>Buffer.from(transaction.message.serialize()).toString('base64')
const clone=(transaction:VersionedTransaction)=>VersionedTransaction.deserialize(transaction.serialize())
const amount=(value:unknown)=>{if(typeof value!=='string'||! /^(0|[1-9]\d{0,29})$/.test(value))throw new Error('The exact buy cost could not be verified.');return BigInt(value)}
const exactBalance=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('The buyer balance or network fee is not exact.');return BigInt(value)}
function available(){if(readPending())throw new Error('A launch is pending confirmation. Check Activity.');assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt();assertNoPendingRelayTransfer()}
function wait(milliseconds:number,signal?:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(new Error('Remaining buys were cancelled.'));return}
 const abort=()=>{clearTimeout(timer);reject(new Error('Remaining buys were cancelled.'))}
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},milliseconds);signal?.addEventListener('abort',abort,{once:true})
})}
const defaults:BuyPlanPorts={now:Date.now,wait,assertAvailable:available,simulate:simulateAtomicBundle,send:sendAndConfirmTransaction,fetchMarket:mint=>fetchBounded(`/api/token-market?mint=${encodeURIComponent(mint)}`,{cache:'no-store',credentials:'same-origin'},response=>response.json()),build:async(connection,row,mint,plan)=>{
 const online=new OnlinePumpSdk(connection)
 const [global,curve]=await Promise.all([withTimeout(online.fetchGlobal()),withTimeout(online.fetchBondingCurve(new PublicKey(mint)))])
 if(curve.complete)throw new Error('This Pump.fun curve graduated. The buy plan stopped.')
 const transaction=await buildNativeBuyTransaction({connection,userPublicKey:row.publicKey,mintAddress:mint,maxBuyAmountSol:Number(solLamports(row.buySol))/1e9,slippage:plan.slippage,priorityFee:Number(solLamports(plan.priorityFeeSol))/1e9})
 return {transaction,creator:curve.creator.toBase58(),protocolFeeRecipients:[...new Set([global.feeRecipient,...global.feeRecipients].filter(key=>!key.equals(PublicKey.default)).map(key=>key.toBase58()))]}
}}
function guardWallets(rows:readonly BuyPlanRow[],options:BuyPlanOptions):void {
 throwIfAborted(options.signal);options.assertCurrent()
 for(const row of rows){const key=options.readKeypair(row.walletId);if(!key||key.publicKey.toBase58()!==row.publicKey)throw new Error('A buyer wallet was locked or changed. Unlock the reviewed wallets and prepare again.')}
}
function validateBuilt(built:BuiltBuy):void {
 if(built.transfer)validateComposedNativeBuy(built.transaction,built.native,built.transfer,built.policy)
 else{validatePumpTransaction(built.transaction,built.policy);nativeBuyOutput(built.transaction,built.policy)}
 if(built.transaction.serialize().length>1232)throw new Error('The reviewed buy exceeds the Solana packet limit.')
}
async function build(connection:Connection,plan:BuyPlan,row:BuyPlanRow,ports:BuyPlanPorts,guard:()=>void):Promise<BuiltBuy>{
 const draft=await ports.build(connection,{...row},plan.mint!,structuredClone(plan));guard()
 const native=clone(draft.transaction),policy:NativeBuyTransferPolicy={action:'buy',payer:row.publicKey,mint:plan.mint!,maxSolLamports:solLamports(row.buySol),maxPriorityFeeLamports:solLamports(plan.priorityFeeSol),expectedBuyCreator:draft.creator,protocolFeeRecipients:[...draft.protocolFeeRecipients]}
 const output=nativeBuyOutput(native,policy),transfer:LaunchBundleTransfer|undefined=row.transferTo?{walletId:row.walletId,payer:row.publicKey,recipient:row.transferTo,mint:plan.mint!,rawAmount:output.rawAmount,tokenProgram:output.tokenProgram,decimals:6}:undefined
 const transaction=transfer?composeNativeBuyTransfer(native,transfer,policy):clone(native)
 const built={transaction,native,policy,transfer,expectations:launchTokenExpectations(plan.mint!,[{owner:row.publicKey,...output}],transfer?[transfer]:[]),tokenRaw:output.rawAmount}
 validateBuilt(built);return built
}
function priorityFee(transaction:VersionedTransaction):bigint {
 const instructions=TransactionMessage.decompile(transaction.message).instructions,[limit,price]=instructions
 return (BigInt(limit.data.readUInt32LE(1))*price.data.readBigUInt64LE(1)+999999n)/1000000n
}
async function simulate(connection:Connection,built:BuiltBuy,row:BuyPlanRow,ports:BuyPlanPorts,guard:()=>void,signed:boolean,signal?:AbortSignal):Promise<bigint>{
 validateBuilt(built)
 const original=Buffer.from(built.transaction.serialize()).toString('base64'),copy=clone(built.transaction)
 const expectations=structuredClone(built.expectations)
 const result=await ports.simulate(connection,[copy],{verifySignatures:signed,payer:row.publicKey,accounts:[row.publicKey],tokenAccounts:expectations,signal});guard()
 validateBuilt(built)
 if(Buffer.from(built.transaction.serialize()).toString('base64')!==original||Buffer.from(copy.serialize()).toString('base64')!==original||JSON.stringify(expectations)!==JSON.stringify(built.expectations))throw new Error('The buy message or simulation expectations changed. Nothing new was sent.')
 if(!result.success)throw new Error(result.error||'The complete same-bank buy simulation failed.')
 assertLaunchTokenEvidence(result,built.expectations)
 const debit=amount(result.walletDebitsLamports?.[row.publicKey])
 if(debit<=0n||debit>solLamports(row.maxDebitSol))throw new Error('The simulated buy exceeds this wallet’s approved debit ceiling.')
 return debit
}
function submittedReservation(planId:string,options:BuyPlanOptions):bigint{return readBuyPlanJournals(options.storage).filter(run=>run.planId===planId).reduce((sum,run)=>sum+run.rows.filter(row=>row.signature&&row.status!=='not-submitted').reduce((total,row)=>total+amount(row.reservedDebitLamports??row.maxDebitLamports),0n),0n)}

/** Read-only preparation. Reviews and keys never enter persisted plan data. */
export async function prepareBuyPlan(connection:Connection,input:BuyPlan,rowIds:string[],options:BuyPlanOptions,custom:Partial<BuyPlanPorts>={}):Promise<PreparedBuyPlan>{
 const plan=parseBuyPlan(input),ports={...defaults,...custom}
 if(!plan.mint)throw new Error('Confirm the launch and attach its mint before reviewing buys.')
 if(!Array.isArray(rowIds)||!rowIds.length||new Set(rowIds).size!==rowIds.length||rowIds.some(id=>!plan.rows.some(row=>row.id===id)))throw new Error('Choose distinct buyer rows from this saved plan.')
 if(plan.mode==='staged'&&rowIds.length!==1)throw new Error('A staged step reviews one buyer at a time. Choose sequence for multiple wallets.')
 const selected=orderedBuyRows(plan).filter(row=>rowIds.includes(row.id)),history=readBuyPlanJournals(options.storage),historyRaw=(options.storage??localStorage).getItem(BUY_PLAN_HISTORY_KEY)
 assertNoPendingBuyPlan(options.storage)
 if(history.some(run=>run.planId===plan.id&&run.rows.some(row=>row.status==='confirmed'&&selected.some(selected=>selected.id===row.rowId))))throw new Error('A selected plan row already completed. Create a new plan for a deliberate additional purchase.')
 const guard=()=>{guardWallets(selected,options);ports.assertAvailable();if(readTradePending(options.storage))throw new Error('A trade is pending confirmation. Check its original signature first.');if((options.storage??localStorage).getItem(BUY_PLAN_HISTORY_KEY)!==historyRaw)throw new Error('Buy-plan progress changed during preparation. Review the current history.')}
 guard()
 if(await withTimeout(connection.getGenesisHash())!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Reviewed buy plans support Solana mainnet Pump.fun only.');guard()
 const prior=submittedReservation(plan.id,options),total=selected.reduce((sum,row)=>sum+solLamports(row.maxDebitSol),0n)
 if(prior+total>solLamports(plan.maxTotalDebitSol))throw new Error('Prior submissions and selected wallet ceilings exceed the aggregate plan debit cap.')
 const rows:BuyPlanReviewRow[]=[]
 for(const row of selected){
  const built=await build(connection,plan,row,ports,guard),debit=await simulate(connection,built,row,ports,guard,false,options.signal)
  const [balance,fee]=await Promise.all([withTimeout(connection.getBalance(new PublicKey(row.publicKey),'confirmed')),withTimeout(connection.getFeeForMessage(built.transaction.message,'confirmed'))]);guard()
  const available=exactBalance(balance),network=exactBalance(fee.value),priority=priorityFee(built.transaction),cap=solLamports(row.maxDebitSol)
  if(available<cap||cap<solLamports(row.buySol)+network||network<priority)throw new Error('The wallet balance or debit ceiling cannot cover the buy, network fee and account rent headroom.')
  rows.push({...row,tokenRaw:built.tokenRaw,minimumTokenRaw:(BigInt(built.tokenRaw)*BigInt(10000-Math.floor(plan.slippage*100))/10000n).toString(),simulatedDebitLamports:debit.toString(),balanceLamports:available.toString(),networkFeeLamports:network.toString(),baseNetworkFeeLamports:(network-priority).toString(),priorityFeeLamports:priority.toString(),accountHeadroomLamports:(cap-solLamports(row.buySol)-network).toString()})
 }
 const createdAt=ports.now(),review:BuyPlanReview={planId:plan.id,name:plan.name,mint:plan.mint,mode:plan.mode,createdAt,expiresAt:createdAt+60000,rows,totalCeilingLamports:total.toString(),previousReservedLamports:prior.toString(),planCeilingLamports:solLamports(plan.maxTotalDebitSol).toString()},prepared={review:structuredClone(review)}
 runtime.set(prepared,{connection,plan,rows:structuredClone(rows),review:structuredClone(review),ports,used:false,historyRaw});return prepared
}

/** One explicit start. Quotes are rebuilt inside the approved limits; uncertain sends stop all remaining wallets. */
export async function executeBuyPlan(prepared:PreparedBuyPlan,options:BuyPlanOptions):Promise<BuyPlanJournal>{
 const state=runtime.get(prepared)
 if(!state||state.used)throw new Error('This buy review was already used. Prepare a fresh review.')
 if(options.approved!==true)throw new Error('Explicit review approval is required before starting buys.')
 state.used=true
 const {connection,plan,rows,ports,review}=state,startedAt=ports.now(),disk=options.storage??localStorage
 const run:BuyPlanJournal={version:1,id:crypto.randomUUID(),planId:plan.id,planName:plan.name,mint:plan.mint!,status:'running',createdAt:startedAt,updatedAt:startedAt,rows:rows.map(row=>({rowId:row.id,walletId:row.walletId,name:row.name,payer:row.publicKey,buyLamports:solLamports(row.buySol).toString(),maxDebitLamports:solLamports(row.maxDebitSol).toString(),status:'waiting',...(row.transferTo?{transferTo:row.transferTo}:{})}))}
 let active:BuyPlanJournalRow|undefined,pending:PendingTrade|null=null,broadcast=false,savedRaw=state.historyRaw,watcher:ObservedBuyWatcher|undefined,lastMarketRead=-Infinity
 const checkpoint=()=>{run.updatedAt=Math.max(run.createdAt,ports.now());saveBuyPlanJournal(run,options.storage);savedRaw=disk.getItem(BUY_PLAN_HISTORY_KEY);options.onChange?.(structuredClone(run))}
 const guard=(expected?:string)=>{
  guardWallets(rows,options);ports.assertAvailable()
  if(watcher){watcher.assertFresh(ports.now());if(watcher.exceeded)throw new Error(`Observed external buy total ${watcher.totalObservedLamports} lamports exceeded the approved threshold. Remaining buyer actions stopped; coverage is a bounded sample.`)}
  if(ports.now()>startedAt+600000)throw new Error('The bounded buy-plan runtime expired. Remaining wallets stopped.')
  if(disk.getItem(BUY_PLAN_HISTORY_KEY)!==savedRaw)throw new Error('The original buy-plan journal changed. Check Activity before continuing.')
  const trade=readTradePending(options.storage)
  if(expected?trade?.signature!==expected:!!trade)throw new Error('A pending trade changed or needs confirmation. No further buys were sent.')
 }
 const priorObserved=readBuyPlanJournals(options.storage).filter(item=>item.planId===plan.id).reduce((maximum,item)=>{const total=amount(item.observedBuyTotalLamports??'0');return total>maximum?total:maximum},0n).toString()
 const observe=async()=>{if(!plan.observedBuyGuard||ports.now()-lastMarketRead<5000)return;const value=await ports.fetchMarket(plan.mint!);guard();const next=watcher??new ObservedBuyWatcher(plan.mint!,plan.observedBuyGuard,[...plan.rows.map(row=>row.publicKey),...(options.ownAddresses??[])],startedAt,'cumulative',priorObserved);next.observe(value,ports.now());watcher=next;run.observedBuyTotalLamports=next.totalObservedLamports;lastMarketRead=ports.now();guard()}
 const locks=options.locks??(typeof navigator!=='undefined'?navigator.locks as BuyPlanLocks:undefined)
 if(!locks)throw new Error('Use a browser with secure cross-tab transaction coordination.')
 try{
  await locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
   if(!lock)throw new Error('Another tab is signing, sending or recovering a transaction.')
   guard();assertNoPendingBuyPlan(options.storage)
   if(ports.now()>review.expiresAt)throw new Error('This buy review expired. Prepare a fresh review.')
   checkpoint();guard();await observe()
   for(const [index,row] of rows.entries()){
    active=run.rows[index];broadcast=false;pending=null
    const delay=(row.delaySeconds+(index?plan.intervalSeconds:0))*1000,due=ports.now()+delay
    while(ports.now()<due){guard();await ports.wait(Math.min(250,due-ports.now()),options.signal);await observe()}guard();await observe()
    active.status='preparing';checkpoint();guard()
    const built=await build(connection,plan,row,ports,guard);await observe()
    if(BigInt(built.tokenRaw)<BigInt(row.minimumTokenRaw))throw new Error('The fresh token output fell below the reviewed minimum. Remaining buys stopped.')
    const unsignedMessage=message(built.transaction),key=options.readKeypair(row.walletId)
    if(!key||key.publicKey.toBase58()!==row.publicKey)throw new Error('The reviewed buyer is locked or changed.')
    active.status='signing';checkpoint();guard();built.transaction.sign([key]);guard();validateBuilt(built)
    if(message(built.transaction)!==unsignedMessage)throw new Error('Signing changed the reviewed native buy message.')
    const signature=signedTransactionSignature(built.transaction),signedBytes=Buffer.from(built.transaction.serialize()).toString('base64')
    const debit=await simulate(connection,built,row,ports,guard,true,options.signal);await observe()
    const [balance,fee,validity,height]=await Promise.all([withTimeout(connection.getBalance(new PublicKey(row.publicKey),'confirmed')),withTimeout(connection.getFeeForMessage(built.transaction.message,'confirmed')),withTimeout(connection.isBlockhashValid(built.transaction.message.recentBlockhash,{commitment:'confirmed'})),withTimeout(connection.getBlockHeight('confirmed'))]);guard()
    const cap=solLamports(row.maxDebitSol),network=exactBalance(fee.value)
    if(debit>cap||exactBalance(balance)<cap||solLamports(row.buySol)+network>cap||!validity.value||!Number.isSafeInteger(height)||height<0)throw new Error('The signed buy balance, fee, expiry or debit cap changed. Nothing new was sent.')
    if(Buffer.from(built.transaction.serialize()).toString('base64')!==signedBytes)throw new Error('The signed buy changed after simulation.')
    pending={action:'buy',mint:plan.mint!,payer:row.publicKey,signature,blockhash:built.transaction.message.recentBlockhash,submittedAt:new Date(ports.now()).toISOString(),maxBuyLamports:solLamports(row.buySol).toString(),maxSellRaw:'0',expiryBlockHeight:height+160}
    saveTradePending(pending,options.storage)
    Object.assign(active,{status:'sending',signature,blockhash:pending.blockhash,expiresAfterBlockHeight:pending.expiryBlockHeight,submittedAt:ports.now(),tokenRaw:built.tokenRaw,networkFeeLamports:network.toString(),reservedDebitLamports:cap.toString()})
    checkpoint();guard(signature)
    const copy=clone(built.transaction),sent=await ports.send(connection,copy,{signal:options.signal,onBroadcast:()=>{guard(signature);validateBuilt(built);if(Buffer.from(copy.serialize()).toString('base64')!==signedBytes||Buffer.from(built.transaction.serialize()).toString('base64')!==signedBytes)throw new Error('The signed buy changed at the broadcast boundary.');broadcast=true}})
    if(sent.submitted===false&&!broadcast){clearTradePending(signature,options.storage);active.status='not-submitted';active.reservedDebitLamports='0';pending=null;throw new Error(sent.error||'The buy was not submitted. Review again before retrying.')}
    if(sent.signature!==signature)throw new Error('The provider returned a different signature. Preserve the original buy signature.')
    if(sent.status==='unknown'){active.status='unknown';run.status='unknown';throw new Error('The submitted buy needs confirmation. Remaining wallets were stopped.')}
    active.status=sent.status;saveTradeReceipt(pending,sent.status,sent.error,options.storage);pending=null;broadcast=false;checkpoint()
    if(sent.status==='failed')throw new Error('The native buy failed on chain. Remaining buyers stopped.')
    guard()
   }
   run.status='completed';run.error=undefined;checkpoint()
  })
 }catch(error){
  const unresolved=pending as PendingTrade|null
  if(active&&unresolved){active.status=broadcast?'unknown':'not-submitted';if(!broadcast){clearTradePending(unresolved.signature,options.storage);active.reservedDebitLamports='0';pending=null}}
  for(const row of run.rows)if(['waiting','preparing','signing'].includes(row.status))row.status='not-submitted'
  run.status=run.rows.some(row=>['sending','unknown'].includes(row.status))?'unknown':run.rows.some(row=>row.status==='failed')?'failed':'stopped'
  run.error=error instanceof Error?error.message:'The buy plan stopped. Preserve original signatures.'
  try{checkpoint()}catch{/* Previously saved originals remain authoritative if storage fails. */}
 }finally{runtime.delete(prepared)}
 return structuredClone(run)
}
