import {AddressLookupTableProgram,ComputeBudgetProgram,Connection,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,type AddressLookupTableAccount} from '@solana/web3.js'
import {ASSOCIATED_TOKEN_PROGRAM_ID,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {OnlinePumpSdk,PUMP_SDK,PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,feeSharingConfigPda} from '@pump-fun/pump-sdk'
import {creatorAddress,parseCreatorShares,type CreatorOperationInput,type CreatorState} from './model'

export interface CreatorRecipe {instructions:TransactionInstruction[];lookupAddress?:string;lookupRecentSlot?:number}
export class CreatorLookupRequired extends Error {
 readonly addresses:string[]
 constructor(addresses:string[]){super('This operation needs an account lookup table to fit safely. Review its setup cost, then prepare the operation again.');this.name='CreatorLookupRequired';this.addresses=[...addresses]}
}
export function assertCreatorEligibility(input:CreatorOperationInput,state:CreatorState):void{
 if(input.mint!==state.mint)throw new Error('The creator snapshot belongs to another token.')
 if(input.kind==='lookup')return
 if(state.holderReward)throw new Error('Holder rewards require Pump’s distribution authority. Claim or inspect them in Pump.fun.')
 if(input.kind==='collect'){
  if(state.creator!==input.payer)throw new Error('Select the current creator wallet. Social escrow and sharing accounts cannot sign a wallet claim; inspect a different pool creator in Pump.fun.')
  if(BigInt(state.vaultBalanceLamports)===0n&&BigInt(state.curveFeeLamports)===0n&&BigInt(state.pool?.feeLamports??'0')===0n)throw new Error('No creator fees were observed in this snapshot. Refresh after more trading.')
  return
 }
 if(input.kind==='distribute'){
  if(!state.sharing)throw new Error('This token has no supported fee sharing configuration.')
  if(state.pool&&state.pool.creator!==state.sharing.address)throw new Error('The pool creator differs from this fee sharing route. Inspect it in Pump.fun.')
  return
 }
 parseCreatorShares(input.shares)
 if(state.sharing){
  if(state.sharing.version!==2||state.sharing.adminRevoked)throw new Error('This fee distribution is immutable. Its authority cannot be restored here.')
  if(state.sharing.admin!==input.payer)throw new Error('Choose the current fee sharing administrator wallet.')
 }else if(state.creator!==input.payer||(state.pool&&state.pool.creator!==input.payer))throw new Error('Choose the current creator wallet for both curve and pool before setting up sharing.')
}
/** Only official SDK instructions are accepted; no route or instruction payload comes from storage. */
export async function buildCreatorRecipe(connection:Connection,input:CreatorOperationInput,state:CreatorState,lookupSlot?:number):Promise<CreatorRecipe>{
 assertCreatorEligibility(input,state)
 const payer=new PublicKey(input.payer),mint=new PublicKey(input.mint)
 if(input.kind==='lookup'){
  if(!Number.isSafeInteger(lookupSlot)||lookupSlot!<1)throw new Error('A finalized lookup setup slot is required.')
  const [create,address]=AddressLookupTableProgram.createLookupTable({authority:payer,payer,recentSlot:lookupSlot!})
  return{instructions:[create,AddressLookupTableProgram.extendLookupTable({lookupTable:address,authority:payer,payer,addresses:input.addresses.map(value=>new PublicKey(value))})],lookupAddress:address.toBase58(),lookupRecentSlot:lookupSlot}
 }
 const sweeps:TransactionInstruction[]=[],quote={payer,mint,quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID}
 if(BigInt(state.curveFeeLamports)>0n&&(input.kind!=='collect'||state.creator===input.payer))sweeps.push(await PUMP_SDK.sweepCreatorFeeInstruction({...quote,creator:new PublicKey(state.creator)}))
 if(state.pool&&BigInt(state.pool.feeLamports)>0n&&(input.kind!=='collect'||state.pool.creator===input.payer))sweeps.push(await PUMP_SDK.sweepPoolCreatorFeeInstruction({...quote,coinCreator:new PublicKey(state.pool.creator)}))
 if(input.kind==='collect')return{instructions:[...sweeps,...await new OnlinePumpSdk(connection).collectCoinCreatorFeeInstructions(payer,payer)]}
 if(input.kind==='distribute')return{instructions:(await new OnlinePumpSdk(connection).buildDistributeCreatorFeesInstructions(mint,{payer,quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID})).instructions}
 const sharing=state.sharing,setup=sharing?[]:[await PUMP_SDK.createFeeSharingConfig({creator:payer,mint,pool:state.pool?new PublicKey(state.pool.address):null})]
 const update=await PUMP_SDK.updateFeeSharesV2({authority:payer,mint,currentShareholders:sharing?sharing.shareholders.map(row=>new PublicKey(row.address)):[payer],newShareholders:input.shares.map(row=>({address:new PublicKey(row.address),shareBps:row.shareBps})),quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,bondingCurveComplete:state.complete})
 return{instructions:[...sweeps,...setup,update]}
}
export function compileCreatorRecipe(input:CreatorOperationInput,recipe:CreatorRecipe,blockhash:string,lookup?:AddressLookupTableAccount):VersionedTransaction{
 const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:1000000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:BigInt(input.priorityFeeLamports)}),...recipe.instructions]
 const allowed=new Set([PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,AddressLookupTableProgram.programId].map(key=>key.toBase58()))
 if(recipe.instructions.length<1||recipe.instructions.some(ix=>!allowed.has(ix.programId.toBase58())||ix.keys.some(key=>key.isSigner&&key.pubkey.toBase58()!==input.payer)))throw new Error('The native creator recipe contains an unexpected program or signer.')
 const message=new TransactionMessage({payerKey:new PublicKey(input.payer),recentBlockhash:creatorAddress(blockhash),instructions}).compileToV0Message(lookup?[lookup]:[]),transaction=new VersionedTransaction(message)
 if(message.header.numRequiredSignatures!==1)throw new Error('Only the reviewed creator-operation wallet may sign.')
 let fits=false;try{fits=transaction.serialize().length<=1232}catch{/* Require compact account indices before any signing. */}
 if(!fits){
  if(input.kind==='lookup'||lookup)throw new Error('This operation still exceeds the packet limit. Preserve the review and inspect the route in Pump.fun.')
  const keys=[...new Map(recipe.instructions.flatMap(ix=>ix.keys).filter(key=>!key.isSigner&&key.pubkey.toBase58()!==input.payer).map(key=>[key.pubkey.toBase58(),key.pubkey.toBase58()])).values()].slice(0,20)
  throw new CreatorLookupRequired(keys)
 }
 return transaction
}
export const creatorSharingAddress=(mint:string)=>feeSharingConfigPda(new PublicKey(mint)).toBase58()
