import type {LaunchBundleSettings} from './types'
import {PublicKey} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'

export interface LaunchBundleTransfer {walletId:string;payer:string;recipient:string;mint:string;tokenProgram:string;rawAmount:string;decimals:number}
/** Select public intent fields and detach every nested object from execution. */
export function publicLaunchBundleTransfers(value:unknown):LaunchBundleTransfer[]{
 if(!Array.isArray(value)||value.length>3)throw new Error('The public token transfer intent is invalid.')
 const ids=new Set<string>()
 return value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('The public token transfer intent is invalid.')
  const input=item as LaunchBundleTransfer
  if(typeof input.walletId!=='string'||!input.walletId.trim()||input.walletId.length>100||ids.has(input.walletId))throw new Error('The token transfer buyer is invalid.')
  ids.add(input.walletId)
  for(const field of ['payer','recipient','mint','tokenProgram'] as const)if(typeof input[field]!=='string'||new PublicKey(input[field]).toBase58()!==input[field])throw new Error('The token transfer address is invalid.')
  if(!PublicKey.isOnCurve(new PublicKey(input.payer).toBytes())||!PublicKey.isOnCurve(new PublicKey(input.recipient).toBytes())||input.payer===input.recipient||![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(input.tokenProgram))throw new Error('The token transfer wallet or program is invalid.')
  if(typeof input.rawAmount!=='string'||!/^[1-9]\d{0,19}$/.test(input.rawAmount)||BigInt(input.rawAmount)>18_446_744_073_709_551_615n||!Number.isInteger(input.decimals)||input.decimals<0||input.decimals>255)throw new Error('The token transfer amount is invalid.')
  return {walletId:input.walletId,payer:input.payer,recipient:input.recipient,mint:input.mint,tokenProgram:input.tokenProgram,rawAmount:input.rawAmount,decimals:input.decimals}
 })
}

export interface LaunchBundleOutcome {
 mode:LaunchBundleSettings['mode']
 buyerCount:number
 status:'confirmed'|'partial'
 message?:string
 transfers?:LaunchBundleTransfer[]
}
/** A small public outcome survives recovery without persisting any execution context. */
export function publicLaunchBundleOutcome(value:unknown):LaunchBundleOutcome{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The bundle outcome cannot be read.')
 const input=value as LaunchBundleOutcome
 if(!['manual','organic','block0'].includes(input.mode)||!Number.isInteger(input.buyerCount)||input.buyerCount<0||input.buyerCount>16||!['confirmed','partial'].includes(input.status))throw new Error('The bundle outcome is invalid.')
 if(input.message!==undefined&&(typeof input.message!=='string'||input.message.length>2000||/[\u0000-\u001f\u007f]/.test(input.message)))throw new Error('The bundle outcome message is invalid.')
 const transfers=input.transfers===undefined?undefined:publicLaunchBundleTransfers(input.transfers)
 if(transfers?.length&&(input.mode!=='block0'||transfers.length>input.buyerCount))throw new Error('The token transfers differ from the bundle outcome.')
 return {mode:input.mode,buyerCount:input.buyerCount,status:input.status,...(input.message?{message:input.message}:{}),...(transfers?{transfers}:{})}
}
