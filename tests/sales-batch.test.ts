import {describe,it,expect,vi} from 'vitest'
import {Connection,Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {prepareSaleBatch,executeSaleBatch,type SaleRequest,type SaleBatchPorts} from '../src/lib/sales/batch'
import type {PreparedMarketSale} from '../src/lib/sales/market'
import {readTradePending,saveTradeReceipt} from '../src/lib/venues/tradeHistory'
import {readSaleHistory,reconcileSaleHistory} from '../src/lib/sales/history'

function harness(){
 const key=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58(),data=new Map<string,string>()
 const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}
 let now=1_000_000,available=true,proceeds='100000',debit='5000',amount='100'
 const request:SaleRequest={walletId:'wallet-one',walletName:'Source',payer:key.publicKey.toBase58(),mint,amountRaw:'100',decimals:6,tokenProgram:TOKEN_PROGRAM_ID.toBase58()}
 const prepare=vi.fn(async(_connection:Connection,input:PreparedMarketSale['input'])=>{
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:key.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message())
  return {input:{...input,amountRaw:amount},payer:input.payer,mint:input.mint,amountRaw:amount,transaction:tx,message:Buffer.from(tx.message.serialize()).toString('base64'),route:'pump',tokenAccount:Keypair.generate().publicKey.toBase58(),minimumSolOut:proceeds,estimatedSolOut:proceeds,estimatedNetSolOut:'95000',networkFeeLamports:'5000',maxDebitLamports:debit,createdAt:now,lastValidBlockHeight:1000} as PreparedMarketSale
 })
 const send=vi.fn(async(_c:Connection,tx:VersionedTransaction,options:{onBroadcast?:()=>void})=>{options.onBroadcast?.();expect(readTradePending(storage)).not.toBeNull();const {signedTransactionSignature}=await import('../src/lib/transactions/send');return {status:'confirmed' as const,submitted:true,signature:signedTransactionSignature(tx)}})
 const ports:SaleBatchPorts={prepare,assert:()=>{},simulateSigned:async()=>({walletBeforeLamports:'10000000',netDebitLamports:'0',networkFeeLamports:'5000'}),send,now:()=>now,storage,assertAvailable:()=>{},locks:{request:async(_n,_o,fn)=>fn({})}}
 const connection={getBalance:async()=>10000000,getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',isBlockhashValid:async()=>({value:true})} as unknown as Connection
 const signer={approved:true as const,readSigner:()=>available?key.publicKey.toBase58():null,sign:async(_id:string,tx:VersionedTransaction)=>{tx.sign([key]);return tx}}
 return {request,ports,connection,signer,storage,prepare,send,key,setAvailable:(v:boolean)=>{available=v},setNow:(v:number)=>{now=v},setProceeds:(v:string)=>{proceeds=v},setDebit:(v:string)=>{debit=v},setAmount:(v:string)=>{amount=v}}
}
describe('reviewed per-wallet sale batches',()=>{
 it('passes each original minimum to native refresh so self-induced market movement cannot weaken the approved on-chain floor',async()=>{
  const h=harness(),review=await prepareSaleBatch(h.connection,[h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports),original=h.ports.prepare,seen:(string|undefined)[]=[]
  h.setProceeds('99000')
  h.ports.prepare=async(connection,input,reviewedMinimumSolOut?:string)=>{seen.push(reviewedMinimumSolOut);const plan=await original(connection,input);return {...plan,minimumSolOut:reviewedMinimumSolOut??plan.minimumSolOut}}
  const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
  expect(seen).toEqual(['100000']);expect(result.status,result.error).toBe('completed');expect(h.send).toHaveBeenCalledOnce()
 })
 it('prepares exact public bounds and sends sequentially with recovery saved before broadcast',async()=>{
  const h=harness(),second={...h.request,mint:Keypair.generate().publicKey.toBase58()}
  const review=await prepareSaleBatch(h.connection,[h.request,second],{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  expect(review.rows).toHaveLength(2);expect(review.rows[0]).toMatchObject({status:'ready',amountRaw:'100',minimumSolOut:'100000'})
  const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
  expect(result.status).toBe('completed');expect(h.send).toHaveBeenCalledTimes(2);expect(readTradePending(h.storage)).toBeNull()
  expect(readSaleHistory(h.storage)[0].rows.every(row=>row.status==='confirmed')).toBe(true)
  await expect(executeSaleBatch(h.connection,review,h.signer,h.ports)).rejects.toThrow(/used|review/i)
 })
 it('keeps unavailable assets visible and never submits them',async()=>{
  const h=harness(),original=h.ports.prepare
  h.ports.prepare=async(c,input)=>{if(input.mint!==h.request.mint)throw new Error('No market route.');return original(c,input)}
  const review=await prepareSaleBatch(h.connection,[h.request,{...h.request,mint:Keypair.generate().publicKey.toBase58()}],{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  expect(review.rows[1]).toMatchObject({status:'unavailable',error:'No market route.'})
  const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
  expect(result.status).toBe('partial');expect(h.send).toHaveBeenCalledOnce()
 })
 it.each(['minimum','fee','amount'])('refuses a fresh %s that weakens the approved sale',async boundary=>{
  const h=harness(),review=await prepareSaleBatch(h.connection,[h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  if(boundary==='minimum')h.setProceeds('99999');else if(boundary==='fee')h.setDebit('5001');else h.setAmount('101')
  const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
  expect(result.status).toBe('failed');expect(h.send).not.toHaveBeenCalled()
 })
 it('stops when a wallet locks after signing and rejects an altered signed message',async()=>{
  for(const change of ['lock','message']){
   const h=harness(),review=await prepareSaleBatch(h.connection,[h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports),original=h.signer.sign
   h.signer.sign=async(id,tx)=>{const result=await original(id,tx);if(change==='lock')h.setAvailable(false);else result.message.recentBlockhash=Keypair.generate().publicKey.toBase58();return result}
   const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
   expect(result.status).toBe('failed');expect(h.send).not.toHaveBeenCalled()
  }
 })
 it('preserves the original unknown signature and leaves later tokens unsent',async()=>{
  const h=harness(),second={...h.request,mint:Keypair.generate().publicKey.toBase58()}
  h.ports.send=async(c,tx,opts)=>{const result=await h.send(c,tx,opts);return {...result,status:'unknown'}}
  const review=await prepareSaleBatch(h.connection,[h.request,second],{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
  expect(result.status).toBe('unknown');expect(h.send).toHaveBeenCalledOnce();expect(result.rows[1].status).toBe('ready')
  expect(readTradePending(h.storage)?.signature).toBe(result.rows[0].signature)
 })
 it('refuses storage failure, cancellation, expired review and busy cross-tab lock before submission',async()=>{
  for(const condition of ['storage','cancel','expired','busy']){
   const h=harness(),review=await prepareSaleBatch(h.connection,[h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports),controller=new AbortController()
   if(condition==='storage')h.storage.setItem=()=>{throw new Error('Storage failed')}
   if(condition==='cancel')controller.abort()
   if(condition==='expired')h.setNow(2_000_000)
   if(condition==='busy')h.ports.locks={request:async(_n,_o,fn)=>fn(null)}
   await executeSaleBatch(h.connection,review,{...h.signer,signal:controller.signal},h.ports).catch(()=>{})
   expect(h.send).not.toHaveBeenCalled()
  }
 })
 it('rejects duplicate requests and preparation results for a different owner',async()=>{
  const h=harness()
  await expect(prepareSaleBatch(h.connection,[h.request,h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports)).rejects.toThrow(/distinct|duplicate/i)
  const original=h.ports.prepare;h.ports.prepare=async(c,input)=>({...await original(c,input),payer:Keypair.generate().publicKey.toBase58()})
  const review=await prepareSaleBatch(h.connection,[h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  expect(review.rows[0].status).toBe('unavailable')
 })
 it('updates an interrupted sale batch only from matching resolved original trade receipts',async()=>{
  const h=harness();h.ports.send=async(c,tx,opts)=>({...await h.send(c,tx,opts),status:'unknown'})
  const review=await prepareSaleBatch(h.connection,[h.request],{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  const result=await executeSaleBatch(h.connection,review,h.signer,h.ports)
  expect(result.status).toBe('unknown')
  saveTradeReceipt(readTradePending(h.storage)!,'confirmed',undefined,h.storage)
  const recovered=reconcileSaleHistory(h.storage)
  expect(recovered[0].status).toBe('completed');expect(recovered[0].rows[0].status).toBe('confirmed');expect(h.send).toHaveBeenCalledOnce()
 })
})
