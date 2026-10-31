import {PublicKey} from '@solana/web3.js'
import type {TradeStorage} from '../venues/tradeHistory'
import {readTradeHistory} from '../venues/tradeHistory'

export const SALE_HISTORY_KEY='outsol-sale-batches-v1'
export interface SaleRequest {walletId:string;walletName:string;payer:string;mint:string;amountRaw:string;decimals:number;tokenProgram:string}
export interface SaleReviewRow extends SaleRequest {
 status:'ready'|'unavailable'|'preparing'|'signing'|'sending'|'confirmed'|'failed'|'unknown'
 route?:'pump'|'jupiter';minimumSolOut?:string;estimatedNetSolOut?:string;networkFeeLamports?:string;maxDebitLamports?:string;signature?:string;error?:string
}
export interface SaleBatchRecord {version:1;id:string;createdAt:number;updatedAt:number;status:'ready'|'running'|'completed'|'partial'|'failed'|'stopped'|'unknown';rows:SaleReviewRow[];error?:string}
const numeric=(v:unknown)=>typeof v==='string'&&/^(0|[1-9]\d{0,29})$/.test(v)
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)
export function publicSaleRecord(value:SaleBatchRecord):SaleBatchRecord {
 if(!value||value.version!==1||!text(value.id,60)||!Number.isSafeInteger(value.createdAt)||!Number.isSafeInteger(value.updatedAt)||value.createdAt<0||value.updatedAt<value.createdAt||!['ready','running','completed','partial','failed','stopped','unknown'].includes(value.status)||!Array.isArray(value.rows)||!value.rows.length||value.rows.length>100)throw new Error('The public sale record is invalid.')
 const rows=value.rows.map(row=>{
  if(!row||!text(row.walletId,100)||!text(row.walletName,60)||!numeric(row.amountRaw)||BigInt(row.amountRaw)<=0n||!Number.isInteger(row.decimals)||row.decimals<0||row.decimals>255||!['ready','unavailable','preparing','signing','sending','confirmed','failed','unknown'].includes(row.status))throw new Error('The public sale row is invalid.')
  const result:SaleReviewRow={walletId:row.walletId,walletName:row.walletName,payer:new PublicKey(row.payer).toBase58(),mint:new PublicKey(row.mint).toBase58(),tokenProgram:new PublicKey(row.tokenProgram).toBase58(),amountRaw:row.amountRaw,decimals:row.decimals,status:row.status}
  if(row.route!==undefined){if(row.route!=='pump'&&row.route!=='jupiter')throw new Error('The sale route is invalid.');result.route=row.route}
  for(const field of ['minimumSolOut','estimatedNetSolOut','networkFeeLamports','maxDebitLamports'] as const){const v=row[field];if(v!==undefined){if(field==='estimatedNetSolOut'?!/^-?\d{1,30}$/.test(v):!numeric(v))throw new Error('The public sale amount is invalid.');result[field]=v}}
  if(row.signature!==undefined){if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature))throw new Error('The original sale signature is invalid.');result.signature=row.signature}
  if(row.error!==undefined)result.error=String(row.error).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)
  return result
 })
 return {version:1,id:value.id,createdAt:value.createdAt,updatedAt:value.updatedAt,status:value.status,rows,...(value.error?{error:String(value.error).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)}:{})}
}
function target(storage?:TradeStorage):TradeStorage{if(storage)return storage;if(typeof localStorage==='undefined')throw new Error('Sale recovery storage is unavailable.');return localStorage}
export function readSaleHistory(storage?:TradeStorage):SaleBatchRecord[]{
 const raw=target(storage).getItem(SALE_HISTORY_KEY)
 if(!raw)return []
 if(raw.length>1_500_000)throw new Error('Sale history is too large. Preserve browser data and check Activity.')
 const records=JSON.parse(raw)
 if(!Array.isArray(records)||records.length>20)throw new Error('Sale history cannot be read. Preserve browser data.')
 return records.map(publicSaleRecord)
}
export function saveSaleRecord(record:SaleBatchRecord,storage?:TradeStorage):void{
 const destination=target(storage),safe=publicSaleRecord(record),records=[safe,...readSaleHistory(destination).filter(row=>row.id!==safe.id)].slice(0,20)
 let raw=JSON.stringify(records)
 while(raw.length>1_500_000&&records.length>1){records.pop();raw=JSON.stringify(records)}
 destination.setItem(SALE_HISTORY_KEY,raw)
 if(destination.getItem(SALE_HISTORY_KEY)!==raw)throw new Error('The public sale receipt could not be saved. Nothing further will be submitted.')
}
/** Updates public batch context from the original trade recovery result only.
 * This never builds or resubmits a packet and never resumes remaining rows. */
export function reconcileSaleHistory(storage?:TradeStorage):SaleBatchRecord[]{
 const records=readSaleHistory(storage),trades=readTradeHistory(storage)
 for(const record of records){
  let changed=false
  for(const row of record.rows){
   if(!row.signature||!['sending','unknown'].includes(row.status))continue
   const receipt=trades.find(value=>value.signature===row.signature&&value.action==='sell'&&value.payer===row.payer&&value.mint===row.mint&&value.maxSellRaw===row.amountRaw)
   if(!receipt)continue
   row.status=receipt.status;row.error=receipt.error;changed=true
  }
  if(changed){record.updatedAt=Math.max(Date.now(),record.createdAt);record.status=record.rows.some(row=>row.status==='unknown'||row.status==='sending')?'unknown':record.rows.every(row=>row.status==='confirmed')?'completed':'partial';record.error=record.status==='completed'?undefined:'The saved transaction was checked. Remaining rows were not resumed; scan and review a new queue.';saveSaleRecord(record,storage)}
 }
 return readSaleHistory(storage)
}
