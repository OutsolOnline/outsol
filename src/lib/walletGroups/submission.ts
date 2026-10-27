import {Connection,VersionedTransaction} from '@solana/web3.js'
import {inspectWalletOperationIntent} from '../walletOperations/builder'
import {withTimeout} from '../transactions/http'
import {sendAndConfirmTransaction,signedTransactionSignature,throwIfAborted} from '../transactions/send'
import {beginGroupOperation,finishGroupOperation,publicGroupOperation,readPendingGroupOperation,saveGroupCheckpoint} from './history'
import {simulateGroupSol} from './simulate'
import type {GroupOperationRecord,GroupSubmissionOptions,PreparedGroupOperation} from './types'
import type {WalletOperationLocks} from '../walletOperations/recovery'

function operationRecord(prepared:PreparedGroupOperation):GroupOperationRecord{
 if(!Number.isSafeInteger(prepared.createdAt)||prepared.createdAt>Date.now()||prepared.expiresAt!==prepared.createdAt+60000||Date.now()>prepared.expiresAt||!Array.isArray(prepared.transactions)||prepared.transactions.length<1||prepared.transactions.length>20)throw new Error('This group preview expired or is invalid. Prepare a fresh preview.')
 const transactions=prepared.transactions
 let transfers=0n,fees=0n
 for(let index=0;index<transactions.length;index++){
  const packet=transactions[index]
  if(packet.intent.kind!=='sol'||packet.preview.rentChangeLamports!=='0')throw new Error('Group operations support only reviewed SOL transfers.')
  inspectWalletOperationIntent(packet.transaction,packet.intent)
  if(Buffer.from(packet.transaction.message.serialize()).toString('base64')!==packet.message)throw new Error('A reviewed group transaction changed.')
  const amount=packet.intent.recipients!.reduce((sum,recipient)=>sum+BigInt(recipient.rawAmount),0n),fee=BigInt(packet.preview.networkFeeLamports)
  if(BigInt(packet.preview.payerBeforeLamports)-BigInt(packet.preview.payerAfterLamports)!==amount+fee)throw new Error('A reviewed group debit changed.')
  if(packet.preview.recipients.length!==packet.intent.recipients!.length||packet.preview.recipients.some((recipient,offset)=>recipient.address!==packet.intent.recipients![offset].address||recipient.rawAmount!==packet.intent.recipients![offset].rawAmount||BigInt(recipient.afterRaw)-BigInt(recipient.beforeRaw)!==BigInt(recipient.rawAmount)))throw new Error('A reviewed recipient preview changed.')
  if(index>0){const prior=transactions[index-1];if(prepared.kind==='fund'&&(packet.intent.payer!==prior.intent.payer||packet.preview.payerBeforeLamports!==prior.preview.payerAfterLamports))throw new Error('The funding sequence changed.');if(prepared.kind==='withdraw'&&(packet.preview.recipients.length!==1||packet.preview.recipients[0].address!==prior.preview.recipients[0].address||packet.preview.recipients[0].beforeRaw!==prior.preview.recipients[0].afterRaw))throw new Error('The withdrawal sequence changed.')}
  transfers+=amount;fees+=fee
 }
 if(prepared.summary.transactionCount!==transactions.length||prepared.summary.platformFeeLamports!=='0'||BigInt(prepared.summary.totalTransferLamports)!==transfers||BigInt(prepared.summary.totalNetworkFeeLamports)!==fees)throw new Error('The group cost summary changed. Prepare a fresh preview.')
 const ready=prepared.rows.filter(row=>row.status==='ready')
 if(!ready.length||new Set(ready.map(row=>row.address)).size!==ready.length||ready.reduce((sum,row)=>sum+BigInt(row.transferLamports),0n)!==transfers)throw new Error('The reviewed group wallets changed.')
 for(const row of ready){
  const packet=transactions.find(packet=>prepared.kind==='fund'?packet.intent.recipients!.some(recipient=>recipient.address===row.address):packet.intent.payer===row.address)
  if(!packet)throw new Error('A reviewed group wallet is missing.')
  if(prepared.kind==='fund'){const recipient=packet.preview.recipients.find(recipient=>recipient.address===row.address)!;if(row.beforeLamports!==recipient.beforeRaw||row.afterLamports!==recipient.afterRaw||row.transferLamports!==recipient.rawAmount||row.networkFeeLamports!=='0')throw new Error('A funding wallet amount changed.')}
  else if(row.beforeLamports!==packet.preview.payerBeforeLamports||row.afterLamports!==packet.preview.payerAfterLamports||row.transferLamports!==packet.intent.recipients![0].rawAmount||row.networkFeeLamports!==packet.preview.networkFeeLamports)throw new Error('A withdrawal wallet amount changed.')
 }
 const now=new Date().toISOString()
 return publicGroupOperation({version:1,id:prepared.id,kind:prepared.kind,groupName:prepared.groupName,groupId:prepared.groupId,createdAt:new Date(prepared.createdAt).toISOString(),updatedAt:now,status:'running',summary:prepared.summary,skipped:prepared.rows.filter(row=>row.status==='skipped'),packets:transactions.map((packet,index)=>({index,intent:packet.intent,payerBeforeLamports:packet.preview.payerBeforeLamports,payerAfterLamports:packet.preview.payerAfterLamports,networkFeeLamports:packet.preview.networkFeeLamports,status:'ready'}))})
}
function finishedStatus(record:GroupOperationRecord,cancelled=false):GroupOperationRecord['status']{
 if(record.packets.some(packet=>['submitted','unknown'].includes(packet.status)))return'unknown'
 if(record.packets.every(packet=>packet.status==='confirmed'))return'confirmed'
 if(record.packets.some(packet=>packet.status==='confirmed'))return'partial'
 return cancelled?'cancelled':'failed'
}
/** The shared lock covers the whole reviewed batch. Uncertain packets are never resent. */
export async function submitReviewedGroupOperation(connection:Connection,prepared:PreparedGroupOperation,options:GroupSubmissionOptions):Promise<GroupOperationRecord>{
 if(!options.approved)throw new Error('Review the whole group and approve these transfers before signing.')
 if(typeof options.assertAvailable!=='function'||typeof options.canSign!=='function'||typeof options.signTransaction!=='function')throw new Error('Group signing safeguards are required.')
 const locks=(options.locks||(typeof navigator!=='undefined'?navigator.locks:undefined)) as WalletOperationLocks|undefined
 if(!locks)throw new Error('Use a browser with secure cross-tab transaction coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('Another tab is signing or checking a transaction. Finish it there first.')
  throwIfAborted(options.signal);options.assertAvailable()
  const record=operationRecord(prepared)
  const expiresAt=prepared.expiresAt
  if(prepared.transactions.some(packet=>!options.canSign(packet.intent.payer)))throw new Error('A group signing wallet is locked, disconnected or changed. Unlock the required wallets and prepare again.')
  const copies=prepared.transactions.map(packet=>({...packet,intent:JSON.parse(JSON.stringify(packet.intent)),preview:JSON.parse(JSON.stringify(packet.preview)),transaction:VersionedTransaction.deserialize(packet.transaction.serialize())}))
  beginGroupOperation(record,options.storage)
  const check=(payer?:string)=>{
   throwIfAborted(options.signal);options.assertAvailable()
   const pending=readPendingGroupOperation(options.storage)
   if(!pending||pending.id!==record.id)throw new Error('The saved group operation changed. Check its current status.')
   if(payer&&Date.now()>expiresAt)throw new Error('The group preview expired. Prepare the unsubmitted wallets again with fresh costs.')
   if(payer&&!options.canSign(payer))throw new Error('A group signing wallet was locked, disconnected or changed. No further transfer was submitted.')
  }
  const checkpoint=()=>{record.updatedAt=new Date().toISOString();saveGroupCheckpoint(record,options.storage);options.onProgress?.(publicGroupOperation(record))}
  let index=0,broadcasted=false
  try{
   options.onProgress?.(publicGroupOperation(record));check()
   for(index=0;index<copies.length;index++){
    broadcasted=false
    const packet=copies[index],payer=packet.intent.payer
    check(payer)
    if(Date.now()>expiresAt)throw new Error('The group preview expired. Prepare the unsubmitted wallets again with fresh costs.')
    if(!(await withTimeout(connection.isBlockhashValid(packet.transaction.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('A group transaction expired. Prepare the unsubmitted wallets again.')
    check(payer)
    const signed=await options.signTransaction(payer,VersionedTransaction.deserialize(packet.transaction.serialize()))
    check(payer)
    if(!(signed instanceof VersionedTransaction)||Buffer.from(signed.message.serialize()).toString('base64')!==packet.message)throw new Error('The wallet changed a reviewed group transaction. Nothing further was submitted.')
    inspectWalletOperationIntent(signed,packet.intent)
    const signature=signedTransactionSignature(signed),preview=await simulateGroupSol(connection,signed,packet.intent,true,packet.preview.networkFeeLamports)
    check(payer)
    if(JSON.stringify(preview)!==JSON.stringify(packet.preview))throw new Error('A wallet balance or network cost changed since review. Prepare the unsubmitted group wallets again.')
    if(!(await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('A group transaction expired while signing. Prepare again.')
    check(payer)
    record.packets[index]={...record.packets[index],status:'submitted',signature,blockhash:signed.message.recentBlockhash,lastValidBlockHeight:packet.lastValidBlockHeight,submittedAt:new Date().toISOString()}
    checkpoint();check(payer)
    const receipt=await sendAndConfirmTransaction(connection,signed,{signal:options.signal,timeoutMs:options.timeoutMs,pollIntervalMs:options.pollIntervalMs,onBroadcast:()=>{check(payer);broadcasted=true}})
    if(receipt.submitted===false){broadcasted=false;record.packets[index].status='not-submitted';record.packets[index].error=receipt.error||'This transfer was not broadcast.';throw new Error(record.packets[index].error)}
    let finalStatus=receipt.status
    if(finalStatus==='failed'){
     const observed=await withTimeout(connection.getSignatureStatuses([signature],{searchTransactionHistory:true})),current=observed.value[0]
     finalStatus=current&&['confirmed','finalized'].includes(current.confirmationStatus||'')?current.err?'failed':'confirmed':'unknown'
    }
    record.packets[index].status=finalStatus;record.packets[index].error=receipt.error
    checkpoint()
    if(finalStatus!=='confirmed'){record.error=receipt.error||'The original signature needs a confirmation check before any further transfer.';break}
    check()
   }
  }catch(error){
   record.error=error instanceof Error?error.message:'The group operation stopped.'
   const current=record.packets[index]
   if(current&&current.status!=='confirmed'&&current.status!=='failed'){
    current.status=broadcasted?'unknown':'not-submitted';current.error=record.error
   }
  }
  for(const packet of record.packets)if(packet.status==='ready')packet.status='not-submitted'
  record.status=finishedStatus(record,!!options.signal?.aborted);record.updatedAt=new Date().toISOString()
  try{
   saveGroupCheckpoint(record,options.storage)
   if(record.status!=='unknown')finishGroupOperation(record,options.storage)
  }catch(error){record.error=`${record.error?`${record.error} `:''}${error instanceof Error?error.message:'The public recovery record could not be updated. Preserve the saved signatures.'}`}
  options.onProgress?.(publicGroupOperation(record))
  return publicGroupOperation(record)
 })
}
