import bs58 from 'bs58'
import { publicWalletOperationIntent } from '../walletOperations/history'
import { publicAddress } from '../walletOperations/model'
import type { GroupOperationRecord, GroupOperationStorage, GroupPacketRecord, GroupPreviewRow, GroupSummary } from './types'

export const GROUP_OPERATION_PENDING_KEY='outsol-group-operation-pending-v1'
export const GROUP_OPERATION_HISTORY_KEY='outsol-group-operation-receipts-v1'
const MAX_RECORD=100000,MAX_HISTORY=2000000
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid group operation.');return value as Record<string,any>}
function amount(value:unknown):string{if(typeof value!=='string'||!/^(0|[1-9]\d{0,20})$/.test(value))throw new Error('Invalid public amount.');return value}
function date(value:unknown):string{if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw new Error('Invalid operation date.');return new Date(value).toISOString()}
function name(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>60||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid public group name.');return value}
function summary(value:unknown):GroupSummary{
 const item=object(value)
 if(!Number.isInteger(item.walletCount)||item.walletCount<1||item.walletCount>20||!Number.isInteger(item.transactionCount)||item.transactionCount<0||item.transactionCount>20||item.platformFeeLamports!=='0')throw new Error('Invalid group summary.')
 const result:GroupSummary={walletCount:item.walletCount,transactionCount:item.transactionCount,platformFeeLamports:'0',totalTransferLamports:amount(item.totalTransferLamports),totalNetworkFeeLamports:amount(item.totalNetworkFeeLamports),reserveLamports:amount(item.reserveLamports)}
 for(const key of ['payerBeforeLamports','payerAfterLamports','destinationBeforeLamports','destinationAfterLamports'] as const)if(item[key]!==undefined)result[key]=amount(item[key])
 return result
}
function skipped(value:unknown):GroupPreviewRow{
 const item=object(value)
 if(typeof item.walletId!=='string'||item.walletId.length>60||item.status!=='skipped'||typeof item.reason!=='string'||!item.reason||item.reason.length>300)throw new Error('Invalid skipped wallet.')
 return{walletId:item.walletId,name:name(item.name),address:publicAddress(item.address,true),beforeLamports:amount(item.beforeLamports),afterLamports:amount(item.afterLamports),transferLamports:amount(item.transferLamports),networkFeeLamports:amount(item.networkFeeLamports),status:'skipped',reason:item.reason}
}
function packet(value:unknown,index:number):GroupPacketRecord{
 const item=object(value),intent=publicWalletOperationIntent(item.intent)
 if(item.index!==index||intent.kind!=='sol'||!['ready','submitted','confirmed','failed','unknown','not-submitted'].includes(item.status))throw new Error('Invalid group packet.')
 const result:GroupPacketRecord={index,intent,payerBeforeLamports:amount(item.payerBeforeLamports),payerAfterLamports:amount(item.payerAfterLamports),networkFeeLamports:amount(item.networkFeeLamports),status:item.status}
 if(item.signature!==undefined){
  if(typeof item.signature!=='string'||item.signature.length>88||bs58.decode(item.signature).length!==64||!Number.isSafeInteger(item.lastValidBlockHeight)||item.lastValidBlockHeight<1)throw new Error('Invalid group signature.')
  result.signature=item.signature;result.blockhash=publicAddress(item.blockhash);result.lastValidBlockHeight=item.lastValidBlockHeight;result.submittedAt=date(item.submittedAt)
 }else if(['submitted','confirmed','unknown'].includes(item.status))throw new Error('Submitted group packet needs a signature.')
 if(item.error!==undefined){if(typeof item.error!=='string')throw new Error('Invalid group error.');result.error=item.error.slice(0,500)}
 return result
}
/** Explicit public projection; keys, packets and wallet stores never enter recovery data. */
export function publicGroupOperation(value:unknown):GroupOperationRecord{
 const item=object(value)
 if(item.version!==1||!uuid(item.id)||!['fund','withdraw'].includes(item.kind)||!['running','confirmed','partial','failed','unknown','cancelled'].includes(item.status)||!Array.isArray(item.packets)||item.packets.length>20||!Array.isArray(item.skipped)||item.skipped.length>20)throw new Error('Invalid group recovery record.')
 const result:GroupOperationRecord={version:1,id:item.id,kind:item.kind,groupName:name(item.groupName),createdAt:date(item.createdAt),updatedAt:date(item.updatedAt),status:item.status,packets:item.packets.map(packet),skipped:item.skipped.map(skipped),summary:summary(item.summary)}
 if(item.groupId!==undefined){if(!uuid(item.groupId))throw new Error('Invalid group identifier.');result.groupId=item.groupId}
 if(item.error!==undefined){if(typeof item.error!=='string')throw new Error('Invalid group error.');result.error=item.error.slice(0,500)}
 if(result.summary.transactionCount!==result.packets.length)throw new Error('Group transaction count changed.')
 if(result.kind==='withdraw'&&result.packets.some(value=>value.intent.recipients!.length!==1))throw new Error('A withdrawal must have one destination.')
 return result
}
function target(storage?:GroupOperationStorage):GroupOperationStorage{if(storage)return storage;if(typeof localStorage==='undefined')throw new Error('Group recovery storage is unavailable.');return localStorage}
export function readPendingGroupOperation(storage?:GroupOperationStorage):GroupOperationRecord|null{
 if(!storage&&typeof window==='undefined')return null
 try{const raw=target(storage).getItem(GROUP_OPERATION_PENDING_KEY);if(raw===null)return null;if(raw.length>MAX_RECORD)throw new Error();return publicGroupOperation(JSON.parse(raw))}catch{throw new Error('Group recovery data cannot be read. Preserve browser data and check the saved signatures before moving funds.')}
}
export function assertNoPendingGroupOperation(storage?:GroupOperationStorage):void{if(readPendingGroupOperation(storage))throw new Error('A group operation needs a confirmation check. Open Wallets before moving funds again.')}
export function readGroupOperationHistory(storage?:GroupOperationStorage):GroupOperationRecord[]{
 try{const raw=target(storage).getItem(GROUP_OPERATION_HISTORY_KEY);if(raw===null)return[];if(raw.length>MAX_HISTORY)throw new Error();const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>30)throw new Error();return values.map(publicGroupOperation)}catch{throw new Error('Group operation history cannot be read. Preserve browser data before moving funds.')}
}
function write(record:GroupOperationRecord,storage:GroupOperationStorage){const raw=JSON.stringify(publicGroupOperation(record));if(raw.length>MAX_RECORD)throw new Error('Group recovery data exceeded its storage limit.');storage.setItem(GROUP_OPERATION_PENDING_KEY,raw);if(storage.getItem(GROUP_OPERATION_PENDING_KEY)!==raw)throw new Error('The group recovery record could not be saved. Nothing new was submitted.')}
export function beginGroupOperation(record:GroupOperationRecord,storage?:GroupOperationStorage):void{const destination=target(storage);assertNoPendingGroupOperation(destination);if(record.status!=='running'||record.packets.some(value=>value.status!=='ready'))throw new Error('A new group operation must begin unsubmitted.');write(record,destination)}
export function saveGroupCheckpoint(record:GroupOperationRecord,storage?:GroupOperationStorage):void{
 const destination=target(storage),existing=readPendingGroupOperation(destination),next=publicGroupOperation(record)
 if(!existing||existing.id!==next.id||existing.packets.length!==next.packets.length)throw new Error('The saved group operation changed. Check its current status.')
 for(let index=0;index<existing.packets.length;index++){
  const before=existing.packets[index],after=next.packets[index]
  if(JSON.stringify(before.intent)!==JSON.stringify(after.intent)||before.payerBeforeLamports!==after.payerBeforeLamports||before.payerAfterLamports!==after.payerAfterLamports||before.networkFeeLamports!==after.networkFeeLamports)throw new Error('A reviewed group amount changed.')
  if(before.signature&&(before.signature!==after.signature||before.blockhash!==after.blockhash||before.lastValidBlockHeight!==after.lastValidBlockHeight))throw new Error('A saved group signature cannot be replaced or discarded.')
  if(['confirmed','failed','not-submitted'].includes(before.status)&&before.status!==after.status)throw new Error('A resolved group packet cannot be retried.')
 }
 write(next,destination)
}
export function finishGroupOperation(record:GroupOperationRecord,storage?:GroupOperationStorage):void{
 const destination=target(storage),next=publicGroupOperation(record)
 if(['running','unknown'].includes(next.status)||next.packets.some(value=>['submitted','unknown','ready'].includes(value.status)))throw new Error('Group confirmation is unresolved; preserve the pending journal.')
 saveGroupCheckpoint(next,destination)
 const history=readGroupOperationHistory(destination),raw=JSON.stringify([next,...history.filter(value=>value.id!==next.id)].slice(0,30))
 if(raw.length>MAX_HISTORY)throw new Error('Group history storage is full. Preserve the saved operation.')
 destination.setItem(GROUP_OPERATION_HISTORY_KEY,raw)
 if(destination.getItem(GROUP_OPERATION_HISTORY_KEY)!==raw)throw new Error('The group receipt could not be saved. Preserve the pending record.')
 if(readPendingGroupOperation(destination)?.id!==next.id)throw new Error('The pending group operation changed.')
 destination.removeItem(GROUP_OPERATION_PENDING_KEY)
 if(readPendingGroupOperation(destination))throw new Error('The resolved group operation could not be cleared. Check its status again.')
}
