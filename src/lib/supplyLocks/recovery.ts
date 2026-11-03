import type {Connection,SignatureStatus} from '@solana/web3.js'
import {withTimeout} from '../transactions/http'
import {readPendingSupplyLock,saveSupplyLockReceipt,type PendingSupplyLock,type SupplyLockReceipt} from './history'
import type {SupplyLockLocks,SupplyLockStorage} from './model'
export interface SupplyLockRecovery {status:'none'|'unknown'|'changed'|'busy'|'confirmed'|'failed';pending:PendingSupplyLock|null;receipt?:SupplyLockReceipt;error?:string}
const final=(value:SignatureStatus|null|undefined)=>value&&['confirmed','finalized'].includes(value.confirmationStatus??'')?value.err?'failed':'confirmed':null
export async function reconcileSupplyLockRecord(connection:Connection,options:{storage?:SupplyLockStorage;expectedSignature?:string}={}):Promise<SupplyLockRecovery>{
 const record=readPendingSupplyLock(options.storage);if(!record)return{status:'none',pending:null}
 if(options.expectedSignature&&record.signature!==options.expectedSignature)return{status:'changed',pending:record}
 const changed=():SupplyLockRecovery|null=>{const current=readPendingSupplyLock(options.storage);return JSON.stringify(current)===JSON.stringify(record)?null:{status:'changed',pending:current}}
 const unknown=():SupplyLockRecovery=>changed()??{status:'unknown',pending:readPendingSupplyLock(options.storage),error:'The original lock remains unresolved. Nothing will be resent automatically.'}
 const finish=(status:'confirmed'|'failed',error?:string):SupplyLockRecovery=>{const replaced=changed();if(replaced)return replaced;const receipt=saveSupplyLockReceipt(record,status,error,options.storage);return{status,pending:readPendingSupplyLock(options.storage),receipt,error}}
 const first=await withTimeout(connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})),switched=changed();if(switched)return switched
 const status=final(first.value[0]);if(status)return finish(status,status==='failed'?'The lock transaction failed on chain.':undefined)
 if(first.value[0])return unknown()
 const [validity,height]=await Promise.all([withTimeout(connection.isBlockhashValid(record.blockhash,{commitment:'finalized'})),withTimeout(connection.getBlockHeight('finalized'))]),replacement=changed();if(replacement)return replacement
 if(typeof validity.value!=='boolean'||!Number.isSafeInteger(height)||height<1||validity.value||height<=record.lastValidBlockHeight)return unknown()
 const [last,transaction]=await Promise.all([withTimeout(connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})),withTimeout(connection.getTransaction(record.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}))]),lastChange=changed();if(lastChange)return lastChange
 const observed=final(last.value[0]);if(observed==='confirmed'||transaction?.meta?.err===null)return finish('confirmed')
 if(observed==='failed'||transaction?.meta?.err)return finish('failed','The lock transaction failed on chain.')
 if(last.value[0]||transaction)return unknown()
 return finish('failed','The original lock blockhash expired on the finalized chain and its signature was absent from history. Nothing was resent.')
}
export async function reconcilePendingSupplyLock(connection:Connection,options:{storage?:SupplyLockStorage;locks?:SupplyLockLocks}={}):Promise<SupplyLockRecovery>{
 const locks=options.locks??(typeof navigator!=='undefined'?navigator.locks as SupplyLockLocks:undefined);if(!locks)throw new Error('Use a current browser with secure cross-tab recovery coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>lock?reconcileSupplyLockRecord(connection,options):{status:'busy',pending:readPendingSupplyLock(options.storage),error:'Another tab is signing or checking a transaction.'})
}
