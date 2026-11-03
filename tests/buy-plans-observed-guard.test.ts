import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {ObservedBuyWatcher} from '../src/lib/tradingSessions/observedTrades'
const mint=Keypair.generate().publicKey.toBase58(),own=Keypair.generate().publicKey.toBase58(),external=Keypair.generate().publicKey.toBase58(),allowed=Keypair.generate().publicKey.toBase58()
const trade=(n:number,wallet=external,side:'buy'|'sell'='buy')=>({id:`event-${n}`,signature:bs58.encode(new Uint8Array(64).fill(n)),ordinal:0,slot:100+n,timestamp:100+n,wallet,side,tokenAmountRaw:'100',solAmountLamports:'100000000',feeLamports:'1',creatorFeeLamports:'0',priceSol:0.001})
const snapshot=(trades:ReturnType<typeof trade>[],time:number)=>({status:'ready',mint,curveStatus:'active',fetchedAt:new Date(time).toISOString(),trades,coverage:{kind:'recent',requested:trades.length,read:trades.length,missing:0,unsupported:0,failed:0,invalid:0,complete:false}})
describe('observed confirmed external-buy rules',()=>{
 it('ignores baseline/past/own/whitelisted events and latches a new qualifying external buy once',()=>{
  const watcher=new ObservedBuyWatcher(mint,{minBuySol:'0.05',whitelist:[allowed]},[own],100000)
  expect(watcher.observe(snapshot([trade(1)],102000),102000)).toBeNull()
  expect(watcher.observe(snapshot([trade(1),trade(2,own),trade(3,allowed),trade(4,external,'sell')],105000),105000)).toBeNull()
  const observed=watcher.observe(snapshot([trade(4,external,'sell'),trade(5)],106000),106000)
  expect(observed?.id).toBe('event-5')
  expect(watcher.observe(snapshot([trade(5),trade(6)],107000),107000)?.id).toBe('event-5')
 })
 it('stops on stale observations, missing transactions and a non-overlapping sample gap',()=>{
  for(const problem of ['stale','missing','gap'] as const){
   const watcher=new ObservedBuyWatcher(mint,{minBuySol:'0.01',whitelist:[]},[],100000);watcher.observe(snapshot([trade(1)],102000),102000)
   const next=snapshot(problem==='gap'?[trade(2)]:[trade(1),trade(2)],103000)
   if(problem==='missing')next.coverage.missing=1
   expect(()=>watcher.observe(next,problem==='stale'?150000:103000)).toThrow(/stale|missing|gap|coverage/i)
  }
 })
 it('adds deduplicated subthreshold external buys and triggers only when the total strictly exceeds the guard limit',()=>{
  const watcher=new ObservedBuyWatcher(mint,{minBuySol:'0.1',whitelist:[allowed]},[own],100000,'cumulative')
  const base=trade(1),first={...trade(2),solAmountLamports:'40000000'},second={...trade(3),solAmountLamports:'60000000'},cross={...trade(4),solAmountLamports:'1'}
  watcher.observe(snapshot([base],102000),102000)
  expect(watcher.observe(snapshot([base,first,trade(8,own),trade(9,allowed)],110000),110000)).toBeNull();expect(watcher.totalObservedLamports).toBe('40000000')
  expect(watcher.observe(snapshot([first,second],111000),111000)).toBeNull();expect(watcher.totalObservedLamports).toBe('100000000')
  expect(watcher.observe(snapshot([first,second],112000),112000)).toBeNull();expect(watcher.totalObservedLamports).toBe('100000000')
  expect(watcher.observe(snapshot([second,cross],113000),113000)?.id).toBe(cross.id);expect(watcher.totalObservedLamports).toBe('100000001')
 })
})
