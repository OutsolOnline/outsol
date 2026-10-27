import { describe, expect, it } from 'vitest'
import { Connection,Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import BN from 'bn.js'
import type { Global } from '@pump-fun/pump-sdk'
import { buildCreateTransaction,buildNativeCreateInstructions,buildFreshNativeBuy } from '../src/lib/pumpfun/api'
import {TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync,unpackAccount} from '@solana/spl-token'
import { validatePumpTransaction } from '../src/lib/transactions/validatePumpTransaction'
import {resolveCreatorFeeRouting} from '../src/lib/creatorFeeRouting'
import {PUMP_SDK,OnlinePumpSdk,creatorVaultPda,bondingCurvePda,PUMP_FEE_PROGRAM_ID,socialFeePda} from '@pump-fun/pump-sdk'
import {confirmSignatures} from '../src/lib/transactions/send'
import {simulateAtomicBundle} from '../src/lib/bundler/jito'
import {validatePumpLaunchPlan} from '../src/lib/transactions/validatePumpLaunchPlan'
import {appendFileSync} from 'node:fs'

const zero = PublicKey.default
// Offline protocol state fixture; no RPC or transaction submission occurs.
const global = {
  initialized: true, authority: zero, feeRecipient: Keypair.generate().publicKey,
  initialVirtualTokenReserves: new BN('1073000000000000'), initialVirtualSolReserves: new BN('30000000000'),initialVirtualQuoteReserves: new BN('30000000000'),
  initialRealTokenReserves: new BN('793100000000000'), tokenTotalSupply: new BN('1000000000000000'),
  feeBasisPoints: new BN(100), creatorFeeBasisPoints: new BN(0), buybackBasisPoints: new BN(0), feeRecipients: Array.from({ length: 7 }, () => Keypair.generate().publicKey),
  creatorFeeConfigurable: false, maxConfigurableCreatorFeeBps: new BN(0), isHolderRewardEnabled: false,
  createV2Enabled: true, mayhemModeEnabled: false, reservedFeeRecipient: zero, reservedFeeRecipients: [],
} as unknown as Global

describe('native Pump launch construction', () => {
  it('rejects a malformed present route rather than applying legacy deployer fallback',async()=>{
    await expect(buildNativeCreateInstructions({global,feeConfig:null,payer:Keypair.generate().publicKey,mint:Keypair.generate().publicKey,metadata:{name:'No fallback',symbol:'NO',uri:'ipfs://no'},maxBuyLamports:0n,routing:null as never})).rejects.toThrow()
  })
  it('uses an approved wallet creator for zero/positive first buy and later buyers without adding its signature',async()=>{
    const payer=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey
    const routing=resolveCreatorFeeRouting({selection:{kind:'wallet',address:recipient.toBase58()},payer:payer.toBase58(),mint:mint.toBase58()})
    for(const maxBuyLamports of [0n,100_000_000n]){
      const plan=await buildNativeCreateInstructions({global,feeConfig:null,payer,mint,metadata:{name:'Wallet',symbol:'WAL',uri:'ipfs://wallet'},maxBuyLamports,routing})
      expect(plan.curve.creator.equals(recipient)).toBe(true)
      const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:plan.instructions}).compileToV0Message())
      expect(tx.message.header.numRequiredSignatures).toBe(2)
      expect(()=>validatePumpTransaction(tx,{action:'create',payer,mint,maxSolLamports:maxBuyLamports,expectedCreator:recipient,expectedCreateFlags:{mayhem:false,cashback:false,creatorFeeBps:0n,holderReward:false},expectedBuyCreator:recipient})).not.toThrow()
      if(maxBuyLamports){const buy=plan.instructions.at(-1)!;expect(buy.keys[9].pubkey.equals(creatorVaultPda(recipient))).toBe(true)}
    }
  })
  it('gates holder rewards for zero and positive buy and preserves the effective holder creator',async()=>{
    const payer=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,routing=resolveCreatorFeeRouting({selection:{kind:'holder-rewards'},payer:payer.toBase58(),mint:mint.toBase58()})
    for(const maxBuyLamports of [0n,100_000_000n]){
      const args={global,feeConfig:null,payer,mint,metadata:{name:'Holders',symbol:'HOLD',uri:'ipfs://holder'},maxBuyLamports,routing}
      await expect(buildNativeCreateInstructions(args)).rejects.toThrow(/holder/i)
      const plan=await buildNativeCreateInstructions({...args,global:{...global,isHolderRewardEnabled:true}})
      expect(plan.curve.creator.toBase58()).toBe(routing.effectiveCreator);expect(plan.curve.isHolderReward).toBe(true)
      const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:plan.instructions}).compileToV0Message())
      expect(()=>validatePumpTransaction(tx,{action:'create',payer,mint,maxSolLamports:maxBuyLamports,expectedCreator:payer,expectedCreateFlags:{mayhem:false,cashback:false,creatorFeeBps:0n,holderReward:true},expectedBuyCreator:routing.effectiveCreator})).not.toThrow()
    }
  })
  it('retains each effective creator in immediate later buyer packets and requires only the buyer signature',async()=>{
    const payer=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,buyer=Keypair.generate().publicKey,metadata={name:'Next buyer',symbol:'NEXT',uri:'ipfs://next'}
    for(const selection of [{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards'},{kind:'github',username:'octocat'}] as const){
      const routing=resolveCreatorFeeRouting({selection,payer:payer.toBase58(),mint:mint.toBase58(),...(selection.kind==='github'?{github:{userId:'583231',username:'octocat',profileUrl:'https://github.com/octocat',accountType:'User' as const}}:{})})
      const liveGlobal={...global,isHolderRewardEnabled:true},initial=await buildNativeCreateInstructions({global:liveGlobal,feeConfig:null,payer,mint,metadata,maxBuyLamports:100_000_000n,routing,githubSocialExists:true})
      const next=await buildFreshNativeBuy({context:{global:liveGlobal,feeConfig:null,curve:initial.curve,tokenAmount:initial.tokenAmount,tokenProgram:TOKEN_2022_PROGRAM_ID,routing,effectiveCreator:routing.effectiveCreator},mint,payer:buyer,metadata,maxBuyLamports:100_000_000n,blockhash:Keypair.generate().publicKey.toBase58()})
      expect(next.transaction.message.header.numRequiredSignatures).toBe(1)
      expect(next.transaction.message.staticAccountKeys[0].equals(buyer)).toBe(true)
      const buy=TransactionMessage.decompile(next.transaction.message).instructions.at(-1)!
      expect(buy.keys[9].pubkey.equals(creatorVaultPda(new PublicKey(routing.effectiveCreator)))).toBe(true)
      expect(next.context.curve.creator.toBase58()).toBe(routing.effectiveCreator)
    }
  })
  it('builds a zero-provider-fee creation and exact token buy within the approved maximum SOL', async () => {
    const payer = Keypair.generate().publicKey; const mint = Keypair.generate().publicKey
    const plan = await buildNativeCreateInstructions({ global, feeConfig: null, payer, mint, metadata: {name:'Native Test',symbol:'NTEST',uri:'ipfs://native-test'}, maxBuyLamports: 100_000_000n })
    const tx = new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:plan.instructions}).compileToV0Message())
    expect(plan.tokenAmount.gt(new BN(0))).toBe(true)
    expect(() => validatePumpTransaction(tx, {action:'create',payer,mint,maxSolLamports:100_000_000n,expectedMetadata:{name:'Native Test',symbol:'NTEST',uri:'ipfs://native-test'}})).not.toThrow()
    const pumpBuy = plan.instructions.find(ix => ix.data.subarray(0,8).equals(Buffer.from([102,6,61,18,1,218,235,234])))!
    expect(pumpBuy.data.readBigUInt64LE(8).toString()).toBe(plan.tokenAmount.toString())
    expect(pumpBuy.data.readBigUInt64LE(16) <= 100_000_000n).toBe(true)
    expect(plan.platformFeeLamports).toBe(0n)
  })
  it('creates without a token purchase when buy budget is zero', async () => {
    const plan = await buildNativeCreateInstructions({global,feeConfig:null,payer:Keypair.generate().publicKey,mint:Keypair.generate().publicKey,metadata:{name:'No Buy',symbol:'NOBUY',uri:'ipfs://no-buy'},maxBuyLamports:0n})
    expect(plan.tokenAmount.toString()).toBe('0')
    expect(plan.instructions).toHaveLength(1)
  })
  it('quotes later bundle buyers against the preceding buys and requires only their wallet signature',async()=>{
    const payer=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,buyer=Keypair.generate().publicKey
    const first=await buildNativeCreateInstructions({global,feeConfig:null,payer,mint,metadata:{name:'Bundle',symbol:'BNDL',uri:'ipfs://bundle'},maxBuyLamports:100_000_000n})
    const next=await buildFreshNativeBuy({context:{global,feeConfig:null,curve:first.curve,tokenAmount:first.tokenAmount,tokenProgram:TOKEN_2022_PROGRAM_ID},mint,payer:buyer,metadata:{name:'Bundle',symbol:'BNDL',uri:'ipfs://bundle'},maxBuyLamports:100_000_000n,blockhash:Keypair.generate().publicKey.toBase58()})
    expect(next.transaction.message.header.numRequiredSignatures).toBe(1)
    expect(next.context.tokenAmount.lt(first.tokenAmount)).toBe(true)
    expect(next.context.curve.virtualQuoteReserves.gt(first.curve.virtualQuoteReserves)).toBe(true)
    expect(()=>validatePumpTransaction(next.transaction,{action:'buy',payer:buyer,mint,maxSolLamports:100_000_000n})).not.toThrow()
  })
})

