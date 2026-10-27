import {describe,it,expect} from 'vitest'
import {ComputeBudgetProgram,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {PUMP_SDK,creatorVaultPda,type Global} from '@pump-fun/pump-sdk'
import BN from 'bn.js'
import {resolveCreatorFeeRouting,type SupportedCreatorFeeSelection} from '../src/lib/creatorFeeRouting'
import {validatePumpLaunchPlan,type NativePumpLaunchPlan,type NativePumpLaunchStep} from '../src/lib/transactions/validatePumpLaunchPlan'
import {JITO_TIP_ACCOUNTS} from '../src/lib/bundler/jito'

const feeRecipient=Keypair.generate().publicKey
const global={feeRecipient,feeRecipients:[],reservedFeeRecipient:PublicKey.default,reservedFeeRecipients:[],isHolderRewardEnabled:true} as unknown as Global
const budget=()=>[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:25000})]
function compile(payer:PublicKey,blockhash:string,instructions:TransactionInstruction[]){return new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message())}
function fits(tx:VersionedTransaction){try{return tx.serialize().length<=1232}catch{return false}}
async function fixture(selection:SupportedCreatorFeeSelection={kind:'deployer'},buy=true,socialCreate=true,maximum=false,separateJitoTip=false):Promise<NativePumpLaunchPlan>{
 const payer=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,blockhash=Keypair.generate().publicKey.toBase58()
 const routing=resolveCreatorFeeRouting({selection,payer:payer.toBase58(),mint:mint.toBase58(),...(selection.kind==='github'?{github:{userId:'12345',username:selection.username,profileUrl:`https://github.com/${selection.username}`,accountType:'User' as const}}:{})})
 const metadata={name:maximum?'N'.repeat(32):'Native',symbol:maximum?'S'.repeat(10):'NAT',uri:maximum?'https://example.com/'.padEnd(200,'x'):'ipfs://native'}
 const create=await PUMP_SDK.createV2Instruction({mint,...metadata,creator:new PublicKey(routing.encodedCreator),user:payer,mayhemMode:false,cashback:false,holderReward:routing.holderReward})
 const items:{ix:TransactionInstruction;step:NativePumpLaunchStep}[]=[{ix:create,step:'create'}]
 if(selection.kind==='github'){
  if(socialCreate)items.push({ix:await PUMP_SDK.createSocialFeePda({payer,userId:'12345',platform:2}),step:'github-social-create'})
  items.push({ix:await PUMP_SDK.createFeeSharingConfig({creator:payer,mint,pool:null}),step:'github-sharing-create'})
  items.push({ix:await PUMP_SDK.updateFeeSharesV2({authority:payer,mint,currentShareholders:[payer],newShareholders:[{address:new PublicKey(routing.socialRecipient!),shareBps:10000}],quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,bondingCurveComplete:false}),step:'github-shares-set'})
 }
 if(buy){const template=await PUMP_SDK.createV2AndBuyInstructions({global,mint,...metadata,creator:new PublicKey(routing.effectiveCreator),user:payer,amount:new BN(1000000),solAmount:new BN(100000),mayhemMode:false,cashback:false,holderReward:routing.holderReward});items.push({ix:template[1],step:'user-token-account'},{ix:template[2],step:'first-buy'})}
 let groups=[items]
 const single=compile(payer,blockhash,[...budget(),...items.map(i=>i.ix)])
 if(!fits(single)){
  groups=[]
  for(const item of items){const last=groups.at(-1);if(last&&fits(compile(payer,blockhash,[...budget(),...last.map(i=>i.ix),item.ix])))last.push(item);else groups.push([item])}
  const tip={ix:SystemProgram.transfer({fromPubkey:payer,toPubkey:new PublicKey(JITO_TIP_ACCOUNTS[0]),lamports:10000}),step:'validator-tip' as const},last=groups.at(-1)!
  if(!separateJitoTip&&fits(compile(payer,blockhash,[...budget(),...last.map(i=>i.ix),tip.ix])))last.push(tip);else groups.push([tip])
 }
 return {version:1,routing,metadata,maxBuyLamports:buy?'200000':'0',firstBuyTokenAmountRaw:buy?'1000000':'0',maxPriorityFeeLamports:'50000',jitoTipLamports:groups.length>1?'10000':'0',requiresAtomicBundle:groups.length>1,separateJitoTip,packets:groups.map(g=>compile(payer,blockhash,[...(g[0].step==='validator-tip'?[]:budget()),...g.map(i=>i.ix)])),stepsByPacket:groups.map(g=>g.map(i=>i.step)),protocolFeeRecipients:[feeRecipient.toBase58()]}
}
function mutated(plan:NativePumpLaunchPlan,step:NativePumpLaunchStep,change:(ix:TransactionInstruction)=>void):NativePumpLaunchPlan {
 const packets=plan.packets.map(tx=>{const msg=TransactionMessage.decompile(tx.message);const index=plan.stepsByPacket[plan.packets.indexOf(tx)].indexOf(step);if(index>=0){const nonCompute=msg.instructions.filter(ix=>!ix.programId.equals(ComputeBudgetProgram.programId));change(nonCompute[index])}return compile(msg.payerKey,msg.recentBlockhash,msg.instructions)})
 return {...plan,packets}
}
describe('exact native Pump launch recipes',()=>{
 it('accepts real SDK deployer, wallet, holder and existing/missing GitHub setup for zero/positive buys',async()=>{
  for(const selection of [{kind:'deployer'},{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards'},{kind:'github',username:'Octocat'}] as SupportedCreatorFeeSelection[]){for(const buy of [false,true]){for(const social of selection.kind==='github'?[false,true]:[false]){const plan=await fixture(selection,buy,social);expect(()=>validatePumpLaunchPlan(plan)).not.toThrow()}}}
 })
 it('rejects creator and creator-vault mutation, unsupported flags and metadata extensions',async()=>{
  const plan=await fixture()
  for(const change of [(ix:TransactionInstruction)=>{ix.data[ix.data.length-12]^=1},(ix:TransactionInstruction)=>{ix.data[ix.data.length-10]=1},(ix:TransactionInstruction)=>{ix.data=Buffer.concat([ix.data,Buffer.from([0])])},(ix:TransactionInstruction)=>{ix.data=ix.data.subarray(0,-1)}])expect(()=>validatePumpLaunchPlan(mutated(plan,'create',change))).toThrow()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'first-buy',ix=>{ix.keys[9].pubkey=creatorVaultPda(Keypair.generate().publicKey)}))).toThrow()
  for(const offset of [11,10,2,1])expect(()=>validatePumpLaunchPlan(mutated(plan,'create',ix=>{ix.data[ix.data.length-offset]=2}))).toThrow()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'create',ix=>{ix.keys[4].isWritable=true}))).toThrow()
  for(let index=0;index<16;index++)expect(()=>validatePumpLaunchPlan(mutated(plan,'create',ix=>{ix.keys[index].pubkey=Keypair.generate().publicKey}))).toThrow()
 })
 it('binds the exact quoted first-buy output and rejects absent, malformed or contradictory amounts',async()=>{
  const plan=await fixture()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'first-buy',ix=>{ix.data.writeBigUInt64LE(999999n,8)}))).toThrow()
  for(const firstBuyTokenAmountRaw of ['0','-1','01','18446744073709551616','1000001',undefined])expect(()=>validatePumpLaunchPlan({...plan,firstBuyTokenAmountRaw} as NativePumpLaunchPlan)).toThrow()
  const zero=await fixture({kind:'deployer'},false)
  expect(()=>validatePumpLaunchPlan({...zero,firstBuyTokenAmountRaw:'1'})).toThrow()
 })
 it('rejects every altered GitHub recipient, platform, share and authority and missing setup',async()=>{
  const plan=await fixture({kind:'github',username:'Octocat'})
  for(const change of [(ix:TransactionInstruction)=>{ix.data[ix.data.length-1]=3},(ix:TransactionInstruction)=>{ix.keys[1].pubkey=Keypair.generate().publicKey}])expect(()=>validatePumpLaunchPlan(mutated(plan,'github-social-create',change))).toThrow()
  for(const bps of [9999,10001])expect(()=>validatePumpLaunchPlan(mutated(plan,'github-shares-set',ix=>{ix.data.writeUInt16LE(bps,ix.data.length-2)}))).toThrow()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'github-shares-set',ix=>{ix.keys[2].pubkey=Keypair.generate().publicKey}))).toThrow()
  for(let index=0;index<20;index++)expect(()=>validatePumpLaunchPlan(mutated(plan,'github-shares-set',ix=>{ix.keys[index].pubkey=Keypair.generate().publicKey}))).toThrow()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'github-shares-set',ix=>{ix.data.writeUInt32LE(2,8);ix.data=Buffer.concat([ix.data,Keypair.generate().publicKey.toBuffer(),Buffer.from([1,0])])}))).toThrow()
  const without=plan.packets.map(tx=>{const m=TransactionMessage.decompile(tx.message);return compile(m.payerKey,m.recentBlockhash,m.instructions.filter(ix=>!ix.data.subarray(0,8).equals(Buffer.from([111,251,49,6,78,78,106,18]))))})
  expect(()=>validatePumpLaunchPlan({...plan,packets:without})).toThrow()
 })
 it('rejects a buy before fee finalization, gratuitous splitting and extra outer transfers',async()=>{
  const plan=await fixture({kind:'github',username:'Octocat'})
  const reordered=plan.packets.map(tx=>{const msg=TransactionMessage.decompile(tx.message),share=msg.instructions.findIndex(ix=>ix.data.subarray(0,8).equals(Buffer.from([111,251,49,6,78,78,106,18]))),buy=msg.instructions.findIndex(ix=>ix.data.subarray(0,8).equals(Buffer.from([102,6,61,18,1,218,235,234])));if(share>=0&&buy>=0)[msg.instructions[share],msg.instructions[buy]]=[msg.instructions[buy],msg.instructions[share]];return compile(msg.payerKey,msg.recentBlockhash,msg.instructions)})
  expect(()=>validatePumpLaunchPlan({...plan,packets:reordered})).toThrow()
  const single=await fixture({kind:'deployer'},false),msg=TransactionMessage.decompile(single.packets[0].message),payer=msg.payerKey
  const extra=SystemProgram.transfer({fromPubkey:payer,toPubkey:Keypair.generate().publicKey,lamports:1})
  expect(()=>validatePumpLaunchPlan({...single,packets:[compile(payer,msg.recentBlockhash,[...msg.instructions,extra])]})).toThrow()
  expect(()=>validatePumpLaunchPlan({...single,requiresAtomicBundle:true,jitoTipLamports:'10000',packets:[single.packets[0],compile(payer,msg.recentBlockhash,[SystemProgram.transfer({fromPubkey:payer,toPubkey:new PublicKey(JITO_TIP_ACCOUNTS[0]),lamports:10000})])],stepsByPacket:[single.stepsByPacket[0],['validator-tip']]})).toThrow()
 })
 it('permits an explicitly separate final tip for split launches and enforces that reviewed policy',async()=>{
  const forced=await fixture({kind:'github',username:'Octocat'},true,true,false,true)
  expect(forced.stepsByPacket.at(-1)).toEqual(['validator-tip'])
  expect(()=>validatePumpLaunchPlan(forced)).not.toThrow()
  expect(()=>validatePumpLaunchPlan({...forced,separateJitoTip:undefined})).toThrow()
  expect(()=>validatePumpLaunchPlan({...forced,separateJitoTip:false})).toThrow()
  const embedded=await fixture({kind:'github',username:'Octocat'})
  expect(embedded.stepsByPacket.at(-1)!.length).toBeGreaterThan(1)
  expect(()=>validatePumpLaunchPlan({...embedded,separateJitoTip:true})).toThrow()
  const single=await fixture({kind:'deployer'},false,false,false,true)
  expect(single.packets).toHaveLength(1)
  expect(()=>validatePumpLaunchPlan(single)).not.toThrow()
  for(const separateJitoTip of [null,0,'true'])expect(()=>validatePumpLaunchPlan({...single,separateJitoTip} as unknown as NativePumpLaunchPlan)).toThrow()
 })
 it('rejects excess spend, aggregate priority, extra signer/transfer, inconsistent hash and dishonest display steps',async()=>{
  const plan=await fixture({kind:'github',username:'Octocat'},true,true,true)
  expect(()=>validatePumpLaunchPlan({...plan,maxBuyLamports:'1'})).toThrow()
  expect(()=>validatePumpLaunchPlan({...plan,maxPriorityFeeLamports:'1'})).toThrow()
  expect(()=>validatePumpLaunchPlan({...plan,stepsByPacket:plan.stepsByPacket.map(()=>['create'])})).toThrow()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'first-buy',ix=>{ix.keys.push({pubkey:Keypair.generate().publicKey,isSigner:true,isWritable:true})}))).toThrow()
  expect(()=>validatePumpLaunchPlan(mutated(plan,'validator-tip',ix=>{ix.keys[1].pubkey=Keypair.generate().publicKey}))).toThrow()
  const packets=plan.packets.map((tx,i)=>{const m=TransactionMessage.decompile(tx.message);return compile(m.payerKey,i?Keypair.generate().publicKey.toBase58():m.recentBlockhash,m.instructions)})
  expect(()=>validatePumpLaunchPlan({...plan,packets})).toThrow()
 })
})
