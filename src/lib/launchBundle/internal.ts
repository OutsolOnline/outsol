import {PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {JITO_TIP_ACCOUNTS} from '@/lib/bundler/jito'
import {assertSubmissionSigner} from '@/lib/transactions/send'
import {validatePumpTransaction} from '@/lib/transactions/validatePumpTransaction'
import {validatePumpLaunchPlan,type NativePumpLaunchPlan} from '@/lib/transactions/validatePumpLaunchPlan'
import {parseResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import BN from 'bn.js'
import type {LaunchBundleGuards,LaunchBundleInput,PreparedLaunchBundle,RuntimeLaunchBundle} from './model'
import {validateComposedNativeBuy} from './transfers'

export const runtimeBundles=new WeakMap<PreparedLaunchBundle,RuntimeLaunchBundle>()
export const clonePackets=(packets:readonly VersionedTransaction[])=>packets.map(tx=>{let bytes:Uint8Array;try{bytes=tx.serialize();if(bytes.length>1232)throw new Error()}catch{throw new Error('A reviewed launch packet exceeds the Solana 1,232-byte packet size limit. Prepare again.')}return VersionedTransaction.deserialize(bytes)})
export const packetMessage=(tx:VersionedTransaction)=>Buffer.from(tx.message.serialize()).toString('base64')
export function cloneCreatorPlan(plan:NativePumpLaunchPlan):NativePumpLaunchPlan{return {version:plan.version,routing:parseResolvedCreatorFeeRouting(plan.routing),metadata:{...plan.metadata},maxBuyLamports:plan.maxBuyLamports,firstBuyTokenAmountRaw:plan.firstBuyTokenAmountRaw,maxPriorityFeeLamports:plan.maxPriorityFeeLamports,jitoTipLamports:plan.jitoTipLamports,requiresAtomicBundle:plan.requiresAtomicBundle,separateJitoTip:plan.separateJitoTip,protocolFeeRecipients:[...plan.protocolFeeRecipients],packets:clonePackets(plan.packets),stepsByPacket:plan.stepsByPacket.map(steps=>[...steps])}}
/** Protocol quotes contain BN/PublicKey values; retain their behavior while
 * severing builder-port references before any later asynchronous operation. */
export function cloneProtocolState<T>(value:T):T{
 if(BN.isBN(value))return value.clone() as T
 if(value instanceof PublicKey)return new PublicKey(value.toBytes()) as T
 if(Array.isArray(value))return value.map(cloneProtocolState) as T
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cloneProtocolState(item)])) as T
 return value
}
export function checkLaunchSigners(input:LaunchBundleInput,guards:LaunchBundleGuards):void{
 assertSubmissionSigner(input.payer,guards.readSigner,guards.signal)
 for(const wallet of input.settings.wallets.filter(wallet=>wallet.buySol>0)){
  const key=guards.readBuyer(wallet.walletId)
  if(!key||key.publicKey.toBase58()!==wallet.publicKey)throw new Error(`Buyer ${wallet.name||wallet.walletId} was locked or changed. Prepare again.`)
 }
}
export function validateInitialPackets(state:RuntimeLaunchBundle,packets:readonly VersionedTransaction[]):void{
 if(packets.length!==state.policies.length||packets.length<1||packets.length>5)throw new Error('The reviewed launch packet count changed.')
 const creatorPackets=packets.slice(0,state.creatorPacketCount)
 const completeCreatorPackets=state.creatorPlan.requiresAtomicBundle?[...creatorPackets,state.creatorPlan.packets.at(-1)!]:creatorPackets
 validatePumpLaunchPlan({...state.creatorPlan,packets:completeCreatorPackets})
 packets.forEach((tx,index)=>{
  if(tx.serialize().length>1232||tx.message.addressTableLookups.length||tx.message.recentBlockhash!==state.review.blockhash)throw new Error('A reviewed launch packet changed or exceeds the size limit.')
  const policy=state.policies[index]
  if(index<state.creatorPacketCount){if(policy.payer!==state.input.payer)throw new Error('A creator launch packet changed payer.');return}
  if(policy.kind!=='tip'){
   if(policy.kind!=='buyer-buy')throw new Error('Unexpected instruction outside the complete creator launch plan.')
   const buyPolicy={action:'buy' as const,payer:policy.payer,mint:state.review.mint,maxSolLamports:policy.maxSolLamports,maxPriorityFeeLamports:BigInt(Math.round(state.input.priorityFeeSol*1e9)),expectedBuyCreator:state.creatorPlan.routing.effectiveCreator,protocolFeeRecipients:state.creatorPlan.protocolFeeRecipients}
   if(policy.transfer){if(!policy.nativeBuy||state.input.settings.mode!=='block0')throw new Error('The reviewed token transfer plan is unavailable.');validateComposedNativeBuy(tx,policy.nativeBuy,policy.transfer,buyPolicy)}else validatePumpTransaction(tx,buyPolicy)
   return
  }
  const instructions=TransactionMessage.decompile(tx.message).instructions,ix=instructions[0]
  if(tx.message.header.numRequiredSignatures!==1||tx.message.staticAccountKeys[0].toBase58()!==state.input.payer||instructions.length!==1||!ix.programId.equals(SystemProgram.programId)||ix.keys.length!==2||ix.keys[0].pubkey.toBase58()!==state.input.payer||!JITO_TIP_ACCOUNTS.some(key=>key===ix.keys[1].pubkey.toBase58())||ix.data.length!==12||ix.data.readUInt32LE(0)!==2||ix.data.readBigUInt64LE(4)!==BigInt(state.review.jitoTipLamports))throw new Error('The validator tip differs from the approved launch.')
  const expected=new TransactionMessage({payerKey:new PublicKey(state.input.payer),recentBlockhash:state.review.blockhash,instructions:[SystemProgram.transfer({fromPubkey:new PublicKey(state.input.payer),toPubkey:ix.keys[1].pubkey,lamports:BigInt(state.review.jitoTipLamports)})]}).compileToV0Message()
  if(!Buffer.from(expected.serialize()).equals(Buffer.from(tx.message.serialize())))throw new Error('The validator tip account flags differ from the approved launch.')
 })
}
export function canonicalAddress(value:string):string{return new PublicKey(value).toBase58()}
