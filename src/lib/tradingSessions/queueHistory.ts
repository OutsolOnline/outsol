import {buyPlanObject,buyPlanText,buyPlanTime,type BuyPlanStorage} from '@/lib/buyPlans/model'
import {readTradeHistory,type TradeStorage} from '@/lib/venues/tradeHistory'
import {readRelayReceipts} from '@/lib/relay/history'
import {validateStrategyQueue,type StrategyQueueConfig} from './queueModel'
import {parsePublicSessionJournal,saveSessionJournal} from './history'
import type {TradingSessionJournal} from './types'
export const STRATEGY_QUEUE_HISTORY_KEY='outsol-strategy-queues-v1'
export interface StrategyQueueJournal {version:1;id:string;config:StrategyQueueConfig;status:'running'|'paused'|'completed'|'stopped'|'failed'|'unknown';startedAt:number;updatedAt:number;activeElapsedMs:number;reservedDebitLamports:string;attempts:{stepId:string;journal:TradingSessionJournal}[];message?:string;observedEventId?:string;observedBuyTotalLamports?:string}
export function publicStrategyQueue(value:unknown):StrategyQueueJournal{
 const input=buyPlanObject(value,['version','id','config','status','startedAt','updatedAt','activeElapsedMs','reservedDebitLamports','attempts','message','observedEventId','observedBuyTotalLamports'])
 if(input.version!==1||!['running','paused','completed','stopped','failed','unknown'].includes(String(input.status))||!Array.isArray(input.attempts)||input.attempts.length>40)throw new Error('The public strategy queue is invalid.')
 const config=validateStrategyQueue(input.config),attempts=input.attempts.map(value=>{const item=buyPlanObject(value,['stepId','journal']);return {stepId:buyPlanText(item.stepId,100),journal:parsePublicSessionJournal(item.journal)}})
 if(attempts.some(attempt=>!config.steps.some(step=>step.id===attempt.stepId))||new Set(attempts.map(attempt=>attempt.journal.id)).size!==attempts.length)throw new Error('Preserve the executed strategy steps and distinct original runs when editing a queue.')
 const reserved=attempts.reduce((sum,attempt)=>sum+BigInt(attempt.journal.reservedDebitLamports),0n).toString()
 if(input.reservedDebitLamports!==reserved)throw new Error('The queue spending reservation disagrees with its original session journals.')
 if(input.observedBuyTotalLamports!==undefined&&(typeof input.observedBuyTotalLamports!=='string'||! /^(0|[1-9]\d{0,29})$/.test(input.observedBuyTotalLamports)))throw new Error('The observed external-buy total is invalid.')
 return {version:1,id:buyPlanText(input.id,100),config,status:input.status as StrategyQueueJournal['status'],startedAt:buyPlanTime(input.startedAt),updatedAt:buyPlanTime(input.updatedAt),activeElapsedMs:buyPlanTime(input.activeElapsedMs),reservedDebitLamports:reserved,attempts,...(input.message===undefined?{}:{message:buyPlanText(input.message,1000)}),...(input.observedEventId===undefined?{}:{observedEventId:buyPlanText(input.observedEventId,200)}),...(input.observedBuyTotalLamports===undefined?{}:{observedBuyTotalLamports:input.observedBuyTotalLamports as string})}
}
function disk(storage?:BuyPlanStorage){return storage??localStorage}
function saved(storage?:BuyPlanStorage):StrategyQueueJournal[]{const raw=disk(storage).getItem(STRATEGY_QUEUE_HISTORY_KEY);if(raw===null)return [];if(raw.length>1500000)throw new Error('Strategy queue history is too large. Preserve its records.');const values:unknown=JSON.parse(raw);if(!Array.isArray(values)||values.length>20)throw new Error('Strategy queue history cannot be read.');const rows=values.map(publicStrategyQueue);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Strategy queue history contains duplicate records.');return rows}
export function readStrategyQueues(storage?:BuyPlanStorage):StrategyQueueJournal[]{
 try{return saved(storage).map(row=>row.status==='running'?{...row,status:row.attempts.some(attempt=>attempt.journal.rows.some(trade=>['sending','unknown'].includes(trade.status)||trade.relay?.status==='unknown'||(trade.relay?.status==='preparing'&&!!trade.relay.signature)))?'unknown':'paused',message:'The browser run ended. Original signatures are preserved; fresh review and approval are required to continue.'}:row)}catch{throw new Error('Strategy queue recovery history cannot be read. Preserve browser data before editing.')}
}
export function saveStrategyQueue(value:StrategyQueueJournal,storage?:BuyPlanStorage):void{
 const safe=publicStrategyQueue(value),rows=saved(storage),previous=rows.find(row=>row.id===safe.id)
 if(previous){
  if(previous.config.id!==safe.config.id||previous.startedAt!==safe.startedAt||safe.activeElapsedMs<previous.activeElapsedMs)throw new Error('Original queue identity or active runtime cannot be reset.')
  for(const old of previous.attempts){const next=safe.attempts.find(item=>item.journal.id===old.journal.id);if(!next||next.stepId!==old.stepId||JSON.stringify(next.journal.config)!==JSON.stringify(old.journal.config))throw new Error('Original strategy attempts and their approved settings must be preserved.');for(const row of old.journal.rows)if(row.signature){const current=next.journal.rows.find(item=>item.index===row.index);if(!current||current.signature!==row.signature||current.mint!==row.mint||current.action!==row.action||(row.status==='confirmed'&&current.status!=='confirmed'))throw new Error('Original completed strategy signatures cannot change.')}}
 }
 const next=[safe,...rows.filter(row=>row.id!==safe.id)]
 if(next.length>20){const oldest=next.at(-1)!;if(oldest.status==='unknown'||oldest.attempts.some(attempt=>attempt.journal.status==='unknown'||attempt.journal.rows.some(row=>['sending','unknown'].includes(row.status)||row.relay?.status==='unknown'||(row.relay?.status==='preparing'&&!!row.relay.signature))))throw new Error('Pending queue recovery cannot be discarded.');next.pop()}
 const raw=JSON.stringify(next),target=disk(storage);target.setItem(STRATEGY_QUEUE_HISTORY_KEY,raw);if(target.getItem(STRATEGY_QUEUE_HISTORY_KEY)!==raw)throw new Error('Strategy progress could not be saved. No further trades may be sent.')
}
/** Reuses resolved original trade receipts only; does not resume a queue. */
export function reconcileStrategyQueues(storage?:TradeStorage):StrategyQueueJournal[]{
 const queues=saved(storage),trades=readTradeHistory(storage),relays=readRelayReceipts(storage)
 for(const queue of queues){let changed=false
  for(const attempt of queue.attempts){for(const row of attempt.journal.rows){if(row.signature&&['sending','unknown'].includes(row.status)){const receipt=trades.find(trade=>trade.signature===row.signature&&trade.mint===row.mint&&trade.payer===attempt.journal.config.payer&&trade.action===row.action);if(receipt){row.status=receipt.status;changed=true}}if(row.relay?.signature&&['preparing','unknown'].includes(row.relay.status)){const relay=relays.find(value=>value.signature===row.relay!.signature&&value.source===attempt.journal.config.payer&&value.destination===row.relay!.destination&&value.mint===row.mint&&value.amountRaw===row.relay!.amountRaw);if(relay&&(relay.status==='confirmed'||relay.status==='failed')){row.relay.status=relay.status;changed=true}}}
   if(changed&&attempt.journal.status==='unknown'){attempt.journal.status=attempt.journal.rows.some(row=>['sending','unknown'].includes(row.status)||row.relay?.status==='unknown'||(row.relay?.status==='preparing'&&!!row.relay.signature))?'unknown':'stopped';saveSessionJournal(attempt.journal,storage)}
  }
  if(changed){queue.status=queue.attempts.some(attempt=>attempt.journal.status==='unknown')?'unknown':'paused';queue.message='Original trade results checked. Review remaining work before approving a continuation.';saveStrategyQueue(queue,storage)}
 }
 return readStrategyQueues(storage)
}
