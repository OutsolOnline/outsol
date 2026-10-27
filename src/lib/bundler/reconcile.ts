import {PublicKey,type Connection,type SignatureStatus} from '@solana/web3.js'
import {withTimeout} from '@/lib/transactions/http'
import {readPending,clearPendingIfMatching,saveConfirmed} from '@/lib/launchHistory'
import {publicBundleReceipt} from './receipt'
import {parseBundleReceipt} from './pending'
import type {BundleResult} from './types'

type Outcome='confirmed'|'failed'|'expired'|'unknown'
export interface BundleReconciliation {receipt:BundleResult;resolvedSignatures:string[];confirmedSignatures:string[];creationStatus:Outcome}
const observed=(status:SignatureStatus|null|undefined):Outcome=>{
 if(!status||!Number.isSafeInteger(status.slot)||status.slot<0||!['confirmed','finalized'].includes(status.confirmationStatus??'')||status.err===undefined)return 'unknown'
 if(status.err===null)return 'confirmed'
 return typeof status.err==='string'||typeof status.err==='object'?'failed':'unknown'
}

/** Read-only evidence collection. Never retries a send or invents legacy expiry. */
export async function reconcileBundleReceipt(connection:Connection,input:BundleResult):Promise<BundleReconciliation>{
 const receipt=parseBundleReceipt(publicBundleReceipt(input))
 if(!receipt?.submittedSignatures?.length)throw new Error('No original bundle signatures are available for reconciliation.')
 const signatures=[...receipt.submittedSignatures],outcomes=new Map<string,Outcome>(signatures.map(signature=>[signature,'unknown']))
 const result=(status:BundleResult['status'],error?:string):BundleReconciliation=>({receipt:{...receipt,status,...(error?{success:false,error}:{error:undefined})},resolvedSignatures:signatures.filter(signature=>outcomes.get(signature)!=='unknown'),confirmedSignatures:signatures.filter(signature=>outcomes.get(signature)==='confirmed'),creationStatus:receipt.createSignature?outcomes.get(receipt.createSignature)??'unknown':'unknown'})
 try{
  const statuses=await withTimeout(connection.getSignatureStatuses(signatures,{searchTransactionHistory:true}))
  if(!Array.isArray(statuses.value)||statuses.value.length!==signatures.length)throw new Error('Incomplete signature history')
  signatures.forEach((signature,index)=>outcomes.set(signature,observed(statuses.value[index])))
  const candidates=signatures.filter((signature,index)=>statuses.value[index]===null&&receipt.submissions?.some(item=>item.signature===signature))
  if(candidates.length){
   const height=await withTimeout(connection.getBlockHeight('finalized'))
   if(!Number.isSafeInteger(height)||height<0)throw new Error('Invalid finalized height')
   const expired:string[]=[]
   for(const signature of candidates){
    const context=receipt.submissions!.find(item=>item.signature===signature)!
    if(height<=context.expiresAfterBlockHeight)continue
    const validity=await withTimeout(connection.isBlockhashValid(context.blockhash,{commitment:'finalized'}))
    if(typeof validity.value!=='boolean')throw new Error('Unverified blockhash expiry')
    if(!validity.value)expired.push(signature)
   }
   if(expired.length){
    // History is searched again after both expiry observations, closing the read race.
    const history=await withTimeout(connection.getSignatureStatuses(expired,{searchTransactionHistory:true}))
    if(!Array.isArray(history.value)||history.value.length!==expired.length)throw new Error('Incomplete final signature history')
    expired.forEach((signature,index)=>outcomes.set(signature,history.value[index]===null?'expired':observed(history.value[index])))
   }
  }
  if(signatures.every(signature=>outcomes.get(signature)==='confirmed'))return result(receipt.success?'confirmed':'partial',receipt.success?undefined:'All submitted transactions confirmed. Pending browser actions were not resumed.')
  if(signatures.some(signature=>outcomes.get(signature)==='unknown'))return result('unknown',!receipt.submissions?'This legacy receipt has no original expiry context. Confirmation remains unknown; preserve its signatures.':'Some transaction history or expiry is still uncertain. Original signatures are preserved.')
  const creation=receipt.createSignature?outcomes.get(receipt.createSignature):'unknown'
  if(creation==='confirmed')return result('partial','Token creation confirmed. A later transaction failed or expired without landing. Pending browser actions were not resumed.')
  if(creation==='failed'||creation==='expired'){
   if(!receipt.mintAddress)throw new Error('The original mint is unavailable')
   const mint=await withTimeout(connection.getAccountInfo(new PublicKey(receipt.mintAddress),'finalized'))
   if(mint){if(receipt.createSignature)outcomes.set(receipt.createSignature,'unknown');return result('unknown','The mint exists but its creation history is uncertain. Preserve the original signatures.')}
   return result('failed',creation==='expired'?'The original creation expired without landing. All submitted signatures were resolved; nothing was retried.':'The original creation failed. All submitted signatures were resolved; nothing was retried.')
  }
  return result('unknown','The original creation signature could not be identified. Preserve the submitted signatures.')
 }catch{return result('unknown','Confirmation or finalized expiry could not be verified. Original signatures and recovery records are preserved.')}
}

/** Call after persisting the reconciliation, under the same global operation lock. */
export function settleMatchingLaunchPending(outcome:BundleReconciliation):void{
 const pending=readPending()
 if(!pending||pending.phase==='lookup'||pending.mint!==outcome.receipt.mintAddress||!outcome.receipt.createSignature||pending.signatures[0]!==outcome.receipt.createSignature||!pending.signatures.every(signature=>outcome.resolvedSignatures.includes(signature)))return
 if(JSON.stringify(pending.creatorFeeRouting)!==JSON.stringify(outcome.receipt.creatorFeeRouting))return
 const creation=outcome.receipt.submissions?.find(item=>item.signature===outcome.receipt.createSignature)
 if(creation&&(creation.payer!==pending.payer||creation.blockhash!==pending.blockhash))return
 if(pending.signatures.every(signature=>outcome.confirmedSignatures.includes(signature)))saveConfirmed(pending)
 else clearPendingIfMatching(pending)
}
