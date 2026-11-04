import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {BackgroundJobStore} from '../src/lib/server/backgroundJobs/store'
import {runHistoryJob,type HistoryReader} from '../src/lib/server/backgroundJobs/worker'

const roots:string[]=[],stores:BackgroundJobStore[]=[],key=Buffer.alloc(32,1).toString('base64url'),mint=Keypair.generate().publicKey.toBase58()
const signature=(n:number)=>bs58.encode(new Uint8Array(64).fill(n)),entry=(n:number)=>({signature:signature(n),slot:100-n,blockTime:1793790000,failed:false})
function fixture(){const dir=mkdtempSync(join(tmpdir(),'launchpier-background-worker-'));roots.push(dir);let now=1793790000000;const path=join(dir,'jobs.sqlite'),store=new BackgroundJobStore(path,()=>now);stores.push(store);const job=store.create({version:1,kind:'token-history',mint,maxTransactions:25,idempotencyKey:'worker-test-job-identifier'},key);return{store,job,advance:(ms:number)=>now+=ms,path,clock:()=>now}}
afterEach(()=>{for(const store of stores.splice(0))try{store.close()}catch{};for(const root of roots.splice(0)){if(!resolve(root).startsWith(resolve(tmpdir())+sep+'launchpier-background-worker-'))throw Error('Unsafe test directory');rmSync(root,{recursive:true,force:true})}})
function reader():HistoryReader{return{mintDecimals:async()=>6,signatures:async(_mint,before)=>before?[]:[entry(1),entry(2)],receipt:async(_mint,_decimals,row)=>({...row,status:'confirmed',trades:[],balanceChanges:[]})}}

describe('read-only durable history execution',()=>{
 it('continues in a new process object from its exact durable cursor and records actual receipts',async()=>{
  const f=fixture(),one=f.store.claim('worker-a')!;await runHistoryJob(f.store,one,reader(),2);expect(f.store.read(f.job.id,key)?.scanned).toBe(1)
  f.store.close();const restored=new BackgroundJobStore(f.path,f.clock);stores.push(restored);await runHistoryJob(restored,restored.claim('worker-b')!,reader());expect(restored.read(f.job.id,key)).toMatchObject({state:'succeeded',scanned:2,rpcAddressExhausted:true,fullTokenHistory:false});expect(restored.receipts(f.job.id,key)?.map(row=>row.signature)).toEqual([signature(1),signature(2)])
 })
 it('does not commit or start another RPC after cancellation during a request',async()=>{
  const f=fixture(),r=reader();let reads=0;r.receipt=async(_mint,_decimals,row)=>{reads++;f.store.cancel(f.job.id,key);return{...row,status:'confirmed',trades:[],balanceChanges:[]}}
  await runHistoryJob(f.store,f.store.claim('worker-a')!,r);expect(reads).toBe(1);expect(f.store.read(f.job.id,key)).toMatchObject({state:'cancelled',scanned:0});expect(f.store.receipts(f.job.id,key)).toEqual([])
 })
 it('saves the exact page before a failed request and retries without submitting or signing',async()=>{
  const f=fixture(),r=reader();r.receipt=async()=>{throw Error('RPC failed with secret URL https://secret.invalid/key')};await runHistoryJob(f.store,f.store.claim('worker-a')!,r)
  expect(f.store.read(f.job.id,key)).toMatchObject({state:'queued',scanned:0});expect(JSON.stringify(f.store.read(f.job.id,key))).not.toContain('secret.invalid');f.advance(31000);const next=f.store.claim('worker-b')!;expect(next.page[0].signature).toBe(signature(1));await runHistoryJob(f.store,next,reader());expect(f.store.read(f.job.id,key)?.state).toBe('succeeded')
 })
 it('marks a bounded scan as incomplete even when all requested receipts were read',async()=>{
  const f=fixture(),r=reader();r.signatures=async()=>Array.from({length:25},(_,i)=>entry(i+1));await runHistoryJob(f.store,f.store.claim('worker-a')!,r,30);expect(f.store.read(f.job.id,key)).toMatchObject({state:'succeeded',scanned:25,rpcAddressExhausted:false,fullTokenHistory:false})
 })
})
