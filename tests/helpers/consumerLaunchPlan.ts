import {ComputeBudgetProgram,PublicKey,TransactionMessage,VersionedTransaction,type TransactionInstruction} from '@solana/web3.js'
import BN from 'bn.js'
import type {Global} from '@pump-fun/pump-sdk'
import {buildNativeCreateInstructions,type PumpPortalCreateParams,type PumpPortalCreateResult} from '../../src/lib/pumpfun/api'
import {resolveCreatorFeeRouting} from '../../src/lib/creatorFeeRouting'
import {validatePumpLaunchPlan,type NativePumpLaunchPlan,type NativePumpLaunchStep} from '../../src/lib/transactions/validatePumpLaunchPlan'
import {createJitoTipTransaction} from '../../src/lib/bundler/jito'

const recipient=new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VVLV57ayQ8rqKZ4DM')
const global={initialized:true,authority:PublicKey.default,feeRecipient:recipient,initialVirtualTokenReserves:new BN('1073000000000000'),initialVirtualSolReserves:new BN('30000000000'),initialVirtualQuoteReserves:new BN('30000000000'),initialRealTokenReserves:new BN('793100000000000'),tokenTotalSupply:new BN('1000000000000000'),feeBasisPoints:new BN(100),creatorFeeBasisPoints:new BN(0),buybackBasisPoints:new BN(0),feeRecipients:Array(7).fill(recipient),creatorFeeConfigurable:false,maxConfigurableCreatorFeeBps:new BN(0),isHolderRewardEnabled:true,createV2Enabled:true,mayhemModeEnabled:false,reservedFeeRecipient:PublicKey.default,reservedFeeRecipients:[]} as unknown as Global
/** Real pinned SDK instructions and exact validator; only transport/state is fake. */
export async function consumerLaunchPlan(params:PumpPortalCreateParams,blockhash:string):Promise<PumpPortalCreateResult>{
 const payer=new PublicKey(params.userPublicKey),mint=params.mintKeypair.publicKey,metadata={name:params.metadata.name,symbol:params.metadata.symbol,uri:params.metadataUri!}
 const maxBuy=BigInt(Math.round((params.initialBuyAmount??0)*1e9)),routing=resolveCreatorFeeRouting({selection:params.creatorFeeSelection??{kind:'deployer'},payer:payer.toBase58(),mint:mint.toBase58(),github:params.githubRecipient})
 const built=await buildNativeCreateInstructions({global,feeConfig:null,payer,mint,metadata,maxBuyLamports:maxBuy,routing,...(routing.github?{githubSocialExists:false}:{})})
 const steps:NativePumpLaunchStep[]=['create',...(routing.github?['github-social-create','github-sharing-create','github-shares-set'] as NativePumpLaunchStep[]:[]),...(maxBuy>0n?['user-token-account','first-buy'] as NativePumpLaunchStep[]:[])]
 const prefix=()=>[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:0})]
 const compile=(items:TransactionInstruction[])=>new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:items}).compileToV0Message())
 const fits=(items:TransactionInstruction[])=>{try{return compile(items).serialize().length<=1232}catch{return false}}
 let groups=[built.instructions.map((instruction,index)=>({instruction,step:steps[index]}))]
 if(!fits([...prefix(),...built.instructions])){
  groups=[]
  for(const [index,instruction] of built.instructions.entries()){
   const previous=groups.at(-1),item={instruction,step:steps[index]}
   if(previous&&fits([...prefix(),...previous.map(value=>value.instruction),instruction]))previous.push(item);else groups.push([item])
  }
  const tip=TransactionMessage.decompile(createJitoTipTransaction(payer,blockhash,params.jitoTipLamports??10000).message).instructions[0],last=groups.at(-1)!
  const item={instruction:tip,step:'validator-tip' as const}
  if(!params.separateJitoTip&&fits([...prefix(),...last.map(value=>value.instruction),tip]))last.push(item);else groups.push([item])
 }
 const packets=groups.map(group=>compile([...(group[0].step==='validator-tip'?[]:prefix()),...group.map(value=>value.instruction)]))
 const launchPlan:NativePumpLaunchPlan={version:1,routing,metadata,maxBuyLamports:maxBuy.toString(),firstBuyTokenAmountRaw:built.tokenAmount.toString(),maxPriorityFeeLamports:String(Math.round((params.priorityFee??0.0005)*1e9)),jitoTipLamports:groups.length>1?String(params.jitoTipLamports??10000):'0',requiresAtomicBundle:groups.length>1,separateJitoTip:params.separateJitoTip,packets,stepsByPacket:groups.map(group=>group.map(value=>value.step)),protocolFeeRecipients:[recipient.toBase58()]}
 validatePumpLaunchPlan(launchPlan)
 packets[0].sign([params.mintKeypair])
 return {success:true,transactions:packets,...(packets.length===1?{transaction:packets[0]}:{}),requiresAtomicBundle:packets.length>1,jitoTipLamports:launchPlan.jitoTipLamports,metadataUri:metadata.uri,tokenAmountRaw:built.tokenAmount.toString(),creatorFeeRouting:routing,launchPlan,nativeContext:{global,feeConfig:null,curve:built.curve,tokenAmount:built.tokenAmount,tokenProgram:new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),routing,effectiveCreator:routing.effectiveCreator}}
}
