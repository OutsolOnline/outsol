import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {Keypair} from '@solana/web3.js'
import {AutomationStore} from '../src/lib/server/automationWallets/store'
import {createAutomationService} from '../src/lib/server/automationWallets/service'
import type {AutomationPorts} from '../src/lib/server/automationWallets/worker'
import type {PreparedTrade} from '../src/lib/venues/trade'
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).forEach(fn=>fn()))
describe('reviewed automation service',()=>{
 it('requires a running worker before arm and recovers from a transient startup failure without a restart',async()=>{
  const now=1_800_000_000_000,dir=mkdtempSync(join(tmpdir(),'auto-service-start-')),store=new AutomationStore(join(dir,'store.sqlite'),randomBytes(32));cleanup.push(()=>{store.close();rmSync(dir,{recursive:true,force:true})})
  const owner=store.createWallet(now);store.backup(owner.capability,true)
  const plan={version:1 as const,mode:'dca' as const,mint:Keypair.generate().publicKey.toBase58(),action:'buy' as const,buySol:'0.01',sellAmountRaw:'0',intervalSeconds:60,startAt:now+1000,expiresAt:now+600000,maxTrades:2,maxDebitPerTradeSol:'0.025',maxTotalDebitSol:'0.05',minReserveSol:'0.005',slippage:5,priorityFeeSol:0.0001},review=store.review(owner.capability,plan,now)
  let calls=0,running=false
  const ports={now:()=>now,genesis:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'} as unknown as AutomationPorts
  const service=createAutomationService({store,ports,balance:async()=> '1000000000',enabled:()=>true,ensureWorker:()=>{calls++;if(calls===1)throw new Error('Temporary storage startup failure');running=true}})
  await expect(service.arm(owner.capability,review.hash,true)).rejects.toThrow();expect(store.read(owner.capability).policy?.status).toBe('review')
  await service.arm(owner.capability,review.hash,true);expect(running).toBe(true);expect(calls).toBe(2);expect(store.read(owner.capability).policy?.status).toBe('armed')
 })
 it('refuses an exact scheduled sell whose total tokens exceed the owned balance before a review can be armed',async()=>{
  const now=1_800_000_000_000,dir=mkdtempSync(join(tmpdir(),'auto-service-')),store=new AutomationStore(join(dir,'store.sqlite'),randomBytes(32));cleanup.push(()=>{store.close();rmSync(dir,{recursive:true,force:true})})
  const owner=store.createWallet(now);store.backup(owner.capability,true)
  const ports={now:()=>now,genesis:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',prepare:async()=>({solChangeLamports:'10000000',position:{solLamports:'1000000000',tokenRaw:'15'},tokenAmountRaw:'10',minimumSolOut:'10000000',networkFeeLamports:'5000'} as PreparedTrade)} as unknown as AutomationPorts
  const service=createAutomationService({store,ports,balance:async()=> '1000000000',enabled:()=>true})
  const plan={version:1,mode:'dca',mint:Keypair.generate().publicKey.toBase58(),action:'sell',buySol:'0',sellAmountRaw:'10',intervalSeconds:60,startAt:now+1000,expiresAt:now+600000,maxTrades:2,maxDebitPerTradeSol:'0.025',maxTotalDebitSol:'0.05',minReserveSol:'0.005',slippage:5,priorityFeeSol:0.0001}
  await expect(service.review(owner.capability,plan)).rejects.toThrow(/token balance/i)
  expect(store.read(owner.capability).policy).toBeNull()
 })
})
