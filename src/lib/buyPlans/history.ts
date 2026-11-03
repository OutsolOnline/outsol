import {type Connection} from '@solana/web3.js'
import bs58 from 'bs58'
import {withTimeout} from '@/lib/transactions/http'
import {readTradePending,saveTradeReceipt,type TradeStorage} from '@/lib/venues/tradeHistory'
import {buyPlanAddress,buyPlanObject,buyPlanText,buyPlanTime,type BuyPlanStorage} from './model'

export const BUY_PLAN_HISTORY_KEY='outsol-buy-plan-runs-v1'
export type BuyRowStatus='waiting'|'preparing'|'signing'|'sending'|'confirmed'|'failed'|'unknown'|'not-submitted'
export interface BuyPlanJournalRow {rowId:string;walletId:string;name:string;payer:string;transferTo?:string;buyLamports:string;maxDebitLamports:string;status:BuyRowStatus;signature?:string;blockhash?:string;expiresAfterBlockHeight?:number;submittedAt?:number;tokenRaw?:string;networkFeeLamports?:string;reservedDebitLamports?:string}
export interface BuyPlanJournal {version:1;id:string;planId:string;planName:string;mint:string;status:'running'|'completed'|'stopped'|'failed'|'unknown';createdAt:number;updatedAt:number;rows:BuyPlanJournalRow[];error?:string;observedBuyTotalLamports?:string}
export interface BuyPlanLocks {request<T>(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>):Promise<T>}
const amount=(value:unknown)=>{if(typeof value!=='string'||! /^(0|[1-9]\d{0,29})$/.test(value))throw new Error('Invalid public buy amount.');return value}
export function publicBuyPlanJournal(value:unknown):BuyPlanJournal {
 const input=buyPlanObject(value,['version','id','planId','planName','mint','status','createdAt','updatedAt','rows','error','observedBuyTotalLamports'])
 if(input.version!==1||!['running','completed','stopped','failed','unknown'].includes(String(input.status))||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>16)throw new Error('The public buy run is invalid.')
 const rows:BuyPlanJournalRow[]=input.rows.map(value=>{
  const row=buyPlanObject(value,['rowId','walletId','name','payer','transferTo','buyLamports','maxDebitLamports','status','signature','blockhash','expiresAfterBlockHeight','submittedAt','tokenRaw','networkFeeLamports','reservedDebitLamports'])
  if(!['waiting','preparing','signing','sending','confirmed','failed','unknown','not-submitted'].includes(String(row.status)))throw new Error('The buy row status is invalid.')
  const result:BuyPlanJournalRow={rowId:buyPlanText(row.rowId,100),walletId:buyPlanText(row.walletId,100),name:buyPlanText(row.name,60),payer:buyPlanAddress(row.payer,true),buyLamports:amount(row.buyLamports),maxDebitLamports:amount(row.maxDebitLamports),status:row.status as BuyRowStatus}
  if(BigInt(result.buyLamports)<=0n||BigInt(result.maxDebitLamports)<BigInt(result.buyLamports))throw new Error('The public buy ceiling is invalid.')
  if(row.transferTo!==undefined){result.transferTo=buyPlanAddress(row.transferTo,true);if(result.transferTo===result.payer)throw new Error('The buyer cannot forward to itself.')}
  for(const field of ['tokenRaw','networkFeeLamports','reservedDebitLamports'] as const)if(row[field]!==undefined)result[field]=amount(row[field])
  if(row.signature!==undefined){if(typeof row.signature!=='string'||row.signature.length>88||bs58.decode(row.signature).length!==64||!bs58.decode(row.signature).some(Boolean))throw new Error('The saved original buy signature is invalid.');result.signature=row.signature}
  if(row.blockhash!==undefined)result.blockhash=buyPlanAddress(row.blockhash)
  if(row.expiresAfterBlockHeight!==undefined)result.expiresAfterBlockHeight=buyPlanTime(row.expiresAfterBlockHeight)
  if(row.submittedAt!==undefined)result.submittedAt=buyPlanTime(row.submittedAt)
  if(['sending','unknown','confirmed'].includes(result.status)&&(!result.signature||!result.blockhash||result.expiresAfterBlockHeight===undefined||result.submittedAt===undefined))throw new Error('The submitted buy recovery context is incomplete.')
  return result
 })
 if(new Set(rows.map(row=>row.rowId)).size!==rows.length)throw new Error('A buy run contains duplicate rows.')
 const createdAt=buyPlanTime(input.createdAt),updatedAt=buyPlanTime(input.updatedAt)
 if(updatedAt<createdAt)throw new Error('The buy run update predates its creation.')
 const result:BuyPlanJournal={version:1,id:buyPlanText(input.id,100),planId:buyPlanText(input.planId,100),planName:buyPlanText(input.planName),mint:buyPlanAddress(input.mint),status:input.status as BuyPlanJournal['status'],createdAt,updatedAt,rows}
 if(input.error!==undefined){if(typeof input.error!=='string')throw new Error('The public buy message is invalid.');result.error=input.error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)}
 if(input.observedBuyTotalLamports!==undefined)result.observedBuyTotalLamports=amount(input.observedBuyTotalLamports)
 return result
}
const target=(storage?:BuyPlanStorage)=>storage??localStorage
export function readBuyPlanJournals(storage?:BuyPlanStorage):BuyPlanJournal[]{
 try{const raw=target(storage).getItem(BUY_PLAN_HISTORY_KEY);if(raw===null)return [];if(raw.length>1000000)throw new Error();const values:unknown=JSON.parse(raw);if(!Array.isArray(values)||values.length>40)throw new Error();const rows=values.map(publicBuyPlanJournal);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error();return rows}catch{throw new Error('Buy-plan recovery history cannot be read. Preserve browser data and original signatures before continuing.')}
}
export function saveBuyPlanJournal(value:BuyPlanJournal,storage?:BuyPlanStorage):BuyPlanJournal {
 const disk=target(storage),safe=publicBuyPlanJournal(value),history=readBuyPlanJournals(disk),previous=history.find(row=>row.id===safe.id)
 if(previous){
  if(previous.planId!==safe.planId||previous.mint!==safe.mint||previous.createdAt!==safe.createdAt||previous.rows.length!==safe.rows.length)throw new Error('The original buy run identity cannot change.')
  for(const [index,old] of previous.rows.entries())if(old.signature){const next=safe.rows[index];if(['rowId','walletId','payer','transferTo','buyLamports','maxDebitLamports','signature','blockhash','expiresAfterBlockHeight','submittedAt','tokenRaw'].some(field=>old[field as keyof BuyPlanJournalRow]!==next[field as keyof BuyPlanJournalRow])||(['confirmed','failed'].includes(old.status)&&old.status!==next.status))throw new Error('The original submitted buy identity or resolved result cannot change.')}
 }
 const values=[safe,...history.filter(row=>row.id!==safe.id)]
 if(values.length>40){const last=values.at(-1)!;if(last.rows.some(row=>['sending','unknown'].includes(row.status)))throw new Error('Preserve pending buy history before adding another run.');values.pop()}
 const raw=JSON.stringify(values);disk.setItem(BUY_PLAN_HISTORY_KEY,raw)
 if(disk.getItem(BUY_PLAN_HISTORY_KEY)!==raw)throw new Error('The original buy-plan recovery record could not be saved. Nothing further may be sent.')
 if(typeof window!=='undefined')window.dispatchEvent(new Event('outsol-buy-plan-changed'))
 return safe
}
export function assertNoPendingBuyPlan(storage?:BuyPlanStorage):void{if(readBuyPlanJournals(storage).some(run=>run.rows.some(row=>['sending','unknown'].includes(row.status))))throw new Error('A buy-plan transaction is pending confirmation. Check its original signature before starting another buy.')}
/** Only checks original signatures. No packet rebuilding, automatic rearming or expiry-based nonexecution inference. */
export async function reconcileBuyPlanJournals(connection:Connection,options:{storage?:TradeStorage;locks?:BuyPlanLocks}={}):Promise<BuyPlanJournal[]>{
 const locks=options.locks??(typeof navigator!=='undefined'?navigator.locks as BuyPlanLocks:undefined)
 if(!locks)throw new Error('Use a browser with secure cross-tab transaction coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('Another tab is signing or recovering an operation.')
  if(await withTimeout(connection.getGenesisHash())!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('The saved buy plan belongs to Solana mainnet.')
  const history=readBuyPlanJournals(options.storage)
  for(const run of history){
   let changed=false
   for(const row of run.rows)if(row.signature&&['sending','unknown'].includes(row.status)){
    const response=await withTimeout(connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})),status=response.value[0]
    if(status&&(status.confirmationStatus==='confirmed'||status.confirmationStatus==='finalized')){
     row.status=status.err?'failed':'confirmed';changed=true
     const pending=readTradePending(options.storage)
     if(pending?.signature===row.signature&&pending.payer===row.payer&&pending.mint===run.mint)saveTradeReceipt(pending,row.status,undefined,options.storage)
    }
   }
   if(changed){for(const row of run.rows)if(['waiting','preparing','signing'].includes(row.status))row.status='not-submitted';run.updatedAt=Math.max(run.createdAt,Date.now());run.status=run.rows.some(row=>['sending','unknown'].includes(row.status))?'unknown':run.rows.every(row=>row.status==='confirmed')?'completed':'stopped';run.error=run.status==='completed'?undefined:'Original signatures checked. Remaining buys were not resumed; prepare a fresh review.';saveBuyPlanJournal(run,options.storage)}
  }
  return readBuyPlanJournals(options.storage)
 })
}
