import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import bs58 from 'bs58'
import {consumerLaunchPlan} from './helpers/consumerLaunchPlan'
import {executeBundleLaunch} from '../src/lib/bundler/api'
import {useBundlerStore} from '../src/stores/bundlerStore'
import {fetchGitHubIndividual} from '../src/lib/githubRecipient'
import * as sender from '../src/lib/transactions/send'
import {persistBundleCheckpoint,readPendingBundleReceipt} from '../src/lib/bundler/pending'
import type {BundleResult} from '../src/lib/bundler/types'
vi.mock('../src/lib/creatorFeeRecovery',()=>({verifyCreatorFeeRoutingOnChain:async()=>{}}))
vi.mock('../src/lib/githubRecipient',()=>({fetchGitHubIndividual:vi.fn(async(username:string)=>({username,userId:'583231',profileUrl:`https://github.com/${username}`,accountType:'User'}))}))
const builders=vi.hoisted(()=>({create:vi.fn(),buy:vi.fn()}))
vi.mock('../src/lib/pumpfun/api',async original=>({...await original<typeof import('../src/lib/pumpfun/api')>(),buildCreateTransaction:builders.create,buildNativeBuyTransaction:builders.buy}))
vi.mock('../src/lib/bundler/jito',async original=>{const actual=await original<typeof import('../src/lib/bundler/jito')>();return {...actual,createVerifiedJitoTipTransaction:async(_connection:Connection,payer:PublicKey,blockhash:string,lamports:number)=>actual.createJitoTipTransaction(payer,blockhash,lamports)}})
function transaction(payer:PublicKey,mint?:PublicKey){return new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[mint?SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:mint,lamports:0,space:0,programId:SystemProgram.programId}):SystemProgram.transfer({fromPubkey:payer,toPubkey:payer,lamports:1})]}).compileToV0Message())}
function setup(){
 const creator=Keypair.generate(),buyer=Keypair.generate();let unlocked=true
 const config={...useBundlerStore.getState(),creatorPrivateKey:bs58.encode(creator.secretKey),creatorPublicKey:creator.publicKey.toBase58(),tokenName:'Managed Test',tokenSymbol:'MGD',tokenImage:new Blob(['image']) as File,mintMode:'random' as const,autoSellEnabled:false,sniperMode:'after_confirm' as const,bundleWallets:[]}
 const resolveSigners=()=>{if(!unlocked)throw new Error('Selected wallet group locked or changed');return {creator,wallets:new Map([[1,buyer]])}}
 vi.spyOn(Connection.prototype,'getBalance').mockResolvedValue(10_000_000_000)
 const connection=new Connection('http://localhost:9999','confirmed');vi.spyOn(connection,'getBlockHeight').mockResolvedValue(500)
 const send=vi.spyOn(Connection.prototype,'sendRawTransaction').mockImplementation(async bytes=>bs58.encode(VersionedTransaction.deserialize(new Uint8Array(bytes)).signatures[0]))
 vi.spyOn(Connection.prototype,'getSignatureStatuses').mockResolvedValue({context:{slot:1},value:[{slot:1,confirmations:1,err:null,confirmationStatus:'confirmed'}]})
 return {creator,buyer,config,connection,resolveSigners,send,lock:()=>{unlocked=false}}
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();builders.create.mockReset();builders.buy.mockReset()})
describe('bundle signer freshness at asynchronous boundaries',()=>{
 it('saves immutable original submission context before an unknown send and cannot lose it through public callback mutation',async()=>{
  const h=setup(),values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  builders.create.mockImplementation(params=>consumerLaunchPlan({...params,metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58()))
  let original:BundleResult['submissions']
  const transport=vi.spyOn(sender,'sendAndConfirmTransaction').mockImplementation(async(_connection,packet,options)=>{options?.onBroadcast?.();const pending=readPendingBundleReceipt(storage)!;expect(pending.status).toBe('unknown');expect(pending.submissions).toHaveLength(1);expect(pending.submissions![0]).toMatchObject({signature:sender.signedTransactionSignature(packet),payer:h.creator.publicKey.toBase58(),blockhash:packet.message.recentBlockhash,expiresAfterBlockHeight:660});original=structuredClone(pending.submissions);return{signature:sender.signedTransactionSignature(packet),status:'unknown',submitted:true}})
  const result=await executeBundleLaunch(h.config,()=>{},{connection:h.connection,resolveSigners:h.resolveSigners,onReceipt:receipt=>{persistBundleCheckpoint(receipt,storage);if(receipt.submissions)receipt.submissions[0].blockhash=Keypair.generate().publicKey.toBase58()}})
  expect(result.status).toBe('unknown');expect(transport).toHaveBeenCalledOnce();expect(result.submissions).toEqual(original);expect(readPendingBundleReceipt(storage)?.submissions).toEqual(original)
  expect(()=>persistBundleCheckpoint({...result,submissions:result.submissions!.map(value=>({...value,expiresAfterBlockHeight:value.expiresAfterBlockHeight+1}))},storage)).toThrow(/original|expiry/i)
 })
 it('accepts the canonical casing returned for the selected GitHub individual before atomic preparation',async()=>{
  const value=setup();vi.mocked(fetchGitHubIndividual).mockResolvedValueOnce({username:'Alice',userId:'12345',profileUrl:'https://github.com/Alice',accountType:'User'})
  builders.create.mockImplementation(params=>consumerLaunchPlan({...params,metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58()))
  const result=await executeBundleLaunch({...value.config,creatorFeeSelection:{kind:'github',username:'alice'}},status=>{if(status.startsWith('Building atomic launch'))throw new Error('Canonical recipient accepted before signing')},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.error).toBe('Canonical recipient accepted before signing');expect(value.send).not.toHaveBeenCalled()
 })
 it.each([{kind:'wallet' as const,address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards' as const}])('rejects a builder that replaces selected %s with the deployer route',async creatorFeeSelection=>{
  const value=setup();builders.create.mockImplementation(params=>consumerLaunchPlan({...params,creatorFeeSelection:{kind:'deployer'},metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58()))
  const result=await executeBundleLaunch({...value.config,creatorFeeSelection},()=>{},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.error).toMatch(/recipient differs/);expect(value.send).not.toHaveBeenCalled()
 })
 it('binds an explicit wallet recipient once at creation and retains it in the public result',async()=>{
  const value=setup(),recipient=Keypair.generate().publicKey.toBase58(),seen:unknown[]=[]
  builders.create.mockImplementation(params=>{seen.push(params.creatorFeeSelection);return consumerLaunchPlan({...params,metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58())})
  const result=await executeBundleLaunch({...value.config,creatorFeeSelection:{kind:'wallet',address:recipient}},()=>{},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.success).toBe(true);expect(seen).toEqual([{kind:'wallet',address:recipient}])
  expect(result.creatorFeeRouting?.effectiveCreator).toBe(recipient)
 })
 it('measures GitHub setup overhead before signing and rejects too many immediate buyers',async()=>{
  const value=setup(),buyers=Array.from({length:3},(_,index)=>{const key=Keypair.generate();return {...useBundlerStore.getState().bundleWallets[index],privateKey:bs58.encode(key.secretKey),publicKey:key.publicKey.toBase58(),buyAmount:0.01}})
  builders.create.mockImplementation(params=>consumerLaunchPlan(params,Keypair.generate().publicKey.toBase58()))
  const result=await executeBundleLaunch({...value.config,tokenName:'N'.repeat(32),tokenSymbol:'S'.repeat(10),devBuyAmount:0.01,creatorFeeSelection:{kind:'github',username:'Octocat'},sniperMode:'block0',bundleWallets:buyers},()=>{},{connection:value.connection,metadataUri:'https://example.com/'.padEnd(200,'x')})
  expect(result.status).toBe('failed');expect(result.error).toMatch(/supports at most 2 additional buyers/)
  expect(value.send).not.toHaveBeenCalled();expect(result.submittedSignatures).toEqual([])
 })
 it('keeps a zero tip reserve from silently enabling atomic GitHub setup',async()=>{
  const value=setup();builders.create.mockImplementation(params=>consumerLaunchPlan(params,Keypair.generate().publicKey.toBase58()))
  const result=await executeBundleLaunch({...value.config,jitoTip:0,creatorFeeSelection:{kind:'github',username:'Octocat'}},()=>{},{connection:value.connection,metadataUri:'https://example.com/token.json'})
  expect(result.status).toBe('failed');expect(result.error).toMatch(/tip/i);expect(value.send).not.toHaveBeenCalled()
 })
 it('stops before signing or broadcasting when a group locks during native construction',async()=>{
  const value=setup();let built:VersionedTransaction|undefined
  builders.create.mockImplementation(async params=>{built=transaction(new PublicKey(params.userPublicKey),params.mintKeypair.publicKey);value.lock();return {success:true,transaction:built,nativeContext:{},metadataUri:'https://example.com/meta'}})
  const result=await executeBundleLaunch(value.config,()=>{},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.error).toMatch(/locked|changed/i)
  expect(result.status).toBe('failed')
  expect(value.send).not.toHaveBeenCalled()
  expect(built?.signatures.every(signature=>signature.every(byte=>byte===0))).toBe(true)
 })
 it('uses callback keys with empty managed key strings',async()=>{
  const value=setup()
  builders.create.mockImplementation(params=>consumerLaunchPlan({...params,metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58()))
  const result=await executeBundleLaunch({...value.config,creatorPrivateKey:'',managedCreatorWalletId:'creator'},()=>{},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.success).toBe(true)
  expect(result.submissions).toEqual([{signature:result.createSignature,payer:value.creator.publicKey.toBase58(),blockhash:expect.any(String),expiresAfterBlockHeight:660,submittedAt:expect.any(String)}])
  expect(value.send).toHaveBeenCalledTimes(1)
 })
 it('preserves a confirmed create receipt if the group locks while preparing a buy',async()=>{
  const value=setup()
  builders.create.mockImplementation(params=>consumerLaunchPlan({...params,metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58()))
  builders.buy.mockImplementation(async()=>{value.lock();return transaction(value.buyer.publicKey)})
  const row={...useBundlerStore.getState().bundleWallets[0],privateKey:bs58.encode(value.buyer.secretKey),publicKey:value.buyer.publicKey.toBase58(),buyAmount:0.01,sellEnabled:false}
  const result=await executeBundleLaunch({...value.config,bundleWallets:[row]},()=>{},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.status).toBe('partial')
  expect(result.error).toMatch(/locked|changed/i)
  expect(result.submittedSignatures).toEqual([result.createSignature])
  expect(value.send).toHaveBeenCalledTimes(1)
 })
 it('rechecks the unlocked group after atomic simulation at the actual Jito broadcast boundary',async()=>{
  const value=setup();let broadcasts=0
  vi.spyOn(Connection.prototype,'getLatestBlockhash').mockResolvedValue({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100})
  builders.create.mockImplementation(params=>consumerLaunchPlan({...params,metadataUri:'https://example.com/meta'},Keypair.generate().publicKey.toBase58()))
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{
   const body=JSON.parse(String(init.body))
   if(body.method==='simulateBundle'){value.lock();return Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null},{err:null}]}}})}
   broadcasts++;return Response.json({result:'never-submit'})
  })
  const result=await executeBundleLaunch({...value.config,sniperMode:'block0'},()=>{},{connection:value.connection,resolveSigners:value.resolveSigners})
  expect(result.status).toBe('failed')
  expect(result.error).toMatch(/locked|changed/i)
  expect(result.submittedSignatures).toEqual([])
  expect(broadcasts).toBe(0)
  expect(value.send).not.toHaveBeenCalled()
 })
})
