import {describe,expect,it} from 'vitest'
import {Connection,Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {prepareCreatorOperation,submitCreatorOperation,type CreatorOperationPorts} from '../src/lib/creatorOperations/engine'
import {reconcileCreatorOperationRecord} from '../src/lib/creatorOperations/recovery'
import {CREATOR_PENDING_KEY,readPendingCreatorOperation,readCreatorOperationHistory,savePendingCreatorOperation,type PendingCreatorOperation} from '../src/lib/creatorOperations/history'
import {signedTransactionSignature} from '../src/lib/transactions/send'
import type {CreatorOperationInput,CreatorState} from '../src/lib/creatorOperations/model'

function fixture(){
 const payer=Keypair.generate(),wallet=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),blockhash=Keypair.generate().publicKey.toBase58(),disk=new Map<string,string>()
 const storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}}
 const state:CreatorState={mint,creator:payer.publicKey.toBase58(),slot:100,checkedAt:100000,complete:false,holderReward:false,cashback:false,curveFeeLamports:'0',vaultBalanceLamports:'1000000'}
 const input:CreatorOperationInput={version:1,kind:'shares',mint,payer:state.creator,priorityFeeLamports:'0',shares:[{address:wallet,shareBps:10000}]}
 let signer:string|null=state.creator,now=100000,sends=0,signs=0
 const connection={getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:500}),isBlockhashValid:async()=>({value:true})} as unknown as Connection
 const ports:Partial<CreatorOperationPorts>={now:()=>now,storage,locks:{request:async(_name,_options,action)=>action({})},readState:async()=>structuredClone(state),simulate:async()=>({payerBeforeLamports:'10000000',payerAfterLamports:'9000000',maxDebitLamports:'1000000',networkFeeLamports:'5000',existingWrappedSolLamports:'0',recipientChanges:[{address:state.creator,changeLamports:'-1000000'}],lookupRentLamports:'0'}),send:async(_connection,tx,options)=>{options.onBroadcast?.();sends++;expect(readPendingCreatorOperation(storage)?.signature).toBe(signedTransactionSignature(tx));return{status:'confirmed',signature:signedTransactionSignature(tx),submitted:true}}}
 const options={approved:true,readSigner:()=>signer,signTransaction:async(tx:VersionedTransaction)=>{signs++;tx.sign([payer]);return tx}}
 return{payer,wallet,input,state,connection,storage,disk,ports,options,setSigner:(value:string|null)=>{signer=value},setNow:(value:number)=>{now=value},sends:()=>sends,signs:()=>signs}
}
describe('reviewed creator operations',()=>{
 it('signs exactly once and saves the public original before broadcasting native fee shares',async()=>{
  const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports)
  const result=await submitCreatorOperation(f.connection,review,f.options,f.ports)
  expect(result.status).toBe('confirmed');expect(f.signs()).toBe(1);expect(f.sends()).toBe(1)
  expect(readPendingCreatorOperation(f.storage)).toBeNull();expect(readCreatorOperationHistory(f.storage)[0].intent.input).toEqual(f.input)
  await expect(submitCreatorOperation(f.connection,review,f.options,f.ports)).rejects.toThrow(/used|fresh/i)
 })
 it('refuses locked signers at preparation, after wallet approval and after signed simulation',async()=>{
  for(const step of ['prepare','sign','simulate']){
   const f=fixture()
   if(step==='prepare')f.setSigner(null)
   if(step==='prepare'){await expect(prepareCreatorOperation(f.connection,f.input,f.options,f.ports)).rejects.toThrow(/wallet/i);continue}
   const review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports)
   if(step==='sign'){const original=f.options.signTransaction;f.options.signTransaction=async tx=>{const result=await original(tx);f.setSigner(null);return result}}
   if(step==='simulate'){const original=f.ports.simulate!;f.ports.simulate=async(...args)=>{const value=await original(...args);f.setSigner(null);return value}}
   await expect(submitCreatorOperation(f.connection,review,f.options,f.ports)).rejects.toThrow(/wallet/i)
   expect(f.sends()).toBe(0);expect(readPendingCreatorOperation(f.storage)).toBeNull()
  }
 })
 it('retains unknown original signatures after a lost send response and never repeats the review',async()=>{
  const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports)
  f.ports.send=async(_connection,_tx,options)=>{options.onBroadcast?.();throw new Error('Response lost')}
  const result=await submitCreatorOperation(f.connection,review,f.options,f.ports)
  expect(result.status).toBe('unknown');expect(readPendingCreatorOperation(f.storage)?.signature).toBe(result.signature)
  await expect(prepareCreatorOperation(f.connection,f.input,f.options,f.ports)).rejects.toThrow(/pending/i)
  await expect(submitCreatorOperation(f.connection,review,f.options,f.ports)).rejects.toThrow()
 })
 it('rejects mutated public review, signed messages and a simulation exceeding reviewed costs',async()=>{
  for(const step of ['review','message','simulation']){
   const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports)
   if(step==='review')review.preview.maxDebitLamports='999999999'
   if(step==='message')f.options.signTransaction=async tx=>{tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.sign([f.payer]);return tx}
   if(step==='simulation')f.ports.simulate=async()=>({...review.preview,payerAfterLamports:'8999999',maxDebitLamports:'1000001'})
   await expect(submitCreatorOperation(f.connection,review,f.options,f.ports)).rejects.toThrow()
   expect(f.sends()).toBe(0)
  }
 })
 it('refuses stale authority, expired review, cancellation and corrupt existing journals before signing',async()=>{
  for(const step of ['authority','expiry','cancel','corrupt']){
   const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports),abort=new AbortController()
   if(step==='authority')f.state.creator=f.wallet
   if(step==='expiry')f.setNow(161000)
   if(step==='cancel')abort.abort()
   if(step==='corrupt')f.disk.set(CREATOR_PENDING_KEY,'{')
   await expect(submitCreatorOperation(f.connection,review,{...f.options,signal:abort.signal},f.ports)).rejects.toThrow()
   expect(f.signs()).toBe(0);expect(f.sends()).toBe(0)
  }
 })
 it('rechecks storage hooks and clears only its unsubmitted original if the signer locks at the last boundary',async()=>{
  const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports),original=f.storage.setItem
  f.storage.setItem=(key,value)=>{original(key,value);if(key===CREATOR_PENDING_KEY)f.setSigner(null)}
  await expect(submitCreatorOperation(f.connection,review,f.options,f.ports)).rejects.toThrow()
  expect(f.sends()).toBe(0);expect(readPendingCreatorOperation(f.storage)).toBeNull()
 })
 it('rechecks review expiry after durable-storage hooks before allowing the broadcast',async()=>{
  const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports),original=f.storage.setItem
  f.storage.setItem=(key,value)=>{original(key,value);if(key===CREATOR_PENDING_KEY)f.setNow(161000)}
  await expect(submitCreatorOperation(f.connection,review,f.options,f.ports)).rejects.toThrow(/expired/i)
  expect(f.sends()).toBe(0);expect(readPendingCreatorOperation(f.storage)).toBeNull()
 })
 it('blocks creator preparation on unresolved or corrupt supply-lock recovery without overwriting it',async()=>{
  for(const raw of ['{broken',JSON.stringify({version:1,intent:{},signature:'original',lastValidBlockHeight:200})]){
   const f=fixture();f.disk.set('outsol-supply-lock-pending-v1',raw)
   await expect(prepareCreatorOperation(f.connection,f.input,f.options,f.ports)).rejects.toThrow(/supply lock/i)
   expect(f.disk.get('outsol-supply-lock-pending-v1')).toBe(raw);expect(f.signs()).toBe(0);expect(f.sends()).toBe(0)
  }
 })
})

