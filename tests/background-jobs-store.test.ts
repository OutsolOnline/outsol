import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {DatabaseSync} from 'node:sqlite'
import {BackgroundJobStore} from '../src/lib/server/backgroundJobs/store'

const roots:string[]=[],stores:BackgroundJobStore[]=[]
const mint=Keypair.generate().publicKey.toBase58(),key=Buffer.alloc(32,1).toString('base64url'),other=Buffer.alloc(32,2).toString('base64url'),signature=(n:number)=>bs58.encode(new Uint8Array(64).fill(n))
const input={version:1 as const,kind:'token-history' as const,mint,maxTransactions:100,idempotencyKey:'12345678-1234-4234-8234-123456789abc'}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'launchpier-background-jobs-'));roots.push(dir);let now=1793790000000;const path=join(dir,'jobs.sqlite'),store=new BackgroundJobStore(path,()=>now);stores.push(store);return{path,store,advance:(ms:number)=>{now+=ms},clock:()=>now}}
afterEach(()=>{for(const store of stores.splice(0))try{store.close()}catch{};for(const root of roots.splice(0)){if(!resolve(root).startsWith(resolve(tmpdir())+sep+'launchpier-background-jobs-'))throw Error('Unsafe test directory');rmSync(root,{recursive:true,force:true})}})
describe('durable capability-owned history jobs',()=>{
 it('persists creation quotas across connections without charging idempotent cancelled retries',()=>{
  const f=fixture(),second=new BackgroundJobStore(f.path,f.clock);stores.push(second)
  for(let i=0;i<3;i++){const value={...input,idempotencyKey:`quota-client-request-${i}`},job=f.store.create(value,key,'client-a');f.store.cancel(job.id,key);expect(second.create(value,key,'client-a').state).toBe('cancelled')}
  expect(()=>second.create({...input,idempotencyKey:'quota-client-request-blocked'},key,'client-a')).toThrow(/limit/i)
  f.advance(600001);expect(second.create({...input,idempotencyKey:'quota-client-request-restored'},key,'client-a').state).toBe('queued')
  for(let i=0;i<6;i++){const job=second.create({...input,idempotencyKey:`quota-global-request-${i}`},key,`client-${i}`);second.cancel(job.id,key)}
  expect(()=>f.store.create({...input,idempotencyKey:'quota-global-request-blocked'},key,'another-client')).toThrow(/limit/i)
  f.advance(3_000_000);expect(f.store.create({...input,idempotencyKey:'quota-global-request-restored'},key,'another-client').state).toBe('queued')
 })
 it('keeps empty cancellation tombstones outside the retained receipt pool and bounds their lifetime',()=>{
  const f=fixture(),completed=f.store.create(input,key),lease=f.store.claim('worker')!;f.store.savePage(lease,[])
  const db=new DatabaseSync(f.path)
  try{for(let i=0;i<198;i++)db.prepare("INSERT INTO jobs SELECT ?,capability_hash,request,'cancelled',created_at,updated_at,expires_at,page,page_index,before_sig,0,coverage,rpc_exhausted,decimals,NULL,0,attempts,next_run,error FROM jobs WHERE id=?").run(i.toString(16).padStart(40,'0'),completed.id)}finally{db.close()}
  const value={...input,idempotencyKey:'after-old-cancellation-fill'},job=f.store.create(value,key,'fresh-client');expect(job.state).toBe('queued');f.store.cancel(job.id,key)
  expect(f.store.create(value,key,'fresh-client')).toMatchObject({id:job.id,state:'cancelled'})
  expect(()=>f.store.create({...value,idempotencyKey:'over-total-tombstone-bound'},key,'another-client')).toThrow(/full/i)
  f.advance(600001);const replacement=f.store.create(value,key,'fresh-client');expect(replacement.state).toBe('queued');expect(f.store.read(completed.id,key)?.state).toBe('succeeded')
  const check=new DatabaseSync(f.path);try{expect(Number((check.prepare('SELECT count(*) AS n FROM jobs').get() as {n:number}).n)).toBe(2)}finally{check.close()}
 })
 it('preserves partially scanned cancelled receipts for the full recovery retention',()=>{
  const f=fixture(),job=f.store.create(input,key),lease=f.store.claim('partial-worker')!,page=[{signature:signature(4),slot:10,blockTime:null,failed:false}];f.store.savePage(lease,page);f.store.record(lease,{...page[0],status:'missing',trades:[],balanceChanges:[]})
  expect(f.store.cancel(job.id,key)?.expiresAt).toBe(job.expiresAt);f.advance(600001);f.store.create({...input,idempotencyKey:'after-partial-cancellation'},other,'another-client')
  expect(f.store.read(job.id,key)).toMatchObject({state:'cancelled',scanned:1});expect(f.store.receipts(job.id,key)).toHaveLength(1)
 })
 it('persists across process objects, isolates access and does not persist the bearer capability',()=>{
  const f=fixture(),job=f.store.create(input,key);expect(f.store.read(job.id,other)).toBeNull();expect(f.store.read(job.id,key)?.state).toBe('queued');expect(JSON.stringify(job)).not.toContain(key)
  f.store.close();const restored=new BackgroundJobStore(f.path,f.clock);stores.push(restored);expect(restored.read(job.id,key)).toMatchObject({id:job.id,mint,state:'queued',scanned:0,fullTokenHistory:false});expect(restored.read(job.id,other)).toBeNull()
 })
 it('deduplicates a retried creation by capability and idempotency key, rejects changed approved input',()=>{
  const f=fixture(),one=f.store.create(input,key),two=f.store.create(input,key);expect(two.id).toBe(one.id)
  expect(()=>f.store.create({...input,maxTransactions:200},key)).toThrow(/changed|different/i)
  expect(f.store.create(input,other).id).not.toBe(one.id)
 })
 it('leases one worker at a time and rejects stale checkpointing after crash recovery',()=>{
  const f=fixture(),job=f.store.create(input,key),first=f.store.claim('worker-a')!;expect(first.id).toBe(job.id);expect(f.store.claim('worker-b')).toBeNull()
  f.advance(31000);const second=f.store.claim('worker-b')!;expect(second.id).toBe(job.id);expect(second.leaseToken).not.toBe(first.leaseToken)
  expect(f.store.savePage(first,[{signature:signature(1),slot:10,blockTime:null,failed:false}])).toBe(false)
  expect(f.store.savePage(second,[{signature:signature(1),slot:10,blockTime:null,failed:false}])).toBe(true)
 })
 it('checkpoints exact original signatures and resumes the next receipt without duplication',()=>{
  const f=fixture(),job=f.store.create(input,key),lease=f.store.claim('worker-a')!;f.store.savePage(lease,[{signature:signature(1),slot:10,blockTime:null,failed:false},{signature:signature(2),slot:9,blockTime:null,failed:false}])
  const receipt={signature:signature(1),slot:10,blockTime:null,status:'confirmed' as const,trades:[],balanceChanges:[]};expect(f.store.record(lease,receipt)).toBe(true);expect(f.store.record(lease,receipt)).toBe(false)
  f.advance(31000);const next=f.store.claim('worker-b')!;expect(next.pageIndex).toBe(1);expect(next.page[1].signature).toBe(signature(2));expect(f.store.read(job.id,key)).toMatchObject({scanned:1,coverage:{read:1}})
 })
 it('cancels pending/running work and rejects all later lease writes',()=>{
  const f=fixture(),job=f.store.create(input,key),lease=f.store.claim('worker-a')!;expect(f.store.cancel(job.id,other)).toBeNull();expect(f.store.cancel(job.id,key)?.state).toBe('cancelled');expect(f.store.savePage(lease,[])).toBe(false);expect(f.store.claim('worker-b')).toBeNull();expect(f.store.read(job.id,key)?.state).toBe('cancelled')
 })
 it('distinguishes reaching a finite scan limit from an exhausted RPC address history',()=>{
  const f=fixture(),job=f.store.create({...input,maxTransactions:25},key),lease=f.store.claim('worker-a')!;expect(f.store.savePage(lease,[])).toBe(true);expect(f.store.read(job.id,key)).toMatchObject({state:'succeeded',rpcAddressExhausted:true,fullTokenHistory:false})
 })
 it('rejects unsupported signing jobs, invalid limits and secret-bearing input fields',()=>{
  const f=fixture();for(const value of [{...input,kind:'trade'},{...input,maxTransactions:501},{...input,maxTransactions:0},{...input,privateKey:'DO-NOT-PERSIST'}])expect(()=>f.store.create(value,key)).toThrow();expect(()=>f.store.create(input,'short')).toThrow()
 })
 it('shares fencing and the fixed RPC budget across independent database connections',()=>{
  const f=fixture();f.store.create(input,key);const second=new BackgroundJobStore(f.path,f.clock);stores.push(second);expect(f.store.claim('one')).not.toBeNull();expect(second.claim('two')).toBeNull()
  for(let i=0;i<600;i++)expect((i%2?second:f.store).reserveRpcRead()).toBe(true);expect(second.reserveRpcRead()).toBe(false);f.advance(600001);expect(f.store.reserveRpcRead()).toBe(true)
 })
 it('expires unbounded restarts while preserving saved receipts and rejects non-advancing RPC cursors',()=>{
  const f=fixture(),job=f.store.create(input,key),lease=f.store.claim('one')!,page=[{signature:signature(1),slot:10,blockTime:null,failed:false}];f.store.savePage(lease,page);f.store.record(lease,{...page[0],status:'missing',trades:[],balanceChanges:[]});expect(()=>f.store.savePage(lease,page)).toThrow(/advance/i);f.advance(3600001);expect(f.store.claim('two')).toBeNull();expect(f.store.read(job.id,key)).toMatchObject({state:'failed',scanned:1,coverage:{missing:1}});expect(f.store.receipts(job.id,key)).toHaveLength(1)
 })
})
