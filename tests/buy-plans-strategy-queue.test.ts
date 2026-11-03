import {describe,expect,it} from 'vitest'
import {Connection,Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {StrategyQueue,type StrategyQueuePorts} from '../src/lib/tradingSessions/strategyQueue'
import {validateStrategyQueue,type StrategyQueueConfig} from '../src/lib/tradingSessions/queueModel'
import {readStrategyQueues,saveStrategyQueue} from '../src/lib/tradingSessions/queueHistory'
import type {TradingSessionJournal} from '../src/lib/tradingSessions/types'

function harness(){
 const keys=[Keypair.generate(),Keypair.generate()],mint=Keypair.generate().publicKey.toBase58(),values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
 let time=1000,calls=0
 const config:StrategyQueueConfig={version:1,id:crypto.randomUUID(),name:'Wallet strategy queue',maxDebitSol:'0.05',durationMs:60000,steps:keys.map((key,index)=>({id:`step-${index}`,name:`Wallet ${index}`,config:{version:1,mode:'dca',walletId:`wallet-${index}`,payer:key.publicKey.toBase58(),mint,action:'buy',buySol:'0.01',sellPercent:100,maxTrades:1,intervalMs:5000,durationMs:30000,maxDebitSol:'0.025',slippage:5,priorityFeeSol:0.0001}}))}
 const options={approved:true as const,storage,locks:{request:async<T,>(_name:string,_opts:unknown,callback:(lock:object)=>Promise<T>)=>callback({})},readKeypair:(id:string)=>keys[Number(id.split('-')[1])]??null,assertCurrent:()=>{}}
 const ports:Partial<StrategyQueuePorts>={now:()=>time,wait:async ms=>{time+=ms},runSession:async(_connection,config,signer)=>{
  signer.assertAvailable?.();calls++;time+=1000
  const result:TradingSessionJournal={version:1,id:crypto.randomUUID(),config,status:'completed',phase:'idle',armedAt:time-1000,updatedAt:time,reservedDebitLamports:'12000000',rows:[{index:0,mint:config.mint!,action:config.action,status:'confirmed',debitReservedLamports:'12000000',createdAt:time-1000,signature:bs58.encode(new Uint8Array(64).fill(calls))}]}
  signer.onChange?.(result);return result
 }}
 return {config,options,ports,connection:{} as Connection,calls:()=>calls,storage,keys}
}
describe('bounded multiple-wallet strategy queue',()=>{
 it('rejects caps below the combined strategy limits and more than ten approved trades',()=>{
  const h=harness()
  expect(()=>validateStrategyQueue({...h.config,maxDebitSol:'0.049'})).toThrow(/aggregate|ceiling/i)
  expect(()=>validateStrategyQueue({...h.config,steps:h.config.steps.map(step=>({...step,config:{...step.config,maxTrades:6}}))})).toThrow(/ten|10/i)
 })
 it('pauses after a confirmed step, retains exact signatures, and resumes only remaining work with fresh approval',async()=>{
  const h=harness(),queue=new StrategyQueue(h.connection,h.config,h.ports)
  const paused=await queue.run({...h.options,onChange:value=>{if(value.attempts.some(attempt=>attempt.journal.rows.some(row=>row.status==='confirmed')))queue.pause()}})
  expect(paused.status).toBe('paused');expect(h.calls()).toBe(1);expect(paused.reservedDebitLamports).toBe('12000000')
  const signature=paused.attempts[0].journal.rows[0].signature
  const next=new StrategyQueue(h.connection,h.config,h.ports)
  await expect(next.run({...h.options,approved:false as never,resumeFrom:paused})).rejects.toThrow(/approval|approve/i)
  const resumed=await new StrategyQueue(h.connection,h.config,h.ports).run({...h.options,resumeFrom:paused})
  expect(resumed.status,resumed.message).toBe('completed');expect(h.calls()).toBe(2);expect(resumed.attempts[0].journal.rows[0].signature).toBe(signature);expect(resumed.reservedDebitLamports).toBe('24000000')
  expect(JSON.stringify(readStrategyQueues(h.storage))).not.toMatch(/privateKey|secretKey|transaction|packet/)
 })
 it('will not rearm unknown submissions or resume an edited ceiling below already reserved spending',async()=>{
  const h=harness(),queue=new StrategyQueue(h.connection,h.config,{...h.ports,runSession:async(connection,config,signer,ports)=>{const result=await h.ports.runSession!(connection,config,{...signer,onChange:undefined},ports);result.status='unknown';result.rows[0].status='unknown';signer.onChange?.(result);return result}})
  const uncertain=await queue.run(h.options);expect(uncertain.status).toBe('unknown');expect(h.calls()).toBe(1)
  await expect(new StrategyQueue(h.connection,h.config,h.ports).run({...h.options,resumeFrom:uncertain})).rejects.toThrow(/unknown|confirmation/i)
  const first=harness(),q=new StrategyQueue(first.connection,first.config,first.ports),paused=await q.run({...first.options,onChange:value=>{if(value.attempts.length)q.pause()}})
  const reduced={...first.config,maxDebitSol:'0.025',steps:[first.config.steps[1]]}
  await expect(new StrategyQueue(first.connection,reduced,first.ports).run({...first.options,resumeFrom:paused})).rejects.toThrow(/preserve|step|ceiling|remaining/i)
 })
 it('never repeats a confirmed purchase whose receiver transfer is incomplete',async()=>{
  const h=harness();h.config.steps=h.config.steps.slice(0,1);h.config.steps[0].config.relay={walletId:'receiver',destination:Keypair.generate().publicKey.toBase58(),maxDebitSol:'0.005'}
  const queue=new StrategyQueue(h.connection,h.config,{...h.ports,runSession:async(connection,config,signer,ports)=>{const result=await h.ports.runSession!(connection,config,{...signer,onChange:undefined},ports);result.status='stopped';result.rows[0].relay={status:'not-submitted',destination:config.relay!.destination,amountRaw:'100',debitReservedLamports:'5000000'};signer.onChange?.(result);return result}})
  const stopped=await queue.run(h.options);expect(stopped.status).not.toBe('completed');expect(h.calls()).toBe(1)
  await expect(new StrategyQueue(h.connection,h.config,h.ports).run({...h.options,resumeFrom:stopped})).rejects.toThrow(/receiver|transfer|relay/i)
  expect(h.calls()).toBe(1)
 })
 it('applies freshly approved edits only to remaining strategy work and keeps completed evidence exact',async()=>{
  const h=harness(),queue=new StrategyQueue(h.connection,h.config,h.ports),paused=await queue.run({...h.options,onChange:value=>{if(value.attempts.length)queue.pause()}})
  const edited={...h.config,steps:h.config.steps.map((step,index)=>index?{...step,config:{...step.config,buySol:'0.007'}}:step)}
  const continued=await new StrategyQueue(h.connection,edited,h.ports).run({...h.options,resumeFrom:paused})
  expect(continued.status).toBe('completed');expect(continued.attempts[0]).toEqual(paused.attempts[0]);expect(continued.attempts[1].journal.config.buySol).toBe('0.007');expect(h.calls()).toBe(2)
 })
 it('arms an observed counter after its baseline and latches exactly one new confirmed event',async()=>{
  const h=harness(),external=Keypair.generate().publicKey.toBase58();h.config.steps=h.config.steps.slice(0,1);h.config.steps[0].counter={minBuySol:'0.1',whitelist:[]}
  let polls=0
  const baseline={id:'baseline',signature:bs58.encode(new Uint8Array(64).fill(50)),ordinal:0,slot:1,timestamp:0,wallet:external,side:'buy',solAmountLamports:'200000000'}
  const ports={...h.ports,fetchMarket:async()=>{polls++;return {status:'ready',mint:h.config.steps[0].config.mint,curveStatus:'active',fetchedAt:new Date(polls===1?1000:6000).toISOString(),coverage:{kind:'recent',requested:2,read:2,missing:0,unsupported:0,failed:0,invalid:0,complete:false},trades:polls===1?[baseline]:[baseline,{...baseline,id:'new-confirmed',signature:bs58.encode(new Uint8Array(64).fill(51)),slot:2,timestamp:6}]}}}
  const result=await new StrategyQueue(h.connection,h.config,ports).run(h.options)
  expect(result.status,result.message).toBe('completed');expect(result.observedEventId).toBe('new-confirmed');expect(h.calls()).toBe(1)
 })
 it('preserves unresolved originals when interrupted running records reach the history limit',async()=>{
  const h=harness(),queue=new StrategyQueue(h.connection,h.config,{...h.ports,runSession:async(connection,config,signer,ports)=>{const result=await h.ports.runSession!(connection,config,{...signer,onChange:undefined},ports);result.status='unknown';result.rows[0].status='unknown';signer.onChange?.(result);return result}}),unknown=await queue.run(h.options)
  saveStrategyQueue({...unknown,status:'running'},h.storage)
  expect(readStrategyQueues(h.storage)[0].status).toBe('unknown')
  for(let index=0;index<19;index++)saveStrategyQueue({version:1,id:`later-${index}`,config:{...h.config,id:`config-${index}`},status:'paused',startedAt:3000,updatedAt:3000,activeElapsedMs:0,reservedDebitLamports:'0',attempts:[]},h.storage)
  expect(()=>saveStrategyQueue({version:1,id:'overflow',config:{...h.config,id:'overflow'},status:'paused',startedAt:3000,updatedAt:3000,activeElapsedMs:0,reservedDebitLamports:'0',attempts:[]},h.storage)).toThrow(/pending|recovery|discard/i)
  expect(readStrategyQueues(h.storage).some(row=>row.id===unknown.id)).toBe(true)
 })
})
