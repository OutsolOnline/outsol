import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {assertSubmissionSigner,sendAndConfirmTransaction,signedTransactionSignature,type ConfirmationOptions,type TransactionReceipt} from '../transactions/send'
import {withTimeout} from '../transactions/http'
import {normalizeSupplyLockInput,parseSupplyLockIntent,lockAddresses,supplyLockFees,type SupplyLockIntent,type SupplyLockLocks,type SupplyLockPosition,type SupplyLockPreview,type SupplyLockStorage} from './model'
import {readSupplyLockPosition,supplyPositionBinding} from './position'
import {buildSupplyLockTransaction,assertSupplyLockTransaction} from './native'
import {simulateSupplyLock} from './simulation'
import {assertSupplyLockAvailable} from './availability'
import {clearPendingSupplyLock,savePendingSupplyLock,saveSupplyLockReceipt,type PendingSupplyLock} from './history'

export interface SupplyLockGuards {readSigner:()=>string|null|undefined;signal?:AbortSignal;assertAvailable?:()=>void}
export interface SupplyLockSigner extends SupplyLockGuards {approved:boolean;signTransaction:(transaction:VersionedTransaction)=>Promise<VersionedTransaction>;onPending?:(record:PendingSupplyLock)=>void}
export interface SupplyLockPorts {readPosition:typeof readSupplyLockPosition;build:typeof buildSupplyLockTransaction;simulate:typeof simulateSupplyLock;send:(connection:Connection,tx:VersionedTransaction,options:ConfirmationOptions)=>Promise<TransactionReceipt>;now:()=>number;nonce:()=>number;storage?:SupplyLockStorage;locks?:SupplyLockLocks}
export interface PreparedSupplyLock {intent:SupplyLockIntent;position:SupplyLockPosition;preview:SupplyLockPreview;transaction:VersionedTransaction;message:string;createdAt:number;lastValidBlockHeight:number}
interface Canonical {intent:SupplyLockIntent;position:SupplyLockPosition;preview:SupplyLockPreview;bytes:Uint8Array;message:string;createdAt:number;lastValidBlockHeight:number;snapshot:string;used:boolean}
const runtime=new WeakMap<PreparedSupplyLock,Canonical>(),defaults:SupplyLockPorts={readPosition:readSupplyLockPosition,build:buildSupplyLockTransaction,simulate:simulateSupplyLock,send:sendAndConfirmTransaction,now:Date.now,nonce:()=>{const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return bytes[0]}}
const snapshot=(review:PreparedSupplyLock)=>JSON.stringify({intent:review.intent,position:review.position,preview:review.preview,message:review.message,createdAt:review.createdAt,lastValidBlockHeight:review.lastValidBlockHeight})
const message=(tx:VersionedTransaction)=>Buffer.from(tx.message.serialize()).toString('base64')
function costs(actual:SupplyLockPreview,expected:SupplyLockPreview):void{
 for(const value of Object.values(actual))if(typeof value!=='string'||!/^(0|[1-9]\d{0,19})$/.test(value))throw new Error('The supply lock simulation returned an invalid exact amount.')
 if(BigInt(actual.maxDebitLamports)>BigInt(expected.maxDebitLamports)||BigInt(actual.networkFeeLamports)>BigInt(expected.networkFeeLamports)||actual.creationFeeLamports!==expected.creationFeeLamports||actual.lockedRaw!==expected.lockedRaw||actual.tokenFeeRaw!==expected.tokenFeeRaw||BigInt(actual.sourceBeforeRaw)-BigInt(actual.sourceAfterRaw)!==BigInt(expected.sourceBeforeRaw)-BigInt(expected.sourceAfterRaw))throw new Error('The signed lock exceeds the reviewed SOL costs or changes the exact token debit.')
}
export async function prepareSupplyLock(connection:Connection,value:unknown,guards:SupplyLockGuards,overrides:Partial<SupplyLockPorts>={}):Promise<PreparedSupplyLock>{
 const input=normalizeSupplyLockInput(value),ports={...defaults,...overrides},guard=()=>{assertSubmissionSigner(input.payer,guards.readSigner,guards.signal);assertSupplyLockAvailable(ports.storage);guards.assertAvailable?.()}
 guard();const position=await ports.readPosition(connection,input.mint,input.payer,guard);guard()
 if(input.unlockAt<position.chainTime+300||input.unlockAt>position.chainTime+10*366*86400)throw new Error('Choose an unlock between five minutes and ten years after confirmed chain time.')
 const fees=supplyLockFees(input.amountRaw,position.feeUnits)
 if(BigInt(fees.sourceDebitRaw)>BigInt(position.balanceRaw))throw new Error('The wallet needs the lock amount plus the disclosed Streamflow token fee.')
 const nonce=ports.nonce(),intent:SupplyLockIntent=parseSupplyLockIntent({...input,tokenProgram:position.tokenProgram,decimals:position.decimals,nonce,...lockAddresses(input,nonce),feeUnits:position.feeUnits,creationFeeLamports:position.creationFeeLamports,...fees,maxDebitLamports:'0'})
 const latest=await withTimeout(connection.getLatestBlockhash('confirmed'));guard()
 if(!Number.isSafeInteger(latest.lastValidBlockHeight)||latest.lastValidBlockHeight<1)throw new Error('The lock transaction validity boundary is unavailable.')
 if(await withTimeout(connection.getAccountInfo(new PublicKey(intent.metadata),'confirmed')))throw new Error('This lock identity already exists. Prepare again.')
 guard();const transaction=await ports.build(connection,intent,latest.blockhash);guard();await assertSupplyLockTransaction(transaction,intent);guard()
 const bytes=new Uint8Array(transaction.serialize()),expected=message(transaction),copy=VersionedTransaction.deserialize(bytes),preview=await ports.simulate(connection,copy,intent,false,guard);guard();costs(preview,preview)
 if(!Buffer.from(copy.serialize()).equals(Buffer.from(bytes)))throw new Error('The lock simulation changed the exact unsigned message.')
 intent.maxDebitLamports=preview.maxDebitLamports
 const createdAt=ports.now(),review:PreparedSupplyLock={intent:structuredClone(intent),position:structuredClone(position),preview:structuredClone(preview),transaction:VersionedTransaction.deserialize(bytes),message:expected,createdAt,lastValidBlockHeight:latest.lastValidBlockHeight}
 runtime.set(review,{intent:structuredClone(intent),position:structuredClone(position),preview:structuredClone(preview),bytes,message:expected,createdAt,lastValidBlockHeight:latest.lastValidBlockHeight,snapshot:snapshot(review),used:false});return review
}
export async function submitSupplyLock(connection:Connection,review:PreparedSupplyLock,signer:SupplyLockSigner,overrides:Partial<SupplyLockPorts>={}):Promise<TransactionReceipt>{
 const state=runtime.get(review),ports={...defaults,...overrides}
 if(!state||state.used||snapshot(review)!==state.snapshot||message(review.transaction)!==state.message||!Buffer.from(review.transaction.serialize()).equals(Buffer.from(state.bytes)))throw new Error('This lock review changed or was used. Prepare a fresh lock review.')
 if(signer.approved!==true)throw new Error('Review the immutable lock, recipient and costs before signing.')
 const locks=ports.locks??(typeof navigator!=='undefined'?navigator.locks as SupplyLockLocks:undefined);if(!locks)throw new Error('Use a current browser with secure cross-tab coordination.')
 state.used=true
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('Another tab is signing or checking a transaction.')
  let pending:PendingSupplyLock|undefined,broadcast=false
  const guard=(own=false)=>{assertSubmissionSigner(state.intent.payer,signer.readSigner,signer.signal);assertSupplyLockAvailable(ports.storage,own?pending:undefined);signer.assertAvailable?.()}
  const fresh=()=>{if(ports.now()<state.createdAt||ports.now()-state.createdAt>60000)throw new Error('The lock review expired. Prepare a new preview.')}
  guard();fresh();const current=await ports.readPosition(connection,state.intent.mint,state.intent.payer,()=>guard());guard()
  if(supplyPositionBinding(current)!==supplyPositionBinding(state.position)||current.chainTime>state.intent.unlockAt-60)throw new Error('The token, live fees or lock timing changed. Prepare again.')
  if(!(await withTimeout(connection.isBlockhashValid(VersionedTransaction.deserialize(state.bytes).message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('The reviewed lock transaction expired.')
  guard();fresh();const returned=await signer.signTransaction(VersionedTransaction.deserialize(state.bytes));guard();fresh()
  const signedBytes=returned.serialize(),signed=VersionedTransaction.deserialize(signedBytes)
  if(message(signed)!==state.message||!Buffer.from(signed.serialize()).equals(Buffer.from(signedBytes)))throw new Error('The wallet changed the exact immutable lock message.')
  await assertSupplyLockTransaction(signed,state.intent);guard();const signature=signedTransactionSignature(signed),canonical=Buffer.from(signed.serialize()),stable=(tx:VersionedTransaction)=>{if(message(tx)!==state.message||!Buffer.from(tx.serialize()).equals(canonical))throw new Error('The signed lock bytes changed. Nothing further was sent.')}
  const simulation=VersionedTransaction.deserialize(canonical),actual=await ports.simulate(connection,simulation,structuredClone(state.intent),true,()=>guard());guard();stable(signed);stable(simulation);costs(actual,state.preview)
  if(!(await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('The lock transaction expired while signing.')
  guard();fresh();pending={version:1,intent:structuredClone(state.intent),signature,blockhash:signed.message.recentBlockhash,lastValidBlockHeight:state.lastValidBlockHeight,submittedAt:new Date(ports.now()).toISOString()}
  const packet=VersionedTransaction.deserialize(canonical)
  try{
   const receipt=await ports.send(connection,packet,{signal:signer.signal,onBroadcast:()=>{
    guard();fresh();stable(packet);stable(signed);savePendingSupplyLock(pending!,ports.storage)
    try{guard(true);fresh();signer.onPending?.(structuredClone(pending!));guard(true);fresh();stable(packet)}catch(error){clearPendingSupplyLock(pending!,ports.storage);throw error}
    broadcast=true
   }})
   stable(packet);stable(signed)
   if(receipt.signature!==signature||!['confirmed','failed','unknown'].includes(receipt.status))throw new Error('The response differs from the saved original lock signature.')
   if(receipt.submitted===false){clearPendingSupplyLock(pending,ports.storage);return receipt}
   if(!broadcast)throw new Error('The original lock was not durably saved before submission.')
   if(receipt.status!=='unknown')saveSupplyLockReceipt(pending,receipt.status,receipt.error,ports.storage)
   return receipt
  }catch(error){if(broadcast)return{status:'unknown',signature,submitted:true,error:`Lock confirmation is unknown. Check the original signature; nothing will be resent. ${error instanceof Error?error.message:'Response unavailable.'}`};clearPendingSupplyLock(pending,ports.storage);throw error}
 })
}
