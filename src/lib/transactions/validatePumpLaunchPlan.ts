import {ComputeBudgetProgram,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction,type AccountMeta} from '@solana/web3.js'
import {ASSOCIATED_TOKEN_PROGRAM_ID,NATIVE_MINT,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token'
import {PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,MAYHEM_PROGRAM_ID,GLOBAL_PDA,PUMP_EVENT_AUTHORITY_PDA,PUMP_FEE_EVENT_AUTHORITY_PDA,PUMP_AMM_EVENT_AUTHORITY_PDA,FEE_PROGRAM_GLOBAL_PDA,GLOBAL_VOLUME_ACCUMULATOR_PDA,PUMP_FEE_CONFIG_PDA,bondingCurvePda,bondingCurveV2Pda,creatorVaultPda,userVolumeAccumulatorPda,getGlobalParamsPda,getSolVaultPda,getMayhemStatePda,getTokenVaultPda} from '@pump-fun/pump-sdk'
import {parseResolvedCreatorFeeRouting,type ResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import {JITO_TIP_ACCOUNTS} from '@/lib/bundler/jito'

export type NativePumpLaunchStep='create'|'github-social-create'|'github-sharing-create'|'github-shares-set'|'user-token-account'|'first-buy'|'validator-tip'
export interface NativePumpLaunchPlan {
 version:1
 routing:ResolvedCreatorFeeRouting
 metadata:{name:string;symbol:string;uri:string}
 maxBuyLamports:string
 firstBuyTokenAmountRaw:string
 maxPriorityFeeLamports:string
 jitoTipLamports:string
 requiresAtomicBundle:boolean
 /** Reserve a standalone final tip packet for an immediate-buyer bundle. */
 separateJitoTip?:boolean
 packets:readonly VersionedTransaction[]
 stepsByPacket:readonly (readonly NativePumpLaunchStep[])[]
 /** Public snapshot of the freshly fetched normal-mode Global fee recipients. */
 protocolFeeRecipients:readonly string[]
}
const CREATE=Buffer.from([214,144,76,236,95,139,49,180]),SOCIAL=Buffer.from([144,224,59,211,78,248,202,220]),SHARING=Buffer.from([195,78,86,76,111,52,251,213]),SHARES=Buffer.from([111,251,49,6,78,78,106,18]),BUY=Buffer.from([102,6,61,18,1,218,235,234])
// The buyback destinations emitted by the pinned official SDK 4.3.1.
const BUYBACK_RECIPIENTS=['5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD','9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7','GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL','3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR','5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6','EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL','5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD','A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW']
const meta=(pubkey:PublicKey,isWritable=false,isSigner=false):AccountMeta=>({pubkey,isWritable,isSigner})
const pda=(program:PublicKey,seed:string,...keys:PublicKey[])=>PublicKey.findProgramAddressSync([Buffer.from(seed),...keys.map(key=>key.toBuffer())],program)[0]
const ix=(programId:PublicKey,data:Buffer,keys:AccountMeta[])=>new TransactionInstruction({programId,data,keys})
const borshString=(value:string)=>{const bytes=Buffer.from(value),length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes])}
const amount=(value:unknown,label:string,max=0xffffffffffffffffn)=>{if(typeof value!=='string'||! /^(0|[1-9][0-9]*)$/.test(value)||value.length>20)throw new Error(`Invalid ${label}`);const parsed=BigInt(value);if(parsed>max)throw new Error(`Excessive ${label}`);return parsed}
function compile(payer:PublicKey,blockhash:string,instructions:TransactionInstruction[]){return new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message())}
function fits(payer:PublicKey,blockhash:string,instructions:TransactionInstruction[]){try{return compile(payer,blockhash,instructions).serialize().length<=1232}catch{return false}}
function prefix(){return [ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:0})]}
function assertMetadata(metadata:NativePumpLaunchPlan['metadata']){
 if(!metadata||Object.keys(metadata).length!==3||!['name','symbol','uri'].every(key=>Object.hasOwn(metadata,key)))throw new Error('Invalid launch metadata')
 for(const [value,max] of [[metadata.name,32],[metadata.symbol,10],[metadata.uri,200]] as const)if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max)throw new Error('Invalid launch metadata')
}
interface ValidatedInstruction {instruction:TransactionInstruction;step:NativePumpLaunchStep}

/** Recognizes only the pinned native new-coin recipe. Fee-program instructions
 * are accepted here only as the exact GitHub setup sequence; the trade validator
 * intentionally remains closed to that program. No signing or RPC occurs. */
