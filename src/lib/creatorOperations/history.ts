import bs58 from 'bs58'
import {creatorAddress,exactObject,parseCreatorIntent,type CreatorOperationIntent,type CreatorStorage} from './model'

export const CREATOR_PENDING_KEY='outsol-creator-operation-pending-v1'
export const CREATOR_HISTORY_KEY='outsol-creator-operation-receipts-v1'
export interface PendingCreatorOperation {version:1;intent:CreatorOperationIntent;signature:string;blockhash:string;lastValidBlockHeight:number;submittedAt:string}
export interface CreatorOperationReceipt extends PendingCreatorOperation {status:'confirmed'|'failed';resolvedAt:string;error?:string}
export const creatorStorage=(storage?:CreatorStorage):CreatorStorage=>{if(storage)return storage;if(typeof localStorage==='undefined')throw new Error('Creator operation storage is unavailable.');return localStorage}
function timestamp(value:unknown):string{if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Invalid creator receipt time.');return new Date(value).toISOString()}
export function publicCreatorPending(value:unknown):PendingCreatorOperation{
 const row=exactObject(value,['version','intent','signature','blockhash','lastValidBlockHeight','submittedAt'])
 if(row.version!==1||typeof row.signature!=='string'||row.signature.length>88||bs58.decode(row.signature).length!==64||!bs58.decode(row.signature).some(Boolean)||typeof row.lastValidBlockHeight!=='number'||!Number.isSafeInteger(row.lastValidBlockHeight)||row.lastValidBlockHeight<1)throw new Error('Invalid creator operation recovery data.')
 return{version:1,intent:parseCreatorIntent(row.intent),signature:row.signature,blockhash:creatorAddress(row.blockhash),lastValidBlockHeight:row.lastValidBlockHeight,submittedAt:timestamp(row.submittedAt)}
}
export function readPendingCreatorOperation(storage?:CreatorStorage):PendingCreatorOperation|null{
 if(!storage&&typeof window==='undefined')return null
 try{const raw=creatorStorage(storage).getItem(CREATOR_PENDING_KEY);if(raw===null)return null;if(raw.length>20000)throw new Error();return publicCreatorPending(JSON.parse(raw))}
 catch{throw new Error('Creator recovery data cannot be read. Preserve browser data and check the original signature before spending.')}
}
export function assertNoPendingCreatorOperation(storage?:CreatorStorage):void{if(readPendingCreatorOperation(storage))throw new Error('A creator operation is pending confirmation. Check its original signature before spending.')}
export function savePendingCreatorOperation(value:PendingCreatorOperation,storage?:CreatorStorage):void{
 const record=publicCreatorPending(value),disk=creatorStorage(storage);assertNoPendingCreatorOperation(disk)
 const raw=JSON.stringify(record);disk.setItem(CREATOR_PENDING_KEY,raw)
 if(disk.getItem(CREATOR_PENDING_KEY)!==raw)throw new Error('The creator recovery record could not be saved. Nothing was submitted.')
}
export function clearPendingCreatorOperation(value:PendingCreatorOperation,storage?:CreatorStorage):void{const current=readPendingCreatorOperation(storage);if(current&&JSON.stringify(current)===JSON.stringify(publicCreatorPending(value)))creatorStorage(storage).removeItem(CREATOR_PENDING_KEY)}
export function readCreatorOperationHistory(storage?:CreatorStorage):CreatorOperationReceipt[]{
 const raw=creatorStorage(storage).getItem(CREATOR_HISTORY_KEY);if(raw===null)return []
 try{
  if(raw.length>600000)throw new Error();const rows:unknown=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>30)throw new Error()
  return rows.map(value=>{const row=exactObject(value,['version','intent','signature','blockhash','lastValidBlockHeight','submittedAt','status','resolvedAt'],['error']);if(row.status!=='confirmed'&&row.status!=='failed')throw new Error();if(row.error!==undefined&&(typeof row.error!=='string'||row.error.length>500))throw new Error();const {status,resolvedAt,error,...pending}=row;return{...publicCreatorPending(pending),status,resolvedAt:timestamp(resolvedAt),...(typeof error==='string'?{error}:{})}})
 }catch{throw new Error('Creator operation history cannot be read. Preserve browser data before continuing.')}
}
export function saveCreatorOperationReceipt(value:PendingCreatorOperation,status:'confirmed'|'failed',error?:string,storage?:CreatorStorage):CreatorOperationReceipt{
 const record=publicCreatorPending(value),current=readPendingCreatorOperation(storage)
 if(JSON.stringify(current)!==JSON.stringify(record))throw new Error('The pending creator operation changed. Its current record was preserved.')
 const receipt:CreatorOperationReceipt={...record,status,resolvedAt:new Date().toISOString(),...(error?{error:error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)}:{})}
 const history=readCreatorOperationHistory(storage),raw=JSON.stringify([receipt,...history.filter(row=>row.signature!==record.signature)].slice(0,30)),disk=creatorStorage(storage)
 disk.setItem(CREATOR_HISTORY_KEY,raw);if(disk.getItem(CREATOR_HISTORY_KEY)!==raw)throw new Error('The creator receipt could not be saved. Preserve the original signature.')
 clearPendingCreatorOperation(record,disk);return receipt
}
