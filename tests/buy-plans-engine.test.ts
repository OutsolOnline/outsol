import {describe,expect,it} from 'vitest'
import {Connection,Keypair,PublicKey} from '@solana/web3.js'
import {buildFreshNativeBuy} from '../src/lib/pumpfun/api'
import {consumerLaunchPlan} from './helpers/consumerLaunchPlan'
import {prepareBuyPlan,executeBuyPlan,type BuyPlanPorts} from '../src/lib/buyPlans/engine'
import {readBuyPlanJournals,reconcileBuyPlanJournals,saveBuyPlanJournal} from '../src/lib/buyPlans/history'
import {readTradePending} from '../src/lib/venues/tradeHistory'
import type {BuyPlan} from '../src/lib/buyPlans/model'
import {signedTransactionSignature} from '../src/lib/transactions/send'
import bs58 from 'bs58'

async function harness(){
 const creator=Keypair.generate(),mint=Keypair.generate(),buyers=[Keypair.generate(),Keypair.generate()],blockhash=Keypair.generate().publicKey.toBase58(),values=new Map<string,string>()
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
 let time=1000,locked=false,broadcasts=0,unknown=false
 const plan:BuyPlan={version:1,id:crypto.randomUUID(),name:'Staged',mint:mint.publicKey.toBase58(),createdAt:1000,updatedAt:1000,mode:'sequence',order:'listed',intervalSeconds:2,slippage:5,priorityFeeSol:'0.0001',maxTotalDebitSol:'0.05',rows:buyers.map((buyer,index)=>({id:`row-${index}`,walletId:`wallet-${index}`,publicKey:buyer.publicKey.toBase58(),name:`Buyer ${index}`,buySol:'0.01',maxDebitSol:'0.025',delaySeconds:index}))}
 const launch=await consumerLaunchPlan({userPublicKey:creator.publicKey.toBase58(),mintKeypair:mint,metadata:{name:'Test',symbol:'TEST',description:''},metadataUri:'ipfs://test'},blockhash)
 const connection={getGenesisHash:async()=>'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getBalance:async()=>1_000_000_000,isBlockhashValid:async()=>({context:{slot:1},value:true}),getBlockHeight:async()=>100,getFeeForMessage:async()=>({value:105000}),getSignatureStatuses:async()=>({value:[{confirmationStatus:'finalized',err:null}]})} as unknown as Connection
 const options={storage,locks:{request:async<T,>(_name:string,_opts:unknown,callback:(lock:object)=>Promise<T>)=>callback({})},readKeypair:(id:string)=>locked?null:buyers[Number(id.split('-')[1])]??null,assertCurrent:()=>{},approved:true as const}
 const ports:Partial<BuyPlanPorts>={now:()=>time,wait:async ms=>{time+=ms},assertAvailable:()=>{},build:async(_connection,row)=>{
  const built=await buildFreshNativeBuy({context:launch.nativeContext!,mint:mint.publicKey,payer:new PublicKey(row.publicKey),metadata:{name:'Test',symbol:'TEST',uri:'ipfs://test'},maxBuyLamports:10_000_000n,blockhash,priorityFee:0.0001})
  return {transaction:built.transaction,creator:creator.publicKey.toBase58(),protocolFeeRecipients:launch.launchPlan!.protocolFeeRecipients}
 },simulate:async(_connection,_transactions,opts)=>({success:true,payerDebitLamports:'12000000',walletDebitsLamports:{[opts!.payer!]:'12000000'},tokenAccountDeltasRaw:Object.fromEntries(opts!.tokenAccounts!.map(row=>[row.address,row.expectedDeltaRaw]))}),send:async(_connection,tx,opts)=>{opts?.onBroadcast?.();broadcasts++;return {status:unknown?'unknown':'confirmed',signature:signedTransactionSignature(tx),submitted:true}}}
 return {plan,connection,options,ports,storage,buyers,lock:()=>{locked=true},setUnknown:()=>{unknown=true},broadcasts:()=>broadcasts,time:()=>time,setTime:(value:number)=>{time=value}}
}

describe('reviewed staged native multi-wallet buys',()=>{
 it('requires a mint and respects staged one-wallet selection',async()=>{
  const h=await harness()
  await expect(prepareBuyPlan(h.connection,{...h.plan,mint:undefined},[],h.options,h.ports)).rejects.toThrow(/mint|launch/i)
  await expect(prepareBuyPlan(h.connection,{...h.plan,mode:'staged'},h.plan.rows.map(row=>row.id),h.options,h.ports)).rejects.toThrow(/one|single/i)
 })
 it('forwards only the exact fresh purchase, records originals before broadcast, and follows reviewed order',async()=>{
  const h=await harness();h.plan.order='reverse';h.plan.rows[1].transferTo=Keypair.generate().publicKey.toBase58()
  const prepared=await prepareBuyPlan(h.connection,h.plan,h.plan.rows.map(row=>row.id),h.options,h.ports)
  const result=await executeBuyPlan(prepared,h.options)
  expect(result.status,result.error).toBe('completed');expect(result.rows.map(row=>row.rowId)).toEqual(['row-1','row-0']);expect(h.broadcasts()).toBe(2)
  expect(result.rows[0]).toMatchObject({transferTo:h.plan.rows[1].transferTo,status:'confirmed'})
  expect(BigInt(result.rows[0].tokenRaw!)).toBeGreaterThan(0n);expect(readTradePending(h.storage)).toBeNull()
  expect(JSON.stringify(readBuyPlanJournals(h.storage))).not.toMatch(/privateKey|secretKey|transaction|packet/)
  await expect(executeBuyPlan(prepared,h.options)).rejects.toThrow(/used|review/i)
  await expect(prepareBuyPlan(h.connection,h.plan,['row-1'],h.options,h.ports)).rejects.toThrow(/completed|confirmed/i)
 })
 it('stops a locked signer before sending and rejects altered signed simulation evidence',async()=>{
  const h=await harness(),prepared=await prepareBuyPlan(h.connection,h.plan,['row-0'],h.options,h.ports);h.lock()
  const result=await executeBuyPlan(prepared,h.options);expect(result.status).toBe('stopped');expect(h.broadcasts()).toBe(0)
  const second=await harness(),simulate=second.ports.simulate!
  const next=await prepareBuyPlan(second.connection,second.plan,['row-0'],second.options,{...second.ports,simulate:async(...args)=>{const result=await simulate(...args);if(args[2]?.verifySignatures)result.tokenAccountDeltasRaw={};return result}})
  const failed=await executeBuyPlan(next,second.options);expect(failed.error).toMatch(/token|evidence/i);expect(second.broadcasts()).toBe(0)
 })
 it('preserves unknown original signatures, never starts the next buyer, and reconciles without resubmitting',async()=>{
  const h=await harness();h.setUnknown();const prepared=await prepareBuyPlan(h.connection,h.plan,h.plan.rows.map(row=>row.id),h.options,h.ports)
  const result=await executeBuyPlan(prepared,h.options);expect(result.status).toBe('unknown');expect(h.broadcasts()).toBe(1)
  expect(readTradePending(h.storage)?.signature).toBe(result.rows[0].signature)
  await expect(prepareBuyPlan(h.connection,h.plan,['row-1'],h.options,h.ports)).rejects.toThrow(/pending|confirmation/i)
  const reconciled=await reconcileBuyPlanJournals(h.connection,{storage:h.storage,locks:h.options.locks})
  expect(reconciled[0].rows[0].status).toBe('confirmed');expect(reconciled[0].rows[1].status).toBe('not-submitted');expect(h.broadcasts()).toBe(1)
 })
 it('fails closed on aggregate or per-wallet costs, stale reviews, message mutations and cancellation',async()=>{
  for(const failure of ['cost','stale','message','cancel'] as const){
   const h=await harness(),controller=new AbortController(),ports={...h.ports};let checking=false
   if(failure==='cost'){const simulate=ports.simulate!;ports.simulate=async(...args)=>{const result=await simulate(...args);if(checking)result.walletDebitsLamports![args[2]!.payer!]='26000000';return result}}
   if(failure==='message'){const build=ports.build!;ports.build=async(...args)=>{const result=await build(...args);if(checking)result.transaction.message.staticAccountKeys[0]=Keypair.generate().publicKey;return result}}
   const prepared=await prepareBuyPlan(h.connection,h.plan,['row-0'],h.options,ports);checking=true
   if(failure==='stale')h.setTime(1000000)
   const options={...h.options,signal:controller.signal}
   if(failure==='cancel')controller.abort()
   const result=await executeBuyPlan(prepared,options);expect(result.status).not.toBe('completed');expect(h.broadcasts()).toBe(0)
  }
 })
 it('checks live signers at the last broadcast boundary and rejects mutated signed simulation packets',async()=>{
  for(const failure of ['locked-during-simulation','locked-at-broadcast','mutated-simulation'] as const){
   const h=await harness(),simulate=h.ports.simulate!,send=h.ports.send!,ports={...h.ports}
   ports.simulate=async(...args)=>{const result=await simulate(...args);if(args[2]?.verifySignatures){if(failure==='locked-during-simulation')h.lock();if(failure==='mutated-simulation')args[1][0].signatures[0][0]^=1}return result}
   if(failure==='locked-at-broadcast')ports.send=async(...args)=>{h.lock();return send(...args)}
   const preview=await prepareBuyPlan(h.connection,h.plan,['row-0'],h.options,ports),result=await executeBuyPlan(preview,h.options)
   expect(result.status).toBe('stopped');expect(h.broadcasts()).toBe(0);expect(readTradePending(h.storage)).toBeNull()
  }
 })
 it('retains the original signature on a mismatched response and refuses changed recovery identities',async()=>{
  const h=await harness(),send=h.ports.send!,ports={...h.ports,send:async(...args:Parameters<BuyPlanPorts['send']>)=>{const result=await send(...args);return {...result,signature:'different'}}}
  const preview=await prepareBuyPlan(h.connection,h.plan,['row-0'],h.options,ports),result=await executeBuyPlan(preview,h.options),signature=result.rows[0].signature
  expect(result.status).toBe('unknown');expect(readTradePending(h.storage)?.signature).toBe(signature);expect(h.broadcasts()).toBe(1)
  const changed=structuredClone(result);changed.rows[0].transferTo=Keypair.generate().publicKey.toBase58()
  expect(()=>saveBuyPlanJournal(changed,h.storage)).toThrow(/identity|original/i)
  h.connection.getSignatureStatuses=async()=>({context:{slot:1},value:[null]})
  expect((await reconcileBuyPlanJournals(h.connection,{storage:h.storage,locks:h.options.locks}))[0].status).toBe('unknown');expect(h.broadcasts()).toBe(1)
 })
 it('cannot cross the broadcast boundary unless durable originals can be saved',async()=>{
  const h=await harness(),preview=await prepareBuyPlan(h.connection,h.plan,['row-0'],h.options,h.ports),write=h.storage.setItem
  h.storage.setItem=(key,value)=>{if(key==='vanity-trade-pending')throw new Error('storage denied');write(key,value)}
  const result=await executeBuyPlan(preview,h.options);expect(result.status).toBe('stopped');expect(h.broadcasts()).toBe(0);expect(readTradePending(h.storage)).toBeNull()
 })
 it('counts prior submitted wallet ceilings against the same plan before another explicit step',async()=>{
  const h=await harness();h.plan.mode='staged';const first=await prepareBuyPlan(h.connection,h.plan,['row-0'],h.options,h.ports)
  expect((await executeBuyPlan(first,h.options)).status).toBe('completed')
  // Raising the remaining row while keeping the original aggregate cap must stop.
  const next={...h.plan,rows:[h.plan.rows[1]],maxTotalDebitSol:'0.04'}
  await expect(prepareBuyPlan(h.connection,next,['row-1'],h.options,h.ports)).rejects.toThrow(/aggregate|cap/i)
  expect(h.broadcasts()).toBe(1)
 })
 it('stops remaining buyers on a newly observed qualifying external buy while ignoring the baseline',async()=>{
  const h=await harness(),external=Keypair.generate().publicKey.toBase58();h.plan.intervalSeconds=5
  const base={id:'baseline',signature:bs58.encode(new Uint8Array(64).fill(1)),ordinal:0,slot:1,timestamp:0,wallet:external,side:'buy',solAmountLamports:'100000000'}
  const plan={...h.plan,observedBuyGuard:{minBuySol:'0.05',whitelist:[]}}
  const ports={...h.ports,fetchMarket:async()=>({status:'ready',mint:plan.mint,curveStatus:'active',fetchedAt:new Date(h.time()).toISOString(),coverage:{kind:'recent',requested:2,read:2,missing:0,unsupported:0,failed:0,invalid:0,complete:false},trades:h.time()<6000?[base]:[base,{...base,id:'new-external',signature:bs58.encode(new Uint8Array(64).fill(2)),timestamp:6,slot:2}]})}
  const preview=await prepareBuyPlan(h.connection,plan,plan.rows.map(row=>row.id),h.options,ports),result=await executeBuyPlan(preview,h.options)
  expect(result.status).toBe('stopped');expect(result.error).toMatch(/observed.*external.*buy/i);expect(result.rows[0].status).toBe('confirmed');expect(result.rows[1].status).toBe('not-submitted');expect(h.broadcasts()).toBe(1)
 })
})