export function validatePumpLaunchPlan(plan:NativePumpLaunchPlan):void {
 if(plan.version!==1)throw new Error('Unsupported native launch plan version')
 if(plan.separateJitoTip!==undefined&&typeof plan.separateJitoTip!=='boolean')throw new Error('Invalid separate Jito tip policy')
 const routing=parseResolvedCreatorFeeRouting(plan.routing),payer=new PublicKey(routing.payer),mint=new PublicKey(routing.mint),curve=bondingCurvePda(mint),creator=new PublicKey(routing.effectiveCreator)
 const maxBuy=amount(plan.maxBuyLamports,'buy ceiling'),firstBuyAmount=amount(plan.firstBuyTokenAmountRaw,'quoted first-buy token amount'),maxPriority=amount(plan.maxPriorityFeeLamports,'priority ceiling',10000000n),tip=amount(plan.jitoTipLamports,'Jito tip',100000000n)
 if((maxBuy===0n)!==(firstBuyAmount===0n))throw new Error('Quoted first-buy output differs from the approved purchase mode')
 assertMetadata(plan.metadata)
 if(!Array.isArray(plan.protocolFeeRecipients)||plan.protocolFeeRecipients.length<1||plan.protocolFeeRecipients.length>8||new Set(plan.protocolFeeRecipients).size!==plan.protocolFeeRecipients.length)throw new Error('Invalid protocol fee recipient snapshot')
 for(const address of plan.protocolFeeRecipients){if(typeof address!=='string'||new PublicKey(address).toBase58()!==address||address===PublicKey.default.toBase58())throw new Error('Invalid protocol fee recipient snapshot')}
 if(!Array.isArray(plan.packets)||plan.packets.length<1||plan.packets.length>5||!Array.isArray(plan.stepsByPacket)||plan.stepsByPacket.length!==plan.packets.length)throw new Error('Native launch needs one to five complete packets')
 if(plan.requiresAtomicBundle!==(plan.packets.length>1))throw new Error('Launch atomic transport differs from the complete packet plan')
 if(plan.packets.length===1?tip!==0n:tip<1000n)throw new Error('Single launches have no tip; atomic launches require the approved Jito tip')
 const blockhash=plan.packets[0].message.recentBlockhash
 let priority=0n,spend=0n
 const packets:ValidatedInstruction[][]=[]
 const all:ValidatedInstruction[]=[]
 const ata=getAssociatedTokenAddressSync(mint,payer,false,TOKEN_2022_PROGRAM_ID),curveAta=getAssociatedTokenAddressSync(mint,curve,true,TOKEN_2022_PROGRAM_ID)
 const sharing=routing.sharingConfig?new PublicKey(routing.sharingConfig):undefined
 const classify=(actual:TransactionInstruction):ValidatedInstruction=>{
  const data=actual.data,kind=data.subarray(0,8),account=(index:number)=>{if(!actual.keys[index])throw new Error('Missing launch instruction account');return actual.keys[index].pubkey}
  if(actual.programId.equals(PUMP_PROGRAM_ID)&&kind.equals(CREATE)){
   const expectedData=Buffer.concat([CREATE,borshString(plan.metadata.name),borshString(plan.metadata.symbol),borshString(plan.metadata.uri),new PublicKey(routing.encodedCreator).toBuffer(),Buffer.from([0,0]),Buffer.alloc(8),Buffer.from([Number(routing.holderReward)])])
   if(!data.equals(expectedData))throw new Error('Create metadata, creator or exact flags differ from the reviewed launch')
   return {step:'create',instruction:ix(PUMP_PROGRAM_ID,expectedData,[meta(mint,true,true),meta(pda(PUMP_PROGRAM_ID,'mint-authority')),meta(curve,true),meta(curveAta,true),meta(GLOBAL_PDA),meta(payer,true,true),meta(SystemProgram.programId),meta(TOKEN_2022_PROGRAM_ID),meta(ASSOCIATED_TOKEN_PROGRAM_ID),meta(MAYHEM_PROGRAM_ID,true),meta(getGlobalParamsPda()),meta(getSolVaultPda(),true),meta(getMayhemStatePda(mint),true),meta(getTokenVaultPda(mint),true),meta(PUMP_EVENT_AUTHORITY_PDA),meta(PUMP_PROGRAM_ID)])}
  }
  if(actual.programId.equals(PUMP_FEE_PROGRAM_ID)&&routing.selection.kind==='github'){
   const social=new PublicKey(routing.socialRecipient!)
   if(kind.equals(SOCIAL)){
    const expectedData=Buffer.concat([SOCIAL,borshString(routing.github!.userId),Buffer.from([2])]);if(!data.equals(expectedData))throw new Error('GitHub social platform or numeric identity differs from review')
    return {step:'github-social-create',instruction:ix(PUMP_FEE_PROGRAM_ID,expectedData,[meta(payer,true,true),meta(social,true),meta(SystemProgram.programId),meta(FEE_PROGRAM_GLOBAL_PDA),meta(PUMP_FEE_EVENT_AUTHORITY_PDA),meta(PUMP_FEE_PROGRAM_ID)])}
   }
   if(kind.equals(SHARING)){
    if(!data.equals(SHARING))throw new Error('Unexpected sharing creation data')
    return {step:'github-sharing-create',instruction:ix(PUMP_FEE_PROGRAM_ID,SHARING,[meta(PUMP_FEE_EVENT_AUTHORITY_PDA),meta(PUMP_FEE_PROGRAM_ID),meta(payer,true,true),meta(GLOBAL_PDA),meta(mint),meta(sharing!,true),meta(SystemProgram.programId),meta(curve,true),meta(PUMP_PROGRAM_ID),meta(PUMP_EVENT_AUTHORITY_PDA),meta(PUMP_FEE_PROGRAM_ID),meta(PUMP_AMM_PROGRAM_ID),meta(PUMP_AMM_EVENT_AUTHORITY_PDA)])}
   }
   if(kind.equals(SHARES)){
    const count=Buffer.alloc(4),bps=Buffer.alloc(2);count.writeUInt32LE(1);bps.writeUInt16LE(10000)
    const expectedData=Buffer.concat([SHARES,count,social.toBuffer(),bps]);if(!data.equals(expectedData))throw new Error('GitHub must be the sole 10000 bps shareholder')
    const vault=creatorVaultPda(sharing!),ammVault=pda(PUMP_AMM_PROGRAM_ID,'creator_vault',sharing!)
    return {step:'github-shares-set',instruction:ix(PUMP_FEE_PROGRAM_ID,expectedData,[meta(PUMP_FEE_EVENT_AUTHORITY_PDA),meta(PUMP_FEE_PROGRAM_ID),meta(payer,true,true),meta(GLOBAL_PDA),meta(mint),meta(sharing!,true),meta(curve),meta(vault,true),meta(getAssociatedTokenAddressSync(NATIVE_MINT,vault,true,TOKEN_PROGRAM_ID),true),meta(SystemProgram.programId),meta(PUMP_PROGRAM_ID),meta(PUMP_EVENT_AUTHORITY_PDA),meta(PUMP_AMM_PROGRAM_ID),meta(PUMP_AMM_EVENT_AUTHORITY_PDA),meta(NATIVE_MINT),meta(TOKEN_PROGRAM_ID),meta(ASSOCIATED_TOKEN_PROGRAM_ID),meta(ammVault,true),meta(getAssociatedTokenAddressSync(NATIVE_MINT,ammVault,true,TOKEN_PROGRAM_ID),true),meta(payer,true)])}
   }
  }
  if(actual.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)){
   if(!data.equals(Buffer.from([1])))throw new Error('Unsupported launch token-account instruction')
   return {step:'user-token-account',instruction:ix(ASSOCIATED_TOKEN_PROGRAM_ID,Buffer.from([1]),[meta(payer,true,true),meta(ata,true),meta(payer),meta(mint),meta(SystemProgram.programId),meta(TOKEN_2022_PROGRAM_ID)])}
  }
  if(actual.programId.equals(PUMP_PROGRAM_ID)&&kind.equals(BUY)){
   if(data.length!==26||data[24]!==1||data[25]!==0||data.readBigUInt64LE(8)!==firstBuyAmount||firstBuyAmount===0n||data.readBigUInt64LE(16)===0n)throw new Error('First-buy data differs from the exact reviewed token output')
   if(!plan.protocolFeeRecipients.includes(account(1).toBase58()))throw new Error('Unexpected protocol fee recipient')
   if(!BUYBACK_RECIPIENTS.includes(account(17).toBase58()))throw new Error('Unexpected protocol buyback recipient')
   spend+=data.readBigUInt64LE(16)
   return {step:'first-buy',instruction:ix(PUMP_PROGRAM_ID,Buffer.from(data),[meta(GLOBAL_PDA),meta(account(1),true),meta(mint),meta(curve,true),meta(curveAta,true),meta(ata,true),meta(payer,true,true),meta(SystemProgram.programId),meta(TOKEN_2022_PROGRAM_ID),meta(creatorVaultPda(creator),true),meta(PUMP_EVENT_AUTHORITY_PDA),meta(PUMP_PROGRAM_ID),meta(GLOBAL_VOLUME_ACCUMULATOR_PDA),meta(userVolumeAccumulatorPda(payer),true),meta(PUMP_FEE_CONFIG_PDA),meta(PUMP_FEE_PROGRAM_ID),meta(bondingCurveV2Pda(mint)),meta(account(17),true)])}
  }
  if(actual.programId.equals(SystemProgram.programId)){
   if(data.length!==12||data.readUInt32LE(0)!==2||data.readBigUInt64LE(4)!==tip||!JITO_TIP_ACCOUNTS.some(key=>key===account(1).toBase58()))throw new Error('Unexpected system transfer or Jito tip')
   return {step:'validator-tip',instruction:SystemProgram.transfer({fromPubkey:payer,toPubkey:account(1),lamports:tip})}
  }
  throw new Error('Unexpected instruction in native launch plan')
 }
 for(const [index,tx] of plan.packets.entries()){
  if(tx.message.addressTableLookups.length||tx.message.recentBlockhash!==blockhash||!tx.message.staticAccountKeys[0]?.equals(payer))throw new Error('Launch packet payer, lookup tables or shared blockhash differ')
  try{if(tx.serialize().length>1232)throw new Error('oversized')}catch{throw new Error('Launch packet exceeds 1232 bytes')}
  const message=TransactionMessage.decompile(tx.message),instructions=message.instructions
  let compute:TransactionInstruction[]=[]
  if(instructions[0]?.programId.equals(ComputeBudgetProgram.programId)){
   compute=instructions.slice(0,2)
   const limit=compute[0],price=compute[1]
   if(!price?.programId.equals(ComputeBudgetProgram.programId)||limit.keys.length||price.keys.length||limit.data.length!==5||limit.data[0]!==2||price.data.length!==9||price.data[0]!==3)throw new Error('Expected ordered, unique launch compute settings')
   const units=BigInt(limit.data.readUInt32LE(1)),micros=price.data.readBigUInt64LE(1)
   if(units<1n||units>1400000n)throw new Error('Invalid launch compute limit')
   priority+=(units*micros+999999n)/1000000n
  }
  const decoded=instructions.slice(compute.length).map(classify)
  if(!decoded.length||(!compute.length&&(decoded.length!==1||decoded[0].step!=='validator-tip')))throw new Error('Missing launch instructions or compute settings')
  const steps=decoded.map(item=>item.step)
  if(!Array.isArray(plan.stepsByPacket[index])||JSON.stringify(steps)!==JSON.stringify(plan.stepsByPacket[index]))throw new Error('Displayed launch steps differ from the actual recipe')
  const expected=compile(payer,blockhash,[...compute,...decoded.map(item=>item.instruction)])
  if(!Buffer.from(tx.message.serialize()).equals(Buffer.from(expected.message.serialize())))throw new Error('Launch instruction account, flags or exact signer set differs from the supported recipe')
  packets.push(decoded);all.push(...decoded)
 }
 if(spend>maxBuy)throw new Error('Launch purchase exceeds the approved buy ceiling')
 if(priority>maxPriority)throw new Error('Aggregate launch priority fees exceed the approved ceiling')
 const steps=all.map(item=>item.step)
 const expectedSteps:NativePumpLaunchStep[]=['create']
 if(routing.selection.kind==='github'){if(steps[1]==='github-social-create')expectedSteps.push('github-social-create');expectedSteps.push('github-sharing-create','github-shares-set')}
 if(maxBuy>0n)expectedSteps.push('user-token-account','first-buy')
 if(tip>0n)expectedSteps.push('validator-tip')
 if(JSON.stringify(steps)!==JSON.stringify(expectedSteps))throw new Error('Missing, extra or reordered native launch recipe step')
 const launch=all.filter(item=>item.step!=='validator-tip'),tipItem=all.find(item=>item.step==='validator-tip')
 const canonicalGroups:ValidatedInstruction[][]=[]
 if(fits(payer,blockhash,[...prefix(),...launch.map(item=>item.instruction)]))canonicalGroups.push(launch)
 else {
  for(const item of launch){const last=canonicalGroups.at(-1);if(last&&fits(payer,blockhash,[...prefix(),...last.map(entry=>entry.instruction),item.instruction]))last.push(item);else canonicalGroups.push([item])}
  if(tipItem){const last=canonicalGroups.at(-1)!;if(!plan.separateJitoTip&&fits(payer,blockhash,[...prefix(),...last.map(item=>item.instruction),tipItem.instruction]))last.push(tipItem);else canonicalGroups.push([tipItem])}
 }
 if(canonicalGroups.length!==packets.length||canonicalGroups.some((group,index)=>JSON.stringify(group.map(item=>item.step))!==JSON.stringify(packets[index].map(item=>item.step))))throw new Error('Native launch uses an unsupported or unnecessary packet split')
}
