import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {parseRehearsalInput} from '../src/lib/server/rehearsal/input'
import {resolveCreatorFeeRouting} from '../src/lib/creatorFeeRouting'
import {readMultiLaunchDraft,MULTI_LAUNCH_DRAFT_KEY} from '../src/lib/multiLaunch/draft'
import {publicBundleReceipt} from '../src/lib/bundler/receipt'
import {applyBundleSettings,BUILT_IN_BUNDLE_PRESETS,publicBundleSettings} from '../src/lib/bundler/presets'
import {useBundlerStore} from '../src/stores/bundlerStore'
import {restoreRehearsalSession} from '../src/lib/rehearsalSession'
import {persistBundleCheckpoint,readPendingBundleReceipt} from '../src/lib/bundler/pending'
import bs58 from 'bs58'

const legacy={name:'Fee test',symbol:'FEE',metadataUri:'https://example.com/token.json',initialBuySol:'0',priorityFeeSol:'0',jitoTipSol:'0.00001'}
describe('creator fee intent at consumer boundaries',()=>{
 it('migrates exactly absent rehearsal intent and accepts explicit supported selections',()=>{
  expect(parseRehearsalInput(legacy).creatorFeeSelection).toEqual({kind:'deployer'})
  expect(parseRehearsalInput({...legacy,creatorFeeSelection:{kind:'holder-rewards'}}).creatorFeeSelection).toEqual({kind:'holder-rewards'})
  for(const creatorFeeSelection of [null,{},undefined,{kind:'cashback'},{kind:'unknown'},{kind:'wallet',address:'bad'},{kind:'github',username:'octocat',verified:true}])expect(()=>parseRehearsalInput({...legacy,creatorFeeSelection})).toThrow()
 })
 it('retains a selected public recipient when applying private-free execution presets',()=>{
  const address=Keypair.generate().publicKey.toBase58(),config={...useBundlerStore.getState(),creatorFeeSelection:{kind:'wallet' as const,address}}
  expect(applyBundleSettings(config,BUILT_IN_BUNDLE_PRESETS[0].settings).creatorFeeSelection).toEqual(config.creatorFeeSelection)
  expect(JSON.stringify(publicBundleSettings(config))).not.toContain(address)
 })
 it('preserves and validates public routing rather than dropping it from a bundle receipt',()=>{
  const payer=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58()
  const creatorFeeRouting=resolveCreatorFeeRouting({selection:{kind:'holder-rewards'},payer,mint})
  expect(publicBundleReceipt({success:false,mintAddress:mint,creatorFeeRouting})?.creatorFeeRouting).toEqual(creatorFeeRouting)
  expect(()=>publicBundleReceipt({success:false,mintAddress:Keypair.generate().publicKey.toBase58(),creatorFeeRouting})).toThrow()
 })
 it('migrates old batch designs only when the selection field is absent',()=>{
  const base={version:1,rows:[{name:'A',symbol:'A',buySol:'0'},{name:'B',symbol:'B',buySol:'0'}],description:'',website:'',twitter:'',telegram:'',source:'external',slippage:5,priority:0,tip:0.00001,kitId:''}
  const storage=(value:unknown)=>({getItem:(key:string)=>key===MULTI_LAUNCH_DRAFT_KEY?JSON.stringify(value):null,setItem:()=>{}})
  expect(readMultiLaunchDraft(storage(base))?.creatorFeeSelection).toEqual({kind:'deployer'})
  for(const creatorFeeSelection of [null,{}, {kind:'cashback'}])expect(()=>readMultiLaunchDraft(storage({...base,creatorFeeSelection}))).toThrow()
 })
 it('preserves approved bundle routing while confirmation is unknown and rejects recipient replacement',()=>{
  const payer=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),signature=bs58.encode(new Uint8Array(64).fill(7)),values=new Map<string,string>()
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const creatorFeeRouting=resolveCreatorFeeRouting({selection:{kind:'holder-rewards'},payer,mint}),receipt={success:false,status:'unknown' as const,mintAddress:mint,createSignature:signature,submittedSignatures:[signature],creatorFeeRouting}
  persistBundleCheckpoint(receipt,storage)
  expect(readPendingBundleReceipt(storage)?.creatorFeeRouting).toEqual(creatorFeeRouting)
  expect(()=>persistBundleCheckpoint({...receipt,creatorFeeRouting:resolveCreatorFeeRouting({selection:{kind:'deployer'},payer,mint})},storage)).toThrow(/recipient changed/)
  expect(readPendingBundleReceipt(storage)?.creatorFeeRouting).toEqual(creatorFeeRouting)
 })
 it('restores only matching resolved and observed rehearsal routing, leaving old reports unverified',()=>{
  const payer=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),now=new Date().toISOString()
  const creatorFeeRouting=resolveCreatorFeeRouting({selection:{kind:'holder-rewards'},payer,mint})
  const report={network:'local-mainnet-fork',runtimeVersion:'1.6.1',mint,payer,name:'Fee test',symbol:'FEE',metadataUri:legacy.metadataUri,decimals:6,supplyRaw:'1000',walletTokenRaw:'0',payerBeforeLamports:'1000',payerAfterLamports:'900',totalCostLamports:'100',networkFeeLamports:'5',initialBuyLamports:'0',initialBuyBudgetLamports:'0',jitoTipLamports:'0',platformFeeLamports:'0',curveRealSolReservesLamports:'0',curveRealTokenReservesRaw:'1000',mintAuthority:null,freezeAuthority:null,metadataImmutable:true,transactionSignatures:[bs58.encode(new Uint8Array(64).fill(7))],execution:'single',unsupported:{devLock:'not-configured',lp:'not-configured'},actualCostBreakdownNote:'Measured fake SOL',completedAt:now}
  const saved={input:{...legacy,creatorFeeSelection:{kind:'holder-rewards'}},job:{id:'a'.repeat(48),status:'succeeded',createdAt:now,expiresAt:now,result:{...report,creatorFeeRouting,observedRouting:{creator:creatorFeeRouting.effectiveCreator,isHolderReward:true,isCashbackCoin:false,verifiedRecipient:creatorFeeRouting.effectiveCreator}}}}
  expect(restoreRehearsalSession(JSON.stringify(saved)).job.result?.creatorFeeRouting).toEqual(creatorFeeRouting)
  expect(()=>restoreRehearsalSession(JSON.stringify({...saved,job:{...saved.job,result:{...saved.job.result,observedRouting:{...saved.job.result.observedRouting,creator:payer}}}}))).toThrow(/routing/)
  expect(restoreRehearsalSession(JSON.stringify({...saved,job:{...saved.job,result:report}})).job.result?.creatorFeeRouting).toBeUndefined()
 })
 it('restores a GitHub report whose verified canonical login differs only by case from the saved selection',()=>{
  const payer=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),now=new Date().toISOString()
  const creatorFeeRouting=resolveCreatorFeeRouting({selection:{kind:'github',username:'alice'},payer,mint,github:{username:'Alice',userId:'12345',profileUrl:'https://github.com/Alice',accountType:'User'}})
  const report={network:'local-mainnet-fork',runtimeVersion:'1.6.1',mint,payer,name:'Fee test',symbol:'FEE',metadataUri:legacy.metadataUri,decimals:6,supplyRaw:'1000',walletTokenRaw:'0',payerBeforeLamports:'1000',payerAfterLamports:'900',totalCostLamports:'100',networkFeeLamports:'5',initialBuyLamports:'0',initialBuyBudgetLamports:'0',jitoTipLamports:'0',platformFeeLamports:'0',curveRealSolReservesLamports:'0',curveRealTokenReservesRaw:'1000',mintAuthority:null,freezeAuthority:null,metadataImmutable:true,transactionSignatures:[bs58.encode(new Uint8Array(64).fill(7))],execution:'atomic-bundle',unsupported:{devLock:'not-configured',lp:'not-configured'},actualCostBreakdownNote:'Measured fake SOL',completedAt:now,creatorFeeRouting,observedRouting:{creator:creatorFeeRouting.effectiveCreator,isHolderReward:false,isCashbackCoin:false,verifiedRecipient:creatorFeeRouting.socialRecipient,sharing:{address:creatorFeeRouting.sharingConfig,adminRevoked:true,shareholder:creatorFeeRouting.socialRecipient,shareBps:10000}}}
  const saved={input:{...legacy,creatorFeeSelection:{kind:'github',username:'alice'}},job:{id:'a'.repeat(48),status:'succeeded',createdAt:now,expiresAt:now,result:report}}
  expect(restoreRehearsalSession(JSON.stringify(saved)).job.result?.creatorFeeRouting).toEqual(creatorFeeRouting)
  for(const creatorFeeSelection of [{kind:'github',username:'someone-else'},{kind:'holder-rewards'},{kind:'wallet',address:payer}])expect(()=>restoreRehearsalSession(JSON.stringify({...saved,input:{...saved.input,creatorFeeSelection}}))).toThrow()
  expect(()=>restoreRehearsalSession(JSON.stringify({...saved,job:{...saved.job,result:{...report,creatorFeeRouting:{...creatorFeeRouting,github:{...creatorFeeRouting.github,userId:'12346'}}}}}))).toThrow()
 })
})
