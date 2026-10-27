import {PublicKey} from '@solana/web3.js'
import bs58 from 'bs58'
import {parseResolvedCreatorFeeRouting,type ResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'

export const BATCH_JOURNAL_KEY='outsol-multi-launch-public-v1'
export type BatchStatus='running'|'confirmed'|'failed'|'unknown'|'cancelled'
export type BatchRowStatus='waiting'|'signing'|'sending'|'confirmed'|'failed'|'unknown'
export interface BatchJournalRow {mint:string;name:string;symbol:string;metadataUri:string;maxBuyLamports:string;debitLamports:string;status:BatchRowStatus;signatures:string[];creatorFeeRouting?:ResolvedCreatorFeeRouting}
export interface BatchJournal {version:1;id:string;payer:string;startedAt:string;updatedAt:string;totalDebitLamports:string;status:BatchStatus;rows:BatchJournalRow[];error?:string}
export interface BatchStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const amount=(value:unknown)=>{if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error('Invalid public amount');return value}
const address=(value:unknown)=>{if(typeof value!=='string'||new PublicKey(value).toBase58()!==value)throw new Error('Invalid public address');return value}
function publicJournal(value:BatchJournal):BatchJournal {
 if(!value||value.version!==1||!/^[-a-f0-9]{36}$/i.test(value.id)||!['running','confirmed','failed','unknown','cancelled'].includes(value.status)||!Number.isFinite(Date.parse(value.startedAt))||!Number.isFinite(Date.parse(value.updatedAt))||!Array.isArray(value.rows)||value.rows.length<2||value.rows.length>5)throw new Error('Invalid public batch record')
 const rows=value.rows.map(row=>{
  if(!row||typeof row.name!=='string'||new TextEncoder().encode(row.name).length>32||typeof row.symbol!=='string'||new TextEncoder().encode(row.symbol).length>10||typeof row.metadataUri!=='string'||row.metadataUri.length>200||!['waiting','signing','sending','confirmed','failed','unknown'].includes(row.status)||!Array.isArray(row.signatures)||row.signatures.length>5)throw new Error('Invalid public launch row')
  const signatures=row.signatures.map(signature=>{if(typeof signature!=='string'||signature.length>88||bs58.decode(signature).length!==64)throw new Error('Invalid public signature');return signature})
  const routing=row.creatorFeeRouting===undefined?undefined:parseResolvedCreatorFeeRouting(row.creatorFeeRouting)
  if(routing&&(routing.mint!==row.mint||routing.payer!==value.payer))throw new Error('Batch routing payer or mint differs')
  return {mint:address(row.mint),name:row.name,symbol:row.symbol,metadataUri:row.metadataUri,maxBuyLamports:amount(row.maxBuyLamports),debitLamports:amount(row.debitLamports),status:row.status,signatures,...(routing?{creatorFeeRouting:routing}:{})}
 })
 if(new Set(rows.map(row=>row.mint)).size!==rows.length||rows.reduce((sum,row)=>sum+BigInt(row.debitLamports),0n)!==BigInt(amount(value.totalDebitLamports)))throw new Error('Batch amounts or mints disagree')
 return {version:1,id:value.id,payer:address(value.payer),startedAt:value.startedAt,updatedAt:value.updatedAt,totalDebitLamports:value.totalDebitLamports,status:value.status,rows,...(value.error?{error:String(value.error).slice(0,500)}:{})}
}
export function readBatchJournal(storage?:BatchStorage):BatchJournal|null {
 if(!storage&&typeof localStorage==='undefined')return null
 try {const raw=(storage??localStorage).getItem(BATCH_JOURNAL_KEY);if(!raw)return null;if(raw.length>20000)throw new Error();return publicJournal(JSON.parse(raw))}
 catch {throw new Error('The previous multi-launch record cannot be read. Preserve browser data and check Activity before spending again.')}
}
/** Only explicitly selected public fields are written; no mint keys or signed packets. */
export function saveBatchJournal(value:BatchJournal,storage?:BatchStorage):BatchJournal {
 const destination=storage??localStorage,safe=publicJournal(value),raw=JSON.stringify(safe)
 destination.setItem(BATCH_JOURNAL_KEY,raw)
 if(destination.getItem(BATCH_JOURNAL_KEY)!==raw)throw new Error('The public batch record could not be saved. Nothing new was sent.')
 return safe
}
