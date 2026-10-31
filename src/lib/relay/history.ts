import {Connection} from '@solana/web3.js'
import bs58 from 'bs58'
import {withTimeout} from '@/lib/transactions/http'
import {readPendingWalletOperation,saveWalletOperationReceipt,type WalletOperationStorage} from '@/lib/walletOperations/history'
import type {WalletOperationLocks} from '@/lib/walletOperations/recovery'
import {normalizedRelayInput} from './prepare'
import {RELAY_MAINNET_GENESIS,relayAddress,relayRaw} from './scan'
import type {RelayReceipt} from './types'

export const RELAY_RECEIPTS_KEY='outsol-relay-receipts-v1'
function target(storage?:WalletOperationStorage){if(storage)return storage;if(typeof localStorage==='undefined')throw new Error('Relay recovery storage is unavailable.');return localStorage}
function receipt(value:RelayReceipt):RelayReceipt{
 const input=normalizedRelayInput(value)
 if(typeof value.signature!=='string'||value.signature.length>88||bs58.decode(value.signature).length!==64||!bs58.decode(value.signature).some(Boolean)||!Number.isSafeInteger(value.lastValidBlockHeight)||value.lastValidBlockHeight<1||value.genesisHash!==RELAY_MAINNET_GENESIS||!['submitted','confirmed','failed','unknown'].includes(value.status)||typeof value.createdAt!=='string'||value.createdAt.length>40||!Number.isFinite(Date.parse(value.createdAt)))throw new Error('Invalid Relay recovery receipt.')
 const result:RelayReceipt={...input,signature:value.signature,blockhash:relayAddress(value.blockhash),lastValidBlockHeight:value.lastValidBlockHeight,genesisHash:value.genesisHash,createdAt:new Date(value.createdAt).toISOString(),status:value.status,debitLamports:relayRaw(value.debitLamports,true).toString()}
 if(value.resolvedAt!==undefined){if(typeof value.resolvedAt!=='string'||!Number.isFinite(Date.parse(value.resolvedAt)))throw new Error('Invalid Relay recovery timestamp.');result.resolvedAt=new Date(value.resolvedAt).toISOString()}
 if(value.error!==undefined)result.error=value.status==='failed'?'The transfer did not complete. Inspect its transaction receipt before retrying.':'The transfer needs confirmation. Preserve its original signature and reconcile before sending again.'
 return result
}
export function readRelayReceipts(storage?:WalletOperationStorage):RelayReceipt[]{
 try{const raw=target(storage).getItem(RELAY_RECEIPTS_KEY);if(raw===null)return[];if(raw.length>400000)throw new Error();const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>200)throw new Error();const rows=values.map(receipt);if(new Set(rows.map(value=>value.signature)).size!==rows.length)throw new Error();return rows}catch{throw new Error('Relay recovery storage cannot be read. Preserve browser data and check original signatures before sending.')}
}
export function assertNoPendingRelayTransfer(storage?:WalletOperationStorage,allowedSignature?:string){if(readRelayReceipts(storage).some(value=>['submitted','unknown'].includes(value.status)&&value.signature!==allowedSignature))throw new Error('A Relay transfer is pending confirmation. Check its original signature before continuing.')}
export function saveRelayReceipt(value:RelayReceipt,storage?:WalletOperationStorage):RelayReceipt{
 const clean=receipt(value),rows=readRelayReceipts(storage),previous=rows.find(row=>row.signature===clean.signature)
 if(previous){
  const fields=['source','destination','mint','sourceAccount','tokenProgram','amountRaw','decimals','priorityFeeLamports','signature','blockhash','lastValidBlockHeight','genesisHash','createdAt','debitLamports'] as const
  if(fields.some(key=>previous[key]!==clean[key])||(['confirmed','failed'].includes(previous.status)&&previous.status!==clean.status))throw new Error('The original Relay receipt identity or resolved status cannot be changed.')
 }else{assertNoPendingRelayTransfer(storage);if(rows.length>=200)throw new Error('Relay receipt history is full. Preserve its backup before continuing.')}
 const next=[clean,...rows.filter(row=>row.signature!==clean.signature)]
 target(storage).setItem(RELAY_RECEIPTS_KEY,JSON.stringify(next))
 if(JSON.stringify(readRelayReceipts(storage)[0])!==JSON.stringify(clean))throw new Error('The Relay receipt could not be saved. Nothing may be submitted without recovery storage.')
 return clean
}
export function mirrorResolvedRelayReceipt(value:RelayReceipt,storage?:WalletOperationStorage){
 const pending=readPendingWalletOperation(storage)
 if(pending?.signature===value.signature&&(value.status==='confirmed'||value.status==='failed'))saveWalletOperationReceipt(pending,value.status,value.error,storage)
}
/** No signature is rebuilt and no absent-history result is treated as proof of nonexecution. */
export async function reconcileRelayReceipt(connection:Connection,value:RelayReceipt,storage?:WalletOperationStorage):Promise<RelayReceipt>{
 const original=receipt(value),current=()=>readRelayReceipts(storage).find(row=>row.signature===original.signature)
 const same=()=>{const next=current();if(!next||JSON.stringify({...next,status:original.status,error:original.error,resolvedAt:original.resolvedAt})!==JSON.stringify({...original,status:original.status,error:original.error,resolvedAt:original.resolvedAt}))throw new Error('The Relay recovery record changed. Reload its current state.');return next}
 if(!['submitted','unknown'].includes(original.status))return original
 if(await withTimeout(connection.getGenesisHash())!==original.genesisHash)throw new Error('The Relay receipt belongs to another network.')
 const statuses=await withTimeout(connection.getSignatureStatuses([original.signature],{searchTransactionHistory:true}));same()
 const status=statuses.value[0]
 let next:RelayReceipt
 if(status?.confirmationStatus==='finalized')next={...original,status:status.err?'failed':'confirmed',resolvedAt:new Date().toISOString(),...(status.err?{error:'The transaction failed on the finalized chain.'}:{error:undefined})}
 else{
  // The archival lookup is evidence only; expiry plus absent history never unlocks this account.
  const transaction=await withTimeout(connection.getTransaction(original.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}));same()
  if(transaction?.meta)next={...original,status:transaction.meta.err?'failed':'confirmed',resolvedAt:new Date().toISOString(),...(transaction.meta.err?{error:'The transaction failed on the finalized chain.'}:{error:undefined})}
  else next={...original,status:'unknown',error:'Finalized confirmation is not available. The transfer may have landed; nothing will be resent.'}
 }
 const saved=saveRelayReceipt(next,storage);mirrorResolvedRelayReceipt(saved,storage);return saved
}
export async function reconcileRelayTransfers(connection:Connection,options:{storage?:WalletOperationStorage;locks?:WalletOperationLocks}={}):Promise<RelayReceipt[]>{
 const locks=(options.locks??(typeof navigator!=='undefined'?navigator.locks:undefined)) as WalletOperationLocks|undefined
 if(!locks)throw new Error('Use a current browser with secure cross-tab transaction coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Another tab is signing or checking a transaction.');const rows=readRelayReceipts(options.storage);for(const row of rows)if(['submitted','unknown'].includes(row.status))await reconcileRelayReceipt(connection,row,options.storage);return readRelayReceipts(options.storage)})
}
