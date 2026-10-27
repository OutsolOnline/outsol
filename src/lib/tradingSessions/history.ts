import {PublicKey} from '@solana/web3.js'
import bs58 from 'bs58'
import type {TradeStorage} from '@/lib/venues/tradeHistory'
import {validateSessionConfig} from './config'
import type {TradingSessionJournal,TradingSessionRow} from './types'
export const SESSION_HISTORY_KEY='outsol-trading-sessions-v1'
const target=(storage?:TradeStorage)=>{if(storage)return storage;if(typeof localStorage==='undefined')throw new Error('Session storage is unavailable.');return localStorage}
const amount=(value:unknown)=>{if(typeof value!=='string'||!/^\d{1,30}$/.test(value))throw new Error('Invalid public session amount.');return value}
const time=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Invalid session time.');return value}
const obj=(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid session record.');return value as Record<string,unknown>}
function publicJournal(value:unknown):TradingSessionJournal {
 const input=obj(value)
 if(input.version!==1||typeof input.id!=='string'||!input.id||input.id.length>80||!['running','completed','stopped','failed','unknown'].includes(String(input.status))||!['idle','monitoring','preparing','signing','sending'].includes(String(input.phase))||!Array.isArray(input.rows)||input.rows.length>10)throw new Error('Invalid public session record.')
 const config=validateSessionConfig(input.config)
 const rows:TradingSessionRow[]=input.rows.map((value,index)=>{
  const row=obj(value)
  if(row.index!==index||!['buy','sell'].includes(String(row.action))||!['preparing','signing','sending','confirmed','failed','unknown','not-submitted'].includes(String(row.status))||typeof row.mint!=='string')throw new Error('Invalid public trade row.')
  const result:TradingSessionRow={index,mint:new PublicKey(row.mint).toBase58(),action:row.action as 'buy'|'sell',status:row.status as TradingSessionRow['status'],debitReservedLamports:amount(row.debitReservedLamports),createdAt:time(row.createdAt)}
  if(row.signature!==undefined){if(typeof row.signature!=='string'||row.signature.length>88||bs58.decode(row.signature).length!==64)throw new Error('Invalid saved trade signature.');result.signature=row.signature}
  if(row.error!==undefined){if(typeof row.error!=='string')throw new Error('Invalid session error.');result.error=row.error.slice(0,500)}
  return result
 })
 const result:TradingSessionJournal={version:1,id:input.id,config,status:input.status as TradingSessionJournal['status'],phase:input.phase as TradingSessionJournal['phase'],armedAt:time(input.armedAt),updatedAt:time(input.updatedAt),reservedDebitLamports:amount(input.reservedDebitLamports),rows}
 if(input.message!==undefined){if(typeof input.message!=='string')throw new Error('Invalid session message.');result.message=input.message.slice(0,500)}
 if(input.lastCapLamports!==undefined)result.lastCapLamports=amount(input.lastCapLamports)
 return result
}
function savedHistory(storage:TradeStorage):TradingSessionJournal[] {
 const raw=storage.getItem(SESSION_HISTORY_KEY)
 if(!raw)return []
 if(raw.length>300000)throw new Error('Session history is too large. Preserve it and check Activity before continuing.')
 const values:unknown=JSON.parse(raw)
 if(!Array.isArray(values)||values.length>20)throw new Error('Session history is unreadable.')
 return values.map(publicJournal)
}
export function saveSessionJournal(value:TradingSessionJournal,storage?:TradeStorage):void {
 const destination=target(storage),journal=publicJournal(value)
 const rows=[journal,...savedHistory(destination).filter(row=>row.id!==journal.id)].slice(0,20),serialized=JSON.stringify(rows)
 destination.setItem(SESSION_HISTORY_KEY,serialized)
 if(destination.getItem(SESSION_HISTORY_KEY)!==serialized)throw new Error('Session progress could not be saved. Nothing further will be sent.')
}
/** Reload restores public progress only. A previous run can never become armed here. */
export function readSessionHistory(storage?:TradeStorage):TradingSessionJournal[] {
 return savedHistory(target(storage)).map(value=>value.status==='running'?{...value,status:'stopped',phase:'idle',message:'This browser session ended. It was not rearmed on reload; check any saved signature in Manage token.'}:value)
}
