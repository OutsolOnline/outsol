import {type Connection,type Keypair} from '@solana/web3.js'
import {fetchBounded} from '@/lib/transactions/http'
import {readTradePending,type TradeStorage} from '@/lib/venues/tradeHistory'
import {formatTokenAmount} from '@/lib/walletInspector'
import {TradingSession} from './engine'
import {solLamports} from './config'
import {readSolCurveQuote,simulateSignedTrade} from './chain'
import {ObservedBuyWatcher} from './observedTrades'
import {validateStrategyQueue,type StrategyQueueConfig,type StrategyQueueStep} from './queueModel'
import {STRATEGY_QUEUE_HISTORY_KEY,publicStrategyQueue,saveStrategyQueue,type StrategyQueueJournal} from './queueHistory'
import type {SessionLocks,SessionPorts,SessionSigner,TradingSessionConfig,TradingSessionJournal} from './types'

export interface StrategyQueueOptions {approved:true;readKeypair:(walletId:string)=>Keypair|null;assertCurrent:()=>void;ownAddresses?:readonly string[];signal?:AbortSignal;storage?:TradeStorage;locks?:SessionLocks;resumeFrom?:StrategyQueueJournal;onChange?:(value:StrategyQueueJournal)=>void}
export interface StrategyQueuePorts {now:()=>number;wait:(milliseconds:number,signal?:AbortSignal)=>Promise<void>;fetchMarket:(mint:string)=>Promise<unknown>;sessionPorts:Partial<SessionPorts>;runSession:(connection:Connection,config:TradingSessionConfig,signer:SessionSigner,ports:Partial<SessionPorts>)=>Promise<TradingSessionJournal>}
const defaults:StrategyQueuePorts={now:Date.now,wait:(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted){reject(new Error('Queue stopped.'));return}const abort=()=>{clearTimeout(timer);reject(new Error('Queue stopped.'))},timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);signal?.addEventListener('abort',abort,{once:true})}),fetchMarket:mint=>fetchBounded(`/api/token-market?mint=${encodeURIComponent(mint)}`,{cache:'no-store',credentials:'same-origin'},response=>response.json()),sessionPorts:{},runSession:(connection,config,signer,ports)=>new TradingSession(connection,config,ports).run(signer)}
const reserved=(attempts:StrategyQueueJournal['attempts'])=>attempts.reduce((sum,item)=>sum+BigInt(item.journal.reservedDebitLamports),0n)
const confirmed=(stepId:string,attempts:StrategyQueueJournal['attempts'])=>attempts.filter(item=>item.stepId===stepId).reduce((sum,item)=>sum+item.journal.rows.filter(row=>row.status==='confirmed').length,0)
const uncertain=(journal:StrategyQueueJournal)=>journal.attempts.some(attempt=>attempt.journal.status==='unknown'||attempt.journal.rows.some(row=>['sending','unknown'].includes(row.status)||row.relay?.status==='unknown'||(row.relay?.status==='preparing'&&!!row.relay.signature)))

