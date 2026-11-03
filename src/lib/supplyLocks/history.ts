import bs58 from 'bs58'
import {creatorAddress,exactObject} from '../creatorOperations/model'
import {creatorStorage} from '../creatorOperations/history'
import {parseSupplyLockIntent,type SupplyLockIntent,type SupplyLockStorage} from './model'

export const SUPPLY_LOCK_PENDING_KEY='outsol-supply-lock-pending-v1'
export const SUPPLY_LOCK_HISTORY_KEY='outsol-supply-lock-receipts-v1'
export interface PendingSupplyLock {version:1;intent:SupplyLockIntent;signature:string;blockhash:string;lastValidBlockHeight:number;submittedAt:string}
export interface SupplyLockReceipt extends PendingSupplyLock {status:'confirmed'|'failed';resolvedAt:string;error?:string}
function date(value:unknown):string{if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw new Error('Invalid lock receipt time.');return new Date(value).toISOString()}
export function publicSupplyLockPending(value:unknown):PendingSupplyLock{
 const row=exactObject(value,['version','intent','signature','blockhash','lastValidBlockHeight','submittedAt'])
 if(row.version!==1||typeof row.signature!=='string'||row.signature.length>88||bs58.decode(row.signature).length!==64||!bs58.decode(row.signature).some(Boolean)||typeof row.lastValidBlockHeight!=='number'||!Number.isSafeInteger(row.lastValidBlockHeight)||row.lastValidBlockHeight<1)throw new Error('Invalid lock recovery record.')
 return{version:1,intent:parseSupplyLockIntent(row.intent),signature:row.signature,blockhash:creatorAddress(row.blockhash),lastValidBlockHeight:row.lastValidBlockHeight,submittedAt:date(row.submittedAt)}
}
export function readPendingSupplyLock(storage?:SupplyLockStorage):PendingSupplyLock|null{
 if(!storage&&typeof window==='undefined')return null
 try{const raw=creatorStorage(storage).getItem(SUPPLY_LOCK_PENDING_KEY);if(raw===null)return null;if(raw.length>10000)throw new Error();return publicSupplyLockPending(JSON.parse(raw))}
 catch{throw new Error('Supply lock recovery cannot be read. Preserve browser data and check the original signature before spending.')}
}
export function assertNoPendingSupplyLock(storage?:SupplyLockStorage):void{if(readPendingSupplyLock(storage))throw new Error('A supply lock is pending confirmation. Check its original signature before spending.')}
export function savePendingSupplyLock(value:PendingSupplyLock,storage?:SupplyLockStorage):void{
 const record=publicSupplyLockPending(value),disk=creatorStorage(storage);assertNoPendingSupplyLock(disk)
 const raw=JSON.stringify(record);disk.setItem(SUPPLY_LOCK_PENDING_KEY,raw);if(disk.getItem(SUPPLY_LOCK_PENDING_KEY)!==raw)throw new Error('The supply lock recovery record could not be saved. Nothing was submitted.')
}
export function clearPendingSupplyLock(value:PendingSupplyLock,storage?:SupplyLockStorage):void{if(JSON.stringify(readPendingSupplyLock(storage))===JSON.stringify(publicSupplyLockPending(value)))creatorStorage(storage).removeItem(SUPPLY_LOCK_PENDING_KEY)}
export function readSupplyLockHistory(storage?:SupplyLockStorage):SupplyLockReceipt[]{
 try{const raw=creatorStorage(storage).getItem(SUPPLY_LOCK_HISTORY_KEY);if(raw===null)return [];if(raw.length>300000)throw new Error();const rows:unknown=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>30)throw new Error();return rows.map(value=>{const row=exactObject(value,['version','intent','signature','blockhash','lastValidBlockHeight','submittedAt','status','resolvedAt'],['error']),{status,resolvedAt,error,...pending}=row;if((status!=='confirmed'&&status!=='failed')||(error!==undefined&&(typeof error!=='string'||error.length>500)))throw new Error();return{...publicSupplyLockPending(pending),status,resolvedAt:date(resolvedAt),...(typeof error==='string'?{error}:{})}})}
 catch{throw new Error('Supply lock history cannot be read. Preserve browser data before continuing.')}
}
export function saveSupplyLockReceipt(value:PendingSupplyLock,status:'confirmed'|'failed',error?:string,storage?:SupplyLockStorage):SupplyLockReceipt{
 const record=publicSupplyLockPending(value);if(JSON.stringify(readPendingSupplyLock(storage))!==JSON.stringify(record))throw new Error('The pending lock changed. Its current record was preserved.')
 const receipt:SupplyLockReceipt={...record,status,resolvedAt:new Date().toISOString(),...(error?{error:error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)}:{})},rows=readSupplyLockHistory(storage),disk=creatorStorage(storage),raw=JSON.stringify([receipt,...rows.filter(row=>row.signature!==record.signature)].slice(0,30))
 disk.setItem(SUPPLY_LOCK_HISTORY_KEY,raw);if(disk.getItem(SUPPLY_LOCK_HISTORY_KEY)!==raw)throw new Error('The lock receipt could not be saved. Preserve its original signature.')
 clearPendingSupplyLock(record,disk);return receipt
}
