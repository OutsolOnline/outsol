import type {Connection,SignatureStatus} from '@solana/web3.js'
import {withTimeout} from '../transactions/http'
import {readPendingCreatorOperation,saveCreatorOperationReceipt,type CreatorOperationReceipt,type PendingCreatorOperation} from './history'
import type {CreatorLocks,CreatorStorage} from './model'

export interface CreatorRecoveryResult {status:'none'|'unknown'|'changed'|'busy'|'confirmed'|'failed';pending:PendingCreatorOperation|null;receipt?:CreatorOperationReceipt;error?:string}
const finalStatus=(value:SignatureStatus|null|undefined)=>value&&['confirmed','finalized'].includes(value.confirmationStatus??'')?value.err?'failed':'confirmed':null
/** Read-only signature recovery. No builder, signer, simulation or submit function is reachable. */
export async function reconcileCreatorOperationRecord(connection:Connection,options:{storage?:CreatorStorage;expectedSignature?:string}={}):Promise<CreatorRecoveryResult>{
 const record=readPendingCreatorOperation(options.storage);if(!record)return{status:'none',pending:null}
 if(options.expectedSignature&&record.signature!==options.expectedSignature)return{status:'changed',pending:record}
 const changed=():CreatorRecoveryResult|null=>{const current=readPendingCreatorOperation(options.storage);return JSON.stringify(current)===JSON.stringify(record)?null:{status:'changed',pending:current}}
 const unknown=():CreatorRecoveryResult=>changed()??{status:'unknown',pending:readPendingCreatorOperation(options.storage),error:'Confirmation remains unknown. Preserve the original signature; nothing will be resent.'}
 const finish=(status:'confirmed'|'failed',error?:string):CreatorRecoveryResult=>{const switched=changed();if(switched)return switched;const receipt=saveCreatorOperationReceipt(record,status,error,options.storage);return{status,pending:readPendingCreatorOperation(options.storage),receipt,error}}
 const first=await withTimeout(connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})),switched=changed();if(switched)return switched
 const status=finalStatus(first.value[0]);if(status)return finish(status,status==='failed'?'The creator operation failed on chain.':undefined)
 if(first.value[0])return unknown()
 const [validity,height]=await Promise.all([withTimeout(connection.isBlockhashValid(record.blockhash,{commitment:'finalized'})),withTimeout(connection.getBlockHeight('finalized'))]),replacement=changed();if(replacement)return replacement
 if(typeof validity.value!=='boolean'||!Number.isSafeInteger(height)||height<1||validity.value||height<=record.lastValidBlockHeight)return unknown()
 const [last,transaction]=await Promise.all([withTimeout(connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})),withTimeout(connection.getTransaction(record.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}))]),replaced=changed();if(replaced)return replaced
 const observed=finalStatus(last.value[0]);if(observed==='confirmed'||transaction?.meta?.err===null)return finish('confirmed')
 if(observed==='failed'||transaction?.meta?.err)return finish('failed','The creator operation failed on chain.')
 if(last.value[0]||transaction)return unknown()
 return finish('failed','The original blockhash expired on the finalized chain and the signature was absent from history. Nothing was resent.')
}
export async function reconcilePendingCreatorOperation(connection:Connection,options:{storage?:CreatorStorage;locks?:CreatorLocks}={}):Promise<CreatorRecoveryResult>{
 const locks=options.locks??(typeof navigator!=='undefined'?navigator.locks as CreatorLocks:undefined)
 if(!locks)throw new Error('Use a current browser with secure cross-tab recovery coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>lock?reconcileCreatorOperationRecord(connection,options):{status:'busy',pending:readPendingCreatorOperation(options.storage),error:'Another tab is signing or checking a transaction. Try again when it finishes.'})
}
