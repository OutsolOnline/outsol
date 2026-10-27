import type {Connection,SignatureStatus} from '@solana/web3.js'
import {withTimeout} from '@/lib/transactions/http'
import {readTradePending,saveTradeExpiryBoundary,saveTradeReceipt,type PendingTrade,type TradeReceipt,type TradeStorage} from './tradeHistory'

export interface TradeRecoveryResult{status:'confirmed'|'failed'|'unknown'|'changed'|'none'|'busy';pending:PendingTrade|null;receipt?:TradeReceipt;error?:string}
export interface TradeRecoveryLocks{request:(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<TradeRecoveryResult>)=>Promise<TradeRecoveryResult>}
interface RecoveryOptions{storage?:TradeStorage;expectedSignature?:string}
const completeStatus=(value:SignatureStatus|null|undefined)=>value&&['confirmed','finalized'].includes(value.confirmationStatus||'')?(value.err?'failed':'confirmed'):null

/** Called inside the shared submission lock, including the existing sign flow.
 * Every write checks the current signature again after awaited chain reads.
 */
export async function reconcileTradeRecord(connection:Connection,options:RecoveryOptions={}):Promise<TradeRecoveryResult>{
  const {storage}=options,record=readTradePending(storage)
  if(!record)return {status:'none',pending:null}
  if(options.expectedSignature&&record.signature!==options.expectedSignature)return {status:'changed',pending:record}
  const changed=()=>{const latest=readTradePending(storage);return latest?.signature===record.signature?null:{status:'changed' as const,pending:latest}}
  const unknown=(error='Confirmation is still unknown. Nothing will be resent automatically.'):TradeRecoveryResult=>changed()??{status:'unknown',pending:readTradePending(storage),error}
  const finish=(status:'confirmed'|'failed',error?:string):TradeRecoveryResult=>{
    const replacement=changed();if(replacement)return replacement
    const receipt=saveTradeReceipt(readTradePending(storage)!,status,error,storage)
    return {status,pending:readTradePending(storage),receipt,error}
  }
  const first=await withTimeout(connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true}))
  const replacement=changed();if(replacement)return replacement
  const status=completeStatus(first.value[0])
  if(status)return finish(status,status==='failed'?`On-chain trade failed: ${JSON.stringify(first.value[0]?.err)}`:undefined)
  // Even a merely processed signature may have landed while its hash was valid.
  // Do not discard that evidence just because finality has advanced elsewhere.
  if(first.value[0])return unknown('The transaction has been observed but is not confirmed. Check again shortly.')
  if(record.expiryBlockHeight===undefined){
    // Older records did not retain a validity height. Establish a conservative
    // future boundary from a fresh node-issued hash instead of treating a hash
    // missing from the lagging finalized bank as already expired.
    const latest=await withTimeout(connection.getLatestBlockhash({commitment:'confirmed',minContextSlot:first.context.slot}))
    const switched=changed();if(switched)return switched
    const saved=saveTradeExpiryBoundary(record.signature,latest.lastValidBlockHeight,storage)
    if(saved?.signature!==record.signature)return {status:'changed',pending:saved}
    return unknown('A safe recovery boundary is now saved. Check again after the current blockhash validity window; nothing was resent.')
  }
  const [validity,finalizedHeight]=await Promise.all([
    withTimeout(connection.isBlockhashValid(record.blockhash,{commitment:'finalized'})),
    withTimeout(connection.getBlockHeight('finalized')),
  ])
  const switched=changed();if(switched)return switched
  if(validity.value||finalizedHeight<=record.expiryBlockHeight)return unknown('The saved transaction can still be valid. Wait for finalized expiry and check again.')
  // Recheck after the expiry evidence and consult finalized transaction history
  // so delayed signature indexing cannot turn a successful trade into a failure.
  const [last,transaction]=await Promise.all([
    withTimeout(connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})),
    withTimeout(connection.getTransaction(record.signature,{commitment:'finalized',maxSupportedTransactionVersion:0})),
  ])
  const changedAgain=changed();if(changedAgain)return changedAgain
  const observed=completeStatus(last.value[0])
  if(observed==='confirmed'||transaction?.meta?.err===null)return finish('confirmed')
  if(observed==='failed')return finish('failed',`On-chain trade failed: ${JSON.stringify(last.value[0]?.err)}`)
  if(transaction){
    if(transaction.meta?.err)return finish('failed',`Finalized trade failed: ${JSON.stringify(transaction.meta.err)}`)
    return unknown('Finalized transaction details are incomplete. Check again before trading.')
  }
  if(last.value[0])return unknown('The transaction has been observed but confirmation remains incomplete. Preserve its signature.')
  return finish('failed','The original blockhash expired on the finalized chain and the transaction was not found in history. Nothing was resent.')
}

/** Recovery and submission share one cross-tab lock; no stale record is passed in. */
export async function reconcilePendingTrade(connection:Connection,options:RecoveryOptions&{locks?:TradeRecoveryLocks}={}):Promise<TradeRecoveryResult>{
  const locks=options.locks??(typeof navigator!=='undefined'?navigator.locks:undefined) as TradeRecoveryLocks|undefined
  if(!locks)throw new Error('Use a current browser with secure cross-tab recovery coordination')
  return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
    if(!lock)return {status:'busy',pending:readTradePending(options.storage),error:'Another tab is signing or recovering a transaction. Try again when it finishes.'}
    return reconcileTradeRecord(connection,options)
  })
}
