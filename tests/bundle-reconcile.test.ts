import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {reconcileBundleReceipt,settleMatchingLaunchPending} from '../src/lib/bundler/reconcile'
import {persistBundleCheckpoint,readPendingBundleReceipt} from '../src/lib/bundler/pending'
import {readPending,savePending} from '../src/lib/launchHistory'
import type {BundleResult} from '../src/lib/bundler/types'
import {resolveCreatorFeeRouting} from '../src/lib/creatorFeeRouting'
const signature=(n:number)=>bs58.encode(new Uint8Array(64).fill(n))
const confirmed={slot:1,confirmations:null,err:null,confirmationStatus:'finalized' as const}
function fixture(){
 const payer=Keypair.generate().publicKey.toBase58(),mintAddress=Keypair.generate().publicKey.toBase58(),blockhash=Keypair.generate().publicKey.toBase58(),signatures=[signature(4),signature(5)]
 const receipt:BundleResult={success:false,status:'unknown',mintAddress,createSignature:signatures[0],submittedSignatures:signatures,buySignatures:[],submissions:signatures.map(value=>({signature:value,payer,blockhash,expiresAfterBlockHeight:100,submittedAt:'2026-10-27T00:00:00.000Z'}))}
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
 vi.stubGlobal('localStorage',storage)
 return {receipt,payer,mintAddress,blockhash,signatures,storage,values}
}
function connection(statuses:Record<string,typeof confirmed|null|{slot:number;confirmations:null;err:{InstructionError:unknown[]};confirmationStatus:'finalized'}>,overrides:Record<string,unknown>={}){return {getSignatureStatuses:async(signatures:string[],options:unknown)=>{expect(options).toEqual({searchTransactionHistory:true});return {value:signatures.map(signature=>statuses[signature]??null)}},getBlockHeight:async(commitment:string)=>{expect(commitment).toBe('finalized');return 101},isBlockhashValid:async(_hash:string,options:unknown)=>{expect(options).toEqual({commitment:'finalized'});return {value:false}},getAccountInfo:async()=>null,...overrides} as unknown as Connection}
afterEach(()=>vi.unstubAllGlobals())
describe('bounded public bundle reconciliation',()=>{
 it.each(['route','missing-route','payer','blockhash'])('preserves a launch gate when bundle recovery has different %s evidence',async kind=>{
  const f=fixture(),routing=resolveCreatorFeeRouting({selection:{kind:'deployer'},payer:f.payer,mint:f.mintAddress})
  f.receipt.creatorFeeRouting=routing
  const pending={mode:'standard' as const,venue:'pump' as const,mint:f.mintAddress,payer:f.payer,blockhash:f.blockhash,signatures:f.signatures,submittedAt:'2026-10-27T00:00:00.000Z',expiresAfterBlockHeight:100,creatorFeeRouting:routing}
  if(kind==='route')pending.creatorFeeRouting=resolveCreatorFeeRouting({selection:{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},payer:f.payer,mint:f.mintAddress})
  if(kind==='missing-route')delete f.receipt.creatorFeeRouting
  if(kind==='payer')f.receipt.submissions![0].payer=Keypair.generate().publicKey.toBase58()
  if(kind==='blockhash')f.receipt.submissions![0].blockhash=Keypair.generate().publicKey.toBase58()
  savePending(pending)
  const outcome=await reconcileBundleReceipt(connection(Object.fromEntries(f.signatures.map(value=>[value,confirmed]))),f.receipt)
  settleMatchingLaunchPending(outcome)
  expect(readPending()).not.toBeNull()
 })
 it('keeps malformed confirmed history unknown instead of treating a missing error field as success',async()=>{
  const f=fixture(),outcome=await reconcileBundleReceipt(connection({},{getSignatureStatuses:async()=>({value:[{slot:1,confirmationStatus:'finalized'},confirmed]})}),f.receipt)
  expect(outcome.receipt.status).toBe('unknown')
  expect(outcome.confirmedSignatures).not.toContain(f.signatures[0])
 })
 it('unblocks an expired absent future buy while preserving confirmed creation and every original signature',async()=>{
  const f=fixture();persistBundleCheckpoint(f.receipt,f.storage)
  const outcome=await reconcileBundleReceipt(connection({[f.signatures[0]]:confirmed}),f.receipt)
  expect(outcome.receipt.status).toBe('partial');expect(outcome.creationStatus).toBe('confirmed');expect(outcome.receipt.error).toMatch(/expired|did not land/i)
  expect(outcome.receipt.submittedSignatures).toEqual(f.signatures);expect(outcome.receipt.submissions).toEqual(f.receipt.submissions)
  persistBundleCheckpoint(outcome.receipt,f.storage);expect(readPendingBundleReceipt(f.storage)).toBeNull()
 })
 it('clears both initial expiry gates only after every original signature is absent past finalized expiry',async()=>{
  const f=fixture();persistBundleCheckpoint(f.receipt,f.storage);savePending({mode:'standard',venue:'pump',mint:f.mintAddress,payer:f.payer,blockhash:f.blockhash,signatures:f.signatures,submittedAt:'2026-10-27T00:00:00.000Z',expiresAfterBlockHeight:100})
  const outcome=await reconcileBundleReceipt(connection({}),f.receipt)
  expect(outcome.receipt.status).toBe('failed');expect(outcome.creationStatus).toBe('expired')
  persistBundleCheckpoint(outcome.receipt,f.storage);settleMatchingLaunchPending(outcome)
  expect(readPending()).toBeNull();expect(readPendingBundleReceipt(f.storage)).toBeNull();expect(outcome.receipt.submittedSignatures).toEqual(f.signatures)
 })
 it('keeps ambiguous history and expiry failures unknown without removing either gate',async()=>{
  const f=fixture();persistBundleCheckpoint(f.receipt,f.storage)
  for(const overrides of [{getBlockHeight:async()=>{throw new Error('RPC unavailable')}},{isBlockhashValid:async()=>({value:true})},{getSignatureStatuses:async()=>({value:[null]})},{getBlockHeight:async()=>100}]){
   const outcome=await reconcileBundleReceipt(connection({},overrides),f.receipt);expect(outcome.receipt.status).toBe('unknown');expect(outcome.receipt.submittedSignatures).toEqual(f.signatures)
  }
  expect(readPendingBundleReceipt(f.storage)?.status).toBe('unknown')
 })
 it('classifies explicit failure by the creation signature instead of a later confirmed packet',async()=>{
  const f=fixture(),failed={...confirmed,err:{InstructionError:[0,'Custom']}}
  expect((await reconcileBundleReceipt(connection({[f.signatures[0]]:failed,[f.signatures[1]]:confirmed}),f.receipt)).receipt.status).toBe('failed')
  expect((await reconcileBundleReceipt(connection({[f.signatures[0]]:confirmed,[f.signatures[1]]:failed}),f.receipt)).receipt.status).toBe('partial')
 })
 it('does not fabricate expiry for legacy receipts and never labels an existing mint as an absent creation',async()=>{
  const f=fixture(),legacy={...f.receipt,submissions:undefined}
  const unknown=await reconcileBundleReceipt(connection({}),legacy);expect(unknown.receipt.status).toBe('unknown');expect(unknown.receipt.error).toMatch(/legacy|expiry/i);expect(unknown.receipt.submissions).toBeUndefined()
  expect((await reconcileBundleReceipt(connection({},{getAccountInfo:async()=>({lamports:1})}),f.receipt)).receipt.status).toBe('unknown')
 })
 it('rechecks history after expiry and retains a signature that appeared during the expiry check',async()=>{
  const f=fixture();let calls=0
  const c=connection({},{getSignatureStatuses:async(signatures:string[])=>({value:signatures.map(()=>++calls<=2?null:confirmed)})})
  const outcome=await reconcileBundleReceipt(c,f.receipt);expect(outcome.receipt.status).toBe('partial');expect(outcome.receipt.error).toMatch(/not resumed/i);expect(outcome.confirmedSignatures).toEqual(f.signatures)
 })
 it('rejects tampered public submission bindings and preserves expiry context once unknown evidence is saved',()=>{
  const f=fixture();persistBundleCheckpoint(f.receipt,f.storage)
  expect(()=>persistBundleCheckpoint({...f.receipt,submissions:f.receipt.submissions!.map(item=>({...item,expiresAfterBlockHeight:1}))},f.storage)).toThrow(/context|expiry|changed/i)
  expect(()=>persistBundleCheckpoint({...f.receipt,submissions:[{...f.receipt.submissions![0],signature:signature(9)}]},f.storage)).toThrow()
  expect(()=>persistBundleCheckpoint({...f.receipt,submissions:undefined},f.storage)).toThrow(/context|expiry|discard|changed/i)
 })
})
