import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import {AutomationStore} from '../src/lib/server/automationWallets/store'
import {AutomationWorker,type AutomationPorts} from '../src/lib/server/automationWallets/worker'
import type {PreparedTrade,TradeInput} from '../src/lib/venues/trade'
import type {AutomationPlan} from '../src/lib/automationWallets/model'
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0))fn()})
const mainnet='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
function prepared(input:TradeInput):PreparedTrade{
 const mint=new PublicKey(input.mint),payer=new PublicKey(input.payer),curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),mint.toBuffer()],PUMP_PROGRAM_ID)[0]
 const global=PublicKey.findProgramAddressSync([Buffer.from('global')],PUMP_PROGRAM_ID)[0],event=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_PROGRAM_ID)[0]
 const addresses=[global,Keypair.generate().publicKey,mint,curve,getAssociatedTokenAddressSync(mint,curve,true),getAssociatedTokenAddressSync(mint,payer),payer,SystemProgram.programId,TOKEN_PROGRAM_ID,Keypair.generate().publicKey,event,PUMP_PROGRAM_ID]
 const data=Buffer.alloc(24);Buffer.from([102,6,61,18,1,218,235,234]).copy(data);data.writeBigUInt64LE(100n,8);data.writeBigUInt64LE(10_000_000n,16)
 const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[new TransactionInstruction({programId:PUMP_PROGRAM_ID,data,keys:addresses.map((pubkey,i)=>({pubkey,isSigner:i===6,isWritable:[1,3,4,5,6,9].includes(i)}))})]}).compileToV0Message())
 return {transaction,input,position:{mint:input.mint,payer:input.payer,decimals:6,tokenRaw:'0',solLamports:'1000000000',tokenProgram:TOKEN_PROGRAM_ID.toBase58(),ata:getAssociatedTokenAddressSync(mint,payer).toBase58(),status:'active'},maxBuyLamports:'10000000',maxSellRaw:'0',tokenAmountRaw:'100',minimumSolOut:'0',tokenChangeRaw:'100',solChangeLamports:'-10005000',networkFeeLamports:'5000',createdAt:1_800_000_000_000,message:Buffer.from(transaction.message.serialize()).toString('base64')}
}
function harness(){
 let now=1_800_000_000_000,status:'confirmed'|'failed'|'unknown'='unknown',sends=0
 const dir=mkdtempSync(join(tmpdir(),'auto-worker-')),store=new AutomationStore(join(dir,'store.sqlite'),randomBytes(32));cleanup.push(()=>{store.close();rmSync(dir,{recursive:true,force:true})})
 const owner=store.createWallet(now);store.backup(owner.capability,true)
 const plan:AutomationPlan={version:1,mode:'dca',mint:Keypair.generate().publicKey.toBase58(),action:'buy',buySol:'0.01',sellAmountRaw:'0',intervalSeconds:60,startAt:now+1000,expiresAt:now+600000,maxTrades:2,maxDebitPerTradeSol:'0.025',maxTotalDebitSol:'0.05',minReserveSol:'0.005',slippage:5,priorityFeeSol:0.0001}
 const review=store.review(owner.capability,plan,now);store.arm(owner.capability,review.hash,now);now+=1000
 const ports:AutomationPorts={now:()=>now,genesis:async()=>mainnet,prepare:async input=>prepared(input),simulate:async(tx)=>{expect(tx.signatures[0].some(n=>n!==0)).toBe(true);return {walletBeforeLamports:'1000000000',netDebitLamports:'10005000',networkFeeLamports:'5000'}},blockhashValid:async()=>true,send:async()=>{sends++;expect(store.pending()).toHaveLength(1);throw new Error('Lost response after RPC accepted the packet')},status:async()=>status}
 return {store,owner,ports,worker:new AutomationWorker(store,ports),advance:(n:number)=>{now+=n},setStatus:(value:typeof status)=>{status=value},sends:()=>sends,plan}
}
describe('unattended original-signature worker',()=>{
 it('erases the actual signer backing bytes before the signed simulation awaits',async()=>{
  const h=harness(),original=VersionedTransaction.prototype.sign,captured:Uint8Array[]=[]
  const spy=vi.spyOn(VersionedTransaction.prototype,'sign').mockImplementation(function(this:VersionedTransaction,signers){captured.push(signers[0].secretKey);return original.call(this,signers)})
  const simulate=h.ports.simulate;h.ports.simulate=async(...args)=>{expect(captured).toHaveLength(1);expect(captured[0].every(n=>n===0)).toBe(true);return simulate(...args)}
  try{await h.worker.tick();expect(captured).toHaveLength(1);expect(captured[0].every(n=>n===0)).toBe(true);expect(h.sends()).toBe(1)}finally{spy.mockRestore()}
 })
 it('records before send and never sends another packet after a lost response or restart while unknown',async()=>{
  const h=harness();await h.worker.tick();const original=h.store.pending()[0].signature;expect(h.sends()).toBe(1)
  h.advance(180000);await new AutomationWorker(h.store,h.ports).tick();await h.worker.tick()
  expect(h.sends()).toBe(1);expect(h.store.pending()[0].signature).toBe(original)
 })
 it('waits the interval after original confirmation and caps the total number of attempts',async()=>{
  const h=harness();await h.worker.tick();h.setStatus('confirmed');await h.worker.tick();expect(h.sends()).toBe(1)
  h.advance(60001);await h.worker.tick();expect(h.sends()).toBe(2);await h.worker.tick();h.advance(60001);await h.worker.tick()
  expect(h.sends()).toBe(2);expect(h.store.read(h.owner.capability).policy).toMatchObject({status:'completed',attempts:2,reservedDebitLamports:'50000000'})
 })
 it('blocks failed on-chain transactions instead of continuing fresh trading',async()=>{
  const h=harness();await h.worker.tick();h.setStatus('failed');await h.worker.tick();h.advance(120000);await h.worker.tick()
  expect(h.sends()).toBe(1);expect(h.store.read(h.owner.capability).policy?.status).toBe('blocked')
 })
 it('blocks before submission when signed simulation exceeds debit, fee, reserve or native message authority',async()=>{
  for(const boundary of ['debit','fee','reserve','message']){
   const h=harness();h.ports.simulate=async()=>({walletBeforeLamports:boundary==='reserve'?'29000000':'1000000000',netDebitLamports:boundary==='debit'?'25000001':'10005000',networkFeeLamports:boundary==='fee'?'10000000':'5000'})
   if(boundary==='message'){const original=h.ports.prepare;h.ports.prepare=async input=>{const p=await original(input);p.message='a different reviewed message';return p}}
   await h.worker.tick();expect(h.sends(),boundary).toBe(0);expect(h.store.pending(),boundary).toHaveLength(0);expect(h.store.read(h.owner.capability).policy?.status,boundary).toBe('blocked')
  }
 })
 it('rechecks the original signed message at the final broadcast boundary after asynchronous simulation',async()=>{
  const h=harness(),simulate=h.ports.simulate
  h.ports.simulate=async(tx,...args)=>{const result=await simulate(tx,...args);tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();return result}
  await h.worker.tick();expect(h.sends()).toBe(0);expect(h.store.pending()).toHaveLength(0)
 })
 it('cancels held execution after simulation and never accepts a foreign chain',async()=>{
  for(const reason of ['cancel','chain']){const h=harness();if(reason==='chain')h.ports.genesis=async()=> 'wrong-chain';else h.ports.simulate=async()=>{h.store.cancel(h.owner.capability,h.ports.now());return {walletBeforeLamports:'1000000000',netDebitLamports:'10005000',networkFeeLamports:'5000'}};await h.worker.tick();expect(h.sends()).toBe(0)}
 })
})