describe('creator operation original-signature recovery',()=>{
 async function pending(){const f=fixture(),review=await prepareCreatorOperation(f.connection,f.input,f.options,f.ports);f.ports.send=async(_connection,tx,options)=>{options.onBroadcast?.();return{status:'unknown',signature:signedTransactionSignature(tx),submitted:true}};await submitCreatorOperation(f.connection,review,f.options,f.ports);return f}
 it('resolves confirmed originals without constructing or submitting another transaction',async()=>{
  const f=await pending(),connection={getSignatureStatuses:async()=>({value:[{confirmationStatus:'confirmed',err:null}]})} as unknown as Connection
  const result=await reconcileCreatorOperationRecord(connection,{storage:f.storage})
  expect(result.status).toBe('confirmed');expect(readPendingCreatorOperation(f.storage)).toBeNull();expect(readCreatorOperationHistory(f.storage)).toHaveLength(1)
 })
 it('preserves processed failures and incomplete finalized details until trustworthy finality evidence exists',async()=>{
  const f=await pending();let reads=0
  const connection={getSignatureStatuses:async()=>({value:[++reads===1?{confirmationStatus:'processed',err:{InstructionError:1}}:null]}),isBlockhashValid:async()=>({value:false}),getBlockHeight:async()=>1000,getTransaction:async()=>({meta:null})} as unknown as Connection
  expect((await reconcileCreatorOperationRecord(connection,{storage:f.storage})).status).toBe('unknown')
  expect((await reconcileCreatorOperationRecord(connection,{storage:f.storage})).status).toBe('unknown')
  expect(readPendingCreatorOperation(f.storage)).not.toBeNull()
 })
 it('requires finalized expiry plus two absent history reads before releasing an unobserved original',async()=>{
  const f=await pending(),connection={getSignatureStatuses:async()=>({value:[null]}),isBlockhashValid:async()=>({value:false}),getBlockHeight:async()=>501,getTransaction:async()=>null} as unknown as Connection
  expect((await reconcileCreatorOperationRecord(connection,{storage:f.storage})).status).toBe('failed')
  expect(readCreatorOperationHistory(f.storage)[0].error).toMatch(/expired/i)
 })
 it('does not overwrite a replacement record appearing during an awaited chain lookup',async()=>{
  const f=await pending(),first=readPendingCreatorOperation(f.storage)!,replacement:PendingCreatorOperation={...first,signature:signedTransactionSignature((()=>{const tx=new VersionedTransaction(reviewTransaction(first,f.payer));tx.sign([f.payer]);return tx})())}
  const connection={getSignatureStatuses:async()=>{f.storage.removeItem(CREATOR_PENDING_KEY);savePendingCreatorOperation(replacement,f.storage);return{value:[{confirmationStatus:'confirmed',err:null}]}}} as unknown as Connection
  expect((await reconcileCreatorOperationRecord(connection,{storage:f.storage})).status).toBe('changed')
  expect(readPendingCreatorOperation(f.storage)?.signature).toBe(replacement.signature)
 })
})
function reviewTransaction(_record:PendingCreatorOperation,payer:Keypair){
 // A second native message provides a distinct, real signature for the recovery race.
 return new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]}).compileToV0Message()
}
