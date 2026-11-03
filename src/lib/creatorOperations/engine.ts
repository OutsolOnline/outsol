import {AddressLookupTableAccount,Connection,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {assertSubmissionSigner,sendAndConfirmTransaction,signedTransactionSignature,type ConfirmationOptions,type TransactionReceipt} from '../transactions/send'
import {withTimeout} from '../transactions/http'
import {normalizeCreatorInput,creatorOperationScope,creatorStateBinding,type CreatorLocks,type CreatorOperationInput,type CreatorOperationIntent,type CreatorOperationPreview,type CreatorState,type CreatorStorage} from './model'
import {buildCreatorRecipe,compileCreatorRecipe,assertCreatorEligibility} from './native'
import {inspectCreatorState} from './inspect'
import {simulateCreatorOperation} from './simulation'
import {assertCreatorOperationAvailable} from './availability'
import {clearPendingCreatorOperation,savePendingCreatorOperation,saveCreatorOperationReceipt,type PendingCreatorOperation} from './history'

export interface PreparedCreatorOperation {intent:CreatorOperationIntent;state:CreatorState;preview:CreatorOperationPreview;transaction:VersionedTransaction;message:string;createdAt:number;lastValidBlockHeight:number}
export interface CreatorOperationGuards {readSigner:()=>string|null|undefined;signal?:AbortSignal;assertAvailable?:()=>void}
export interface CreatorOperationSigner extends CreatorOperationGuards {approved:boolean;signTransaction:(transaction:VersionedTransaction)=>Promise<VersionedTransaction>;onPending?:(record:PendingCreatorOperation)=>void}
export interface CreatorOperationPorts {
 readState:typeof inspectCreatorState;build:typeof buildCreatorRecipe;simulate:typeof simulateCreatorOperation;send:(connection:Connection,transaction:VersionedTransaction,options:ConfirmationOptions)=>Promise<TransactionReceipt>
 now:()=>number;storage?:CreatorStorage;locks?:CreatorLocks
}
interface Runtime {intent:CreatorOperationIntent;state:CreatorState;preview:CreatorOperationPreview;bytes:Uint8Array;message:string;createdAt:number;lastValidBlockHeight:number;lookup?:AddressLookupTableAccount;publicSnapshot:string;used:boolean}
const preparedOperations=new WeakMap<PreparedCreatorOperation,Runtime>()
const defaults:CreatorOperationPorts={readState:inspectCreatorState,build:buildCreatorRecipe,simulate:simulateCreatorOperation,send:sendAndConfirmTransaction,now:Date.now}
const message=(tx:VersionedTransaction)=>Buffer.from(tx.message.serialize()).toString('base64')
const text=(error:unknown)=>error instanceof Error?error.message:'The creator operation stopped.'
const publicSnapshot=(review:PreparedCreatorOperation)=>JSON.stringify({intent:review.intent,state:review.state,preview:review.preview,message:review.message,createdAt:review.createdAt,lastValidBlockHeight:review.lastValidBlockHeight})
function cloneLookup(lookup:AddressLookupTableAccount):AddressLookupTableAccount{return new AddressLookupTableAccount({key:lookup.key,state:{...lookup.state,addresses:[...lookup.state.addresses]}})}
function checkPreview(actual:CreatorOperationPreview,approved:CreatorOperationPreview):void{
 const unsigned=(value:string)=>typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value)
 if([actual.payerBeforeLamports,actual.payerAfterLamports,actual.maxDebitLamports,actual.networkFeeLamports,actual.existingWrappedSolLamports,actual.lookupRentLamports].some(value=>!unsigned(value)))throw new Error('The signed creator simulation returned incomplete amounts.')
 if(BigInt(actual.maxDebitLamports)>BigInt(approved.maxDebitLamports)||BigInt(actual.networkFeeLamports)>BigInt(approved.networkFeeLamports)||BigInt(actual.payerAfterLamports)-BigInt(actual.payerBeforeLamports)<BigInt(approved.payerAfterLamports)-BigInt(approved.payerBeforeLamports)||actual.existingWrappedSolLamports!==approved.existingWrappedSolLamports||actual.lookupRentLamports!==approved.lookupRentLamports)throw new Error('The signed operation exceeds the reviewed costs or reduces the reviewed proceeds. Prepare again.')
 if(actual.recipientChanges.length!==approved.recipientChanges.length||approved.recipientChanges.some(row=>{const current=actual.recipientChanges.find(item=>item.address===row.address);return!current||!/^[-]?\d{1,21}$/.test(current.changeLamports)||BigInt(current.changeLamports)<BigInt(row.changeLamports)}))throw new Error('A reviewed recipient would receive less than the preview. Prepare again.')
}
/** Public preparation never accepts keys, signs, or submits. The canonical native packet stays in a WeakMap. */
export async function prepareCreatorOperation(connection:Connection,value:unknown,guards:CreatorOperationGuards,overrides:Partial<CreatorOperationPorts>={}):Promise<PreparedCreatorOperation>{
 const input=normalizeCreatorInput(value),ports={...defaults,...overrides},check=()=>{assertSubmissionSigner(input.payer,guards.readSigner,guards.signal);assertCreatorOperationAvailable(ports.storage);guards.assertAvailable?.()}
 check();const state=await ports.readState(connection,input.mint,check);check();assertCreatorEligibility(input,state)
 const binding=creatorStateBinding(state),now=ports.now()
 if(!Number.isSafeInteger(state.checkedAt)||state.checkedAt>now||now-state.checkedAt>60000)throw new Error('The creator snapshot is stale. Refresh before preparing.')
 const latest=await withTimeout(connection.getLatestBlockhash('confirmed'));check()
 if(!Number.isSafeInteger(latest.lastValidBlockHeight)||latest.lastValidBlockHeight<1)throw new Error('The transaction validity boundary is unavailable.')
 const slot=input.kind==='lookup'?await withTimeout(connection.getSlot('finalized')):undefined;check()
 const recipe=await ports.build(connection,structuredClone(input),structuredClone(state),slot);check()
 const refreshed=await ports.readState(connection,input.mint,check);check()
 if(creatorStateBinding(refreshed)!==binding)throw new Error('The creator or fee sharing configuration changed while preparing. Review again.')
 let lookup:AddressLookupTableAccount|undefined
 if(input.lookupTable){
  const response=await withTimeout(connection.getAddressLookupTable(new PublicKey(input.lookupTable),{commitment:'confirmed'}));check()
  if(!response.value||response.value.state.deactivationSlot!==18446744073709551615n)throw new Error('This account lookup table is missing or deactivated.')
  const currentSlot=await withTimeout(connection.getSlot('confirmed'));check()
  if(!Number.isSafeInteger(currentSlot)||currentSlot<=response.value.state.lastExtendedSlot)throw new Error('The lookup table is still activating. Wait for the next confirmed slot, then prepare again.')
  lookup=cloneLookup(response.value)
 }
 const transaction=compileCreatorRecipe(input,recipe,latest.blockhash,lookup),bytes=new Uint8Array(transaction.serialize()),expected=message(transaction)
 const intent:CreatorOperationIntent={version:1,input,scope:creatorOperationScope(input),...(recipe.lookupAddress?{lookupAddress:recipe.lookupAddress,lookupRecentSlot:recipe.lookupRecentSlot}:{})}
 const simulationCopy=VersionedTransaction.deserialize(bytes),preview=await ports.simulate(connection,simulationCopy,structuredClone(intent),structuredClone(state),lookup?cloneLookup(lookup):undefined,false,check);check()
 if(message(simulationCopy)!==expected||!Buffer.from(simulationCopy.serialize()).equals(Buffer.from(bytes)))throw new Error('The native simulation changed its reviewed transaction.')
 checkPreview(preview,preview)
 const createdAt=ports.now(),review:PreparedCreatorOperation={intent:structuredClone(intent),state:structuredClone(state),preview:structuredClone(preview),transaction:VersionedTransaction.deserialize(bytes),message:expected,createdAt,lastValidBlockHeight:latest.lastValidBlockHeight}
 preparedOperations.set(review,{intent:structuredClone(intent),state:structuredClone(state),preview:structuredClone(preview),bytes,message:expected,createdAt,lastValidBlockHeight:latest.lastValidBlockHeight,lookup,publicSnapshot:publicSnapshot(review),used:false})
 return review
}
export async function submitCreatorOperation(connection:Connection,review:PreparedCreatorOperation,signer:CreatorOperationSigner,overrides:Partial<CreatorOperationPorts>={}):Promise<TransactionReceipt>{
 const state=preparedOperations.get(review),ports={...defaults,...overrides}
 if(!state||state.used||publicSnapshot(review)!==state.publicSnapshot||message(review.transaction)!==state.message||!Buffer.from(review.transaction.serialize()).equals(Buffer.from(state.bytes)))throw new Error('This creator review changed or was already used. Prepare a fresh review.')
 if(signer.approved!==true)throw new Error('Review and approve this creator operation before signing.')
 const locks=ports.locks??(typeof navigator!=='undefined'?navigator.locks as CreatorLocks:undefined)
 if(!locks)throw new Error('Use a current browser with secure cross-tab transaction coordination.')
 state.used=true
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('Another tab is signing or checking a transaction. Finish it there first.')
  let pending:PendingCreatorOperation|undefined,broadcast=false
  const guard=(own=false)=>{assertSubmissionSigner(state.intent.input.payer,signer.readSigner,signer.signal);assertCreatorOperationAvailable(ports.storage,own?pending:undefined);signer.assertAvailable?.()}
  const fresh=()=>{if(ports.now()<state.createdAt||ports.now()-state.createdAt>60000)throw new Error('This creator preview expired. Prepare a fresh review.')}
  guard();fresh()
  const current=await ports.readState(connection,state.intent.input.mint,()=>guard());guard()
  if(creatorStateBinding(current)!==creatorStateBinding(state.state))throw new Error('The creator or fee sharing authority changed. Prepare a fresh review.')
  if(!(await withTimeout(connection.isBlockhashValid(VersionedTransaction.deserialize(state.bytes).message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('This creator transaction expired. Prepare again.')
  guard();fresh()
  const returned=await signer.signTransaction(VersionedTransaction.deserialize(state.bytes));guard();fresh()
  const raw=returned.serialize(),signed=VersionedTransaction.deserialize(raw)
  if(message(signed)!==state.message||!Buffer.from(signed.serialize()).equals(Buffer.from(raw)))throw new Error('The wallet changed the reviewed creator transaction. Nothing was submitted.')
  const signature=signedTransactionSignature(signed),signedBytes=Buffer.from(signed.serialize()),stable=(packet:VersionedTransaction)=>{if(message(packet)!==state.message||!Buffer.from(packet.serialize()).equals(signedBytes))throw new Error('The signed creator packet changed. Nothing further was sent.')}
  const simulationCopy=VersionedTransaction.deserialize(signedBytes),actual=await ports.simulate(connection,simulationCopy,structuredClone(state.intent),structuredClone(state.state),state.lookup?cloneLookup(state.lookup):undefined,true,()=>guard());guard();stable(signed);stable(simulationCopy);checkPreview(actual,state.preview)
  if(!(await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('This creator transaction expired during signing. Prepare again.')
  guard();fresh();stable(signed)
  pending={version:1,intent:structuredClone(state.intent),signature,blockhash:signed.message.recentBlockhash,lastValidBlockHeight:state.lastValidBlockHeight,submittedAt:new Date(ports.now()).toISOString()}
  const packet=VersionedTransaction.deserialize(signedBytes)
  try{
   const receipt=await ports.send(connection,packet,{signal:signer.signal,onBroadcast:()=>{
    guard();fresh();stable(signed);stable(packet);savePendingCreatorOperation(pending!,ports.storage)
    try{guard(true);fresh();signer.onPending?.(structuredClone(pending!));guard(true);fresh();stable(signed);stable(packet)}catch(error){clearPendingCreatorOperation(pending!,ports.storage);throw error}
    broadcast=true
   }})
   stable(signed);stable(packet)
   if(receipt.signature!==signature||!['confirmed','failed','unknown'].includes(receipt.status))throw new Error('The submission response differs from the saved original. Check its signature.')
   if(receipt.submitted===false){clearPendingCreatorOperation(pending,ports.storage);return{...receipt,signature}}
   if(!broadcast)throw new Error('The creator submission did not preserve its original signature before sending.')
   if(receipt.status==='confirmed'||receipt.status==='failed')saveCreatorOperationReceipt(pending,receipt.status,receipt.error,ports.storage)
   return{...receipt,signature}
  }catch(error){
   if(broadcast)return{status:'unknown',signature,submitted:true,error:`Confirmation is unknown. Check the saved original signature; nothing will be resent. ${text(error)}`}
   clearPendingCreatorOperation(pending,ports.storage);throw error
  }
 })
}