/** Coordinates existing reviewed native sessions. No server signer and no automatic rearm after pause/reload. */
export class StrategyQueue {
 #connection:Connection;#config:StrategyQueueConfig;#ports:StrategyQueuePorts;#used=false;#pause=false;#controller=new AbortController()
 constructor(connection:Connection,config:StrategyQueueConfig,ports:Partial<StrategyQueuePorts>={}){this.#connection=connection;this.#config=validateStrategyQueue(config);this.#ports={...defaults,...ports}}
 pause():void{this.#pause=true;this.#controller.abort()}
 stop():void{this.#controller.abort()}
 async run(options:StrategyQueueOptions):Promise<StrategyQueueJournal>{
  if(options.approved!==true)throw new Error('Fresh complete queue approval is required.')
  if(this.#used)throw new Error('This queue approval was already used. Review again before continuing.')
  this.#used=true
  const config=this.#config,ports=this.#ports,connection=this.#connection,previous=options.resumeFrom?publicStrategyQueue(options.resumeFrom):undefined
  if(previous&&(previous.config.id!==config.id||previous.status==='unknown'||uncertain(previous)))throw new Error('Resolve unknown original signatures before reviewing a continuation of this queue.')
  if(previous?.attempts.some(attempt=>attempt.journal.config.relay&&attempt.journal.rows.some(row=>row.status==='confirmed'&&row.relay?.status!=='confirmed')))throw new Error('A confirmed purchase has an incomplete receiver transfer. Resolve that Relay separately; this queue will not repeat the purchase.')
  if(previous&&previous.attempts.some(item=>!config.steps.some(step=>step.id===item.stepId)))throw new Error('Preserve executed step identities when editing a paused queue.')
  const completedTrades=previous?.attempts.reduce((sum,item)=>sum+item.journal.rows.filter(row=>row.status==='confirmed').length,0)??0
  if(completedTrades+config.steps.reduce((sum,step)=>sum+Math.max(0,step.config.maxTrades-confirmed(step.id,previous?.attempts??[])),0)>10)throw new Error('A continuation must preserve the lifetime limit of ten confirmed trades across this queue.')
  if(readTradePending(options.storage))throw new Error('A trade is pending confirmation. Check the original signature before continuing.')
  const now=ports.now(),journal:StrategyQueueJournal=previous?{...previous,config,status:'running',message:undefined}:{version:1,id:crypto.randomUUID(),config,status:'running',startedAt:now,updatedAt:now,activeElapsedMs:0,reservedDebitLamports:'0',attempts:[]}
  const initialElapsed=journal.activeElapsedMs,deadline=now+Math.max(0,config.durationMs-initialElapsed),disk=options.storage??localStorage
  const remainingBudgets=config.steps.reduce((sum,step)=>{const spent=reserved(journal.attempts.filter(item=>item.stepId===step.id));return sum+(confirmed(step.id,journal.attempts)<step.config.maxTrades?solLamports(step.config.maxDebitSol)-spent:0n)},0n)
  if(remainingBudgets<0n||reserved(journal.attempts)+remainingBudgets>solLamports(config.maxDebitSol)||initialElapsed>=config.durationMs)throw new Error('The edited queue ceiling or remaining active time cannot cover its preserved spending and remaining work.')
  let savedRaw=disk.getItem(STRATEGY_QUEUE_HISTORY_KEY),stopWatcher:ObservedBuyWatcher|undefined,lastObservation=-Infinity,counterWatcher:ObservedBuyWatcher|undefined,counterMint:string|undefined,lastCounterObservation=-Infinity
  const own=[...config.steps.map(step=>step.config.payer),...(options.ownAddresses??[])]
  const checkpoint=()=>{journal.updatedAt=Math.max(journal.startedAt,ports.now());journal.activeElapsedMs=initialElapsed+Math.max(0,ports.now()-now);journal.reservedDebitLamports=reserved(journal.attempts).toString();saveStrategyQueue(journal,options.storage);savedRaw=disk.getItem(STRATEGY_QUEUE_HISTORY_KEY);options.onChange?.(structuredClone(journal))}
  const guard=()=>{
   if(this.#controller.signal.aborted||options.signal?.aborted)throw new Error(this.#pause?'Queue paused. A fresh review is required to continue.':'Queue stopped. Remaining strategies were not submitted.')
   options.assertCurrent()
   if(ports.now()>=deadline)throw new Error('The approved total active runtime was reached.')
   if(disk.getItem(STRATEGY_QUEUE_HISTORY_KEY)!==savedRaw)throw new Error('Queue progress changed in another tab. Preserve its original signatures.')
   for(const step of config.steps){const key=options.readKeypair(step.config.walletId);if(!key||key.publicKey.toBase58()!==step.config.payer)throw new Error('A queue signing wallet was locked or changed. Review again after unlocking.')}
   if(stopWatcher){stopWatcher.assertFresh(ports.now());if(stopWatcher.exceeded)throw new Error(`Observed external buy total ${stopWatcher.totalObservedLamports} lamports exceeded the threshold. Remaining strategies stopped; sampled coverage is incomplete.`)}
   counterWatcher?.assertFresh(ports.now())
  }
  const observeStop=async()=>{if(!config.observedBuyGuard||ports.now()-lastObservation<5000)return;const value=await ports.fetchMarket(config.steps[0].config.mint!);guard();const watcher=stopWatcher??new ObservedBuyWatcher(config.steps[0].config.mint!,config.observedBuyGuard,own,now,'cumulative',previous?.observedBuyTotalLamports??'0');watcher.observe(value,ports.now());stopWatcher=watcher;lastObservation=ports.now();journal.observedBuyTotalLamports=watcher.totalObservedLamports;if(watcher.latched)journal.observedEventId=watcher.latched.id;guard()}
  const observeCounter=async()=>{if(!counterWatcher||!counterMint||ports.now()-lastCounterObservation<5000)return;const value=await ports.fetchMarket(counterMint);guard();counterWatcher.observe(value,ports.now());lastCounterObservation=ports.now();guard()}
  const waitForCounter=async(step:StrategyQueueStep)=>{
   if(!step.counter)return
   const watcher=new ObservedBuyWatcher(step.config.mint!,step.counter,own,ports.now())
   watcher.observe(await ports.fetchMarket(step.config.mint!),ports.now());guard();counterWatcher=watcher;counterMint=step.config.mint!;lastCounterObservation=ports.now()
   while(!watcher.latched){await ports.wait(5000,this.#controller.signal);guard();await observeCounter()}
   journal.observedEventId=watcher.latched.id;checkpoint()
  }
  const locks=options.locks??(typeof navigator!=='undefined'?navigator.locks as unknown as SessionLocks:undefined)
  if(!locks)throw new Error('Use a browser with secure cross-tab queue coordination.')
  const outerAbort=()=>this.#controller.abort();options.signal?.addEventListener('abort',outerAbort,{once:true})
  try{
   await locks.request('outsol-strategy-queue-run',{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another strategy queue is active in this browser. Pause it before starting another.')
    guard();checkpoint();guard();await observeStop()
    for(const step of config.steps){
     guard();if(confirmed(step.id,journal.attempts)>=step.config.maxTrades)continue
     await waitForCounter(step);guard();await observeStop()
     if(readTradePending(options.storage))throw new Error('A pending original trade blocks the next strategy.')
     const previousStep=journal.attempts.filter(item=>item.stepId===step.id),stepBudget=solLamports(step.config.maxDebitSol)-reserved(previousStep),left=solLamports(config.maxDebitSol)-reserved(journal.attempts),timeLeft=deadline-ports.now()
     if(stepBudget<=0n||stepBudget>left||timeLeft<5000)throw new Error('Remaining strategy budget or active time cannot cover another reviewed session.')
     const single:TradingSessionConfig={...step.config,maxTrades:step.config.maxTrades-confirmed(step.id,journal.attempts),maxDebitSol:formatTokenAmount(stepBudget.toString(),9),durationMs:Math.min(step.config.durationMs,timeLeft)}
     let activeId:string|undefined
     const update=(value:TradingSessionJournal)=>{const at=journal.attempts.findIndex(item=>item.journal.id===value.id);if(at<0)journal.attempts.push({stepId:step.id,journal:structuredClone(value)});else journal.attempts[at]={stepId:step.id,journal:structuredClone(value)};activeId=value.id;checkpoint()}
     const partial=ports.sessionPorts,readCurve=partial.readCurve??readSolCurveQuote,signedSimulation=partial.simulateSigned??simulateSignedTrade
     const sessionPorts:Partial<SessionPorts>={...partial,storage:options.storage,locks:options.locks,now:ports.now,wait:async(ms,signal)=>{await ports.wait(ms,signal);await observeStop();await observeCounter()},readCurve:async(...args)=>{await observeStop();await observeCounter();return readCurve(...args)},simulateSigned:async(...args)=>{await observeStop();await observeCounter();const result=await signedSimulation(...args);await observeStop();await observeCounter();return result}}
     const result=await ports.runSession(connection,single,{approved:true,signal:this.#controller.signal,assertAvailable:guard,readSigner:()=>{try{guard();return options.readKeypair(step.config.walletId)?.publicKey.toBase58()??null}catch{return null}},sign:async tx=>{guard();const key=options.readKeypair(step.config.walletId);if(!key||key.publicKey.toBase58()!==step.config.payer)throw new Error('The queue signer locked or changed.');tx.sign([key]);guard();return tx},onChange:update},sessionPorts)
     if(!activeId||activeId!==result.id||JSON.stringify(journal.attempts.find(item=>item.journal.id===activeId)?.journal)!==JSON.stringify(result))update(result)
     if(uncertain(journal)){journal.status='unknown';throw new Error('An original strategy signature needs confirmation. Remaining work stopped.')}
     if(result.rows.some(row=>row.status==='confirmed'&&row.relay&&row.relay.status!=='confirmed'))throw new Error('A confirmed buy has an incomplete receiver transfer. Resolve it before continuing the queue.')
     if(confirmed(step.id,journal.attempts)<step.config.maxTrades)throw new Error(result.message||'This strategy ended before its approved trade count. Review remaining work before continuing.')
     counterWatcher=undefined;counterMint=undefined
     guard()
    }
    journal.status='completed';journal.message='All approved strategy counts completed.';checkpoint()
   })
  }catch(error){journal.status=uncertain(journal)?'unknown':this.#pause?'paused':this.#controller.signal.aborted||options.signal?.aborted?'stopped':'failed';journal.message=error instanceof Error?error.message:'The bounded strategy queue stopped.';try{checkpoint()}catch{/* Original child-session and queue records remain authoritative. */}}
  finally{options.signal?.removeEventListener('abort',outerAbort)}
  return structuredClone(journal)
 }
}
