import type {Connection,SignatureStatus} from '@solana/web3.js'
import {withTimeout} from '../transactions/http'
import type {WalletOperationLocks} from '../walletOperations/recovery'
import {finishGroupOperation,readPendingGroupOperation,saveGroupCheckpoint} from './history'
import type {GroupOperationRecord,GroupOperationStorage} from './types'
const finalStatus=(value:SignatureStatus|null|undefined)=>value&&['confirmed','finalized'].includes(value.confirmationStatus||'')?value.err?'failed':'confirmed':null
/** Only checks original public signatures. Never rebuilds, signs, resends or resumes. */
export async function reconcilePendingGroupOperation(connection:Connection,options:{storage?:GroupOperationStorage;locks?:WalletOperationLocks}={}):Promise<GroupOperationRecord|null>{
 const locks=(options.locks||(typeof navigator!=='undefined'?navigator.locks:undefined)) as WalletOperationLocks|undefined
 if(!locks)throw new Error('Use a browser with secure cross-tab transaction coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('Another tab is signing or checking a transaction. Try again when it finishes.')
  const record=readPendingGroupOperation(options.storage)
  if(!record)return null
  const current=()=>{if(readPendingGroupOperation(options.storage)?.id!==record.id)throw new Error('The saved group operation changed. Check the latest record.')}
  for(const packet of record.packets){
   if(!['submitted','unknown'].includes(packet.status))continue
   current()
   const first=await withTimeout(connection.getSignatureStatuses([packet.signature!],{searchTransactionHistory:true}));current()
   const status=finalStatus(first.value[0])
   if(status){packet.status=status;packet.error=status==='failed'?'This transaction failed on chain.':undefined;continue}
   packet.status='unknown'
   if(first.value[0])continue
   const[validity,height]=await Promise.all([withTimeout(connection.isBlockhashValid(packet.blockhash!,{commitment:'finalized'})),withTimeout(connection.getBlockHeight('finalized'))]);current()
   if(validity.value||height<=packet.lastValidBlockHeight!)continue
   const[last,transaction]=await Promise.all([withTimeout(connection.getSignatureStatuses([packet.signature!],{searchTransactionHistory:true})),withTimeout(connection.getTransaction(packet.signature!,{commitment:'finalized',maxSupportedTransactionVersion:0}))]);current()
   const observed=finalStatus(last.value[0])
   if(observed==='confirmed'||transaction?.meta?.err===null){packet.status='confirmed';packet.error=undefined}
   else if(observed==='failed'||transaction?.meta?.err){packet.status='failed';packet.error='This transaction failed on chain.'}
   else if(!last.value[0]&&!transaction){packet.status='failed';packet.error='The original blockhash expired on the finalized chain and the signature was not found. Nothing was resent.'}
  }
  for(const packet of record.packets)if(packet.status==='ready')packet.status='not-submitted'
  record.status=record.packets.some(packet=>['submitted','unknown'].includes(packet.status))?'unknown':record.packets.every(packet=>packet.status==='confirmed')?'confirmed':record.packets.some(packet=>packet.status==='confirmed')?'partial':record.packets.some(packet=>packet.status==='failed')?'failed':'cancelled'
  record.updatedAt=new Date().toISOString();record.error=record.status==='unknown'?'Some original signatures are still unconfirmed. Nothing will be resent automatically.':record.status==='partial'?'Confirmed transfers are preserved. Remaining transfers were not resumed; prepare a fresh review.':undefined
  current();saveGroupCheckpoint(record,options.storage)
  if(record.status!=='unknown')finishGroupOperation(record,options.storage)
  return record
 })
}