// Opt-in chain proof. All spenders are generated here; the transport rejects
// every non-loopback request and verifies Surfpool before minting fake SOL.
describe.skipIf(process.env.RUN_CREATOR_FEE_LOCAL!=='1')('routed native creation on disposable Surfpool',()=>{
 it('executes zero and positive buys for each route with maximum metadata and verifies actual state',async()=>{
  const endpoint='http://127.0.0.1:8899',generated=new Set<string>();let verified=false
  const localFetch:typeof fetch=async(input,init)=>{
   if(new URL(String(input)).origin!==endpoint)throw new Error('Non-local proof request rejected')
   const call=JSON.parse(String(init?.body))
   if(['sendTransaction','sendBundle','requestAirdrop'].includes(call.method)){
    if(!verified)throw new Error('Surfpool not verified')
    const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((encoded:string)=>VersionedTransaction.deserialize(Buffer.from(encoded,'base64')).message.staticAccountKeys[0].toBase58())
    if(payers.some((payer:string)=>!generated.has(payer)))throw new Error('Only fresh disposable payers can spend fake SOL')
   }
   return fetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30_000)})
  }
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:localFetch,disableRetryOnRateLimit:true})
  const rpc=async(method:string,params:unknown[]=[])=>{const body=await (await localFetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json();if(body.error)throw new Error(JSON.stringify(body.error));return body.result}
  expect((await rpc('getVersion'))['surfnet-version']).toBe('1.6.1');expect((await rpc('surfnet_getSurfnetInfo')).value?.startup?.phase).toBe('ready');verified=true
  const global=await new OnlinePumpSdk(connection).fetchGlobal()
  await connection.getMultipleAccountsInfo(Object.values(global).flat().filter((value):value is PublicKey=>value instanceof PublicKey))
  const cases=Array.from(['deployer','wallet','holder-rewards','github'] as const).flatMap(kind=>[0,0.1].map(initialBuyAmount=>({kind,initialBuyAmount,userId:'583231',username:'octocat'})))
  // Public individual fixtures verified through api.github.com/user/<id>.
  // Distinct IDs exercise missing social accounts in both buy modes on a fresh
  // fork, and verify the existing-state branch on subsequent proof runs.
  cases.push({kind:'github',initialBuyAmount:0,userId:'180000005',username:'Juampi2260'},{kind:'github',initialBuyAmount:0.1,userId:'180000007',username:'Ashleybooby'})
  for(const {kind,initialBuyAmount,userId,username} of cases){
   const payer=Keypair.generate(),mint=Keypair.generate(),recipient=Keypair.generate().publicKey;generated.add(payer.publicKey.toBase58())
   const funded=await connection.requestAirdrop(payer.publicKey,10_000_000_000);expect((await confirmSignatures(connection,[funded],{timeoutMs:10_000,pollIntervalMs:100})).status).toBe('confirmed')
   const creatorFeeSelection=kind==='wallet'?{kind,address:recipient.toBase58()}:kind==='github'?{kind,username}:{kind}
   const socialWasInitialized=kind==='github'?!!await connection.getAccountInfo(socialFeePda(userId,2)):undefined
   const built=await buildCreateTransaction({connection,userPublicKey:payer.publicKey.toBase58(),mintKeypair:mint,metadata:{name:'R'.repeat(32),symbol:'F'.repeat(10),description:''},metadataUri:'https://example.com/'.padEnd(200,'r'),initialBuyAmount,priorityFee:0.00002,jitoTipLamports:10000,creatorFeeSelection,githubRecipient:kind==='github'?{userId,username,profileUrl:`https://github.com/${username}`,accountType:'User'}:undefined})
   expect(built.success,built.error).toBe(true);const plan=built.launchPlan!;validatePumpLaunchPlan(plan)
   if(kind==='github')expect(plan.stepsByPacket.flat().includes('github-social-create')).toBe(!socialWasInitialized)
   for(const tx of plan.packets){const reviewed=Buffer.from(tx.message.serialize()).toString('base64');tx.sign([payer]);expect(Buffer.from(tx.message.serialize()).toString('base64')).toBe(reviewed)}
   const keys=[...new Map(plan.packets.flatMap(tx=>tx.message.staticAccountKeys).map(key=>[key.toBase58(),key])).values()]
   for(let index=0;index<keys.length;index+=100)await connection.getMultipleAccountsInfo(keys.slice(index,index+100))
   const before=await connection.getBalance(payer.publicKey),simulation=await simulateAtomicBundle(connection,[...plan.packets],{verifySignatures:true,payer:payer.publicKey.toBase58()})
   expect(simulation.success,simulation.error).toBe(true)
   await rpc('sendBundle',[plan.packets.map(tx=>Buffer.from(tx.serialize()).toString('base64')),{encoding:'base64'}])
   const bs58=(await import('bs58')).default;const signatures=plan.packets.map(tx=>bs58.encode(tx.signatures[0]))
   expect((await confirmSignatures(connection,signatures,{timeoutMs:20_000,pollIntervalMs:100})).status).toBe('confirmed')
   const debit=BigInt(before)-BigInt(await connection.getBalance(payer.publicKey));expect(simulation.payerDebitLamports).toBe(debit.toString())
   const curve=PUMP_SDK.decodeBondingCurve((await connection.getAccountInfo(bondingCurvePda(mint.publicKey)))!)
   expect(curve.creator.toBase58()).toBe(plan.routing.effectiveCreator);expect(curve.isHolderReward).toBe(kind==='holder-rewards');expect(curve.isCashbackCoin).toBe(false)
   const ata=getAssociatedTokenAddressSync(mint.publicKey,payer.publicKey,false,TOKEN_2022_PROGRAM_ID),ataInfo=await connection.getAccountInfo(ata)
   expect(ataInfo?unpackAccount(ata,ataInfo,TOKEN_2022_PROGRAM_ID).amount.toString():'0').toBe(built.tokenAmountRaw)
   if(initialBuyAmount>0)expect(await connection.getBalance(creatorVaultPda(new PublicKey(plan.routing.effectiveCreator)))).toBeGreaterThan(0)
   let socialDelta='0'
   if(kind==='github'){
    const socialInfo=(await connection.getAccountInfo(new PublicKey(plan.routing.socialRecipient!)))!;expect(socialInfo.owner.equals(PUMP_FEE_PROGRAM_ID)).toBe(true)
    const social=PUMP_SDK.decodeSocialFeePda(socialInfo);expect(social.userId).toBe(userId);expect(social.platform).toBe(2)
    const sharing=PUMP_SDK.decodeSharingConfig((await connection.getAccountInfo(new PublicKey(plan.routing.sharingConfig!)))!)
    expect(sharing.adminRevoked).toBe(true);expect(sharing.shareholders.map(share=>({address:share.address.toBase58(),shareBps:share.shareBps}))).toEqual([{address:plan.routing.socialRecipient,shareBps:10000}])
    if(initialBuyAmount>0){
     const socialBefore=await connection.getBalance(new PublicKey(plan.routing.socialRecipient!))
     const ix=await PUMP_SDK.distributeCreatorFeesV2({mint:mint.publicKey,sharingConfig:sharing,sharingConfigAddress:new PublicKey(plan.routing.sharingConfig!),quoteMint:NATIVE_MINT,payer:payer.publicKey,shouldInitializeAta:false,quoteTokenProgram:TOKEN_PROGRAM_ID})
     const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:(await connection.getLatestBlockhash()).blockhash,instructions:[ix]}).compileToV0Message());tx.sign([payer]);await connection.getMultipleAccountsInfo(tx.message.staticAccountKeys)
     const signature=await connection.sendRawTransaction(tx.serialize());expect((await confirmSignatures(connection,[signature],{timeoutMs:20_000,pollIntervalMs:100})).status).toBe('confirmed')
     socialDelta=String((await connection.getBalance(new PublicKey(plan.routing.socialRecipient!)))-socialBefore);expect(BigInt(socialDelta)).toBeGreaterThan(0n)
    }
   }
   const evidence={proof:'creator-fee-native-core',realSolSpent:false,kind,initialBuyAmount,githubUserId:kind==='github'?userId:undefined,socialWasInitialized,mint:mint.publicKey.toBase58(),effectiveCreator:curve.creator.toBase58(),holderReward:curve.isHolderReward,packets:plan.packets.map(tx=>tx.serialize().length),steps:plan.stepsByPacket,debitLamports:String(debit),previewDebitLamports:simulation.payerDebitLamports,socialDistributionLamports:socialDelta}
   console.log(JSON.stringify(evidence));if(process.env.CREATOR_FEE_EVIDENCE_FILE)appendFileSync(process.env.CREATOR_FEE_EVIDENCE_FILE,JSON.stringify(evidence)+'\n')
  }
 },180_000)
})
