import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {Keypair} from '@solana/web3.js'
import {BackgroundJobStore} from '../src/lib/server/backgroundJobs/store'
import {createBackgroundJobHandlers,JOB_ACCESS_HEADER} from '../src/lib/server/backgroundJobs/handlers'
import {backgroundJobReadiness,resolveBackgroundJobConfig} from '../src/lib/server/backgroundJobs/config'

const roots:string[]=[],stores:BackgroundJobStore[]=[],key=Buffer.alloc(32,1).toString('base64url'),other=Buffer.alloc(32,2).toString('base64url'),mint=Keypair.generate().publicKey.toBase58()
const input={version:1,kind:'token-history',mint,maxTransactions:25,idempotencyKey:'api-request-identifier-1234'}
function fixture(){vi.stubEnv('APP_ORIGIN','https://launchpier.test');const dir=mkdtempSync(join(tmpdir(),'launchpier-background-api-'));roots.push(dir);const store=new BackgroundJobStore(join(dir,'jobs.sqlite'));stores.push(store);const start=vi.fn(),handlers=createBackgroundJobHandlers({store:()=>store,start});return{store,start,handlers}}
function request(method:string,path='',accessKey=key,body?:unknown,origin='https://launchpier.test'){return new Request(`https://launchpier.test/api/background-jobs${path}`,{method,headers:{origin,[JOB_ACCESS_HEADER]:accessKey,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}
afterEach(()=>{vi.unstubAllEnvs();for(const store of stores.splice(0))store.close();for(const root of roots.splice(0)){if(!resolve(root).startsWith(resolve(tmpdir())+sep+'launchpier-background-api-'))throw Error('Unsafe test directory');rmSync(root,{recursive:true,force:true})}})

describe('private background-job handlers',()=>{
 it('returns a retryable 429 after the persistent anonymous creation quota',async()=>{
  const f=fixture()
  for(let i=0;i<3;i++){const result=await f.handlers.create(request('POST','',key,{...input,idempotencyKey:`public-quota-request-${i}`}));expect(result.status).toBe(202);const {job}=await result.json();f.store.cancel(job.id,key)}
  const rebuilt=createBackgroundJobHandlers({store:()=>f.store,start:f.start}),limited=await rebuilt.create(request('POST','',other,{...input,idempotencyKey:'public-quota-request-blocked'}))
  expect(limited.status).toBe(429);expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);expect(await limited.json()).toMatchObject({error:expect.stringMatching(/limit/i)})
 })
 it('reports the aggregate hourly quota even when its ten jobs fill the active queue',async()=>{
  const f=fixture()
  for(let i=0;i<10;i++){const req=request('POST','',key,{...input,idempotencyKey:`aggregate-quota-request-${i}`});req.headers.set('x-forwarded-for',`client-${i}`);expect((await f.handlers.create(req)).status).toBe(202)}
  const req=request('POST','',other,{...input,idempotencyKey:'aggregate-quota-request-blocked'});req.headers.set('x-forwarded-for','new-client')
  const limited=await f.handlers.create(req);expect(limited.status).toBe(429);expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(3500)
 })
 it('creates a real durable request, scopes reads/cancellation and never lists all owners',async()=>{
  const f=fixture(),result=await f.handlers.create(request('POST','',key,input));expect(result.status).toBe(202);const {job}=await result.json();expect(f.start).toHaveBeenCalledOnce();expect(JSON.stringify(job)).not.toContain(key)
  expect(f.handlers.get(request('GET',`/${job.id}`,other),job.id).status).toBe(404);expect(f.handlers.remove(request('DELETE',`/${job.id}`,other),job.id).status).toBe(404)
  const own=f.handlers.get(request('GET',`/${job.id}`),job.id);expect(own.headers.get('cache-control')).toContain('no-store');expect(await own.json()).toMatchObject({job:{id:job.id,state:'queued'},receipts:[]})
  const status=await f.handlers.status(request('GET')).json();expect(status).not.toHaveProperty('jobs');expect(status).not.toHaveProperty('unattendedTrading')
  expect(await f.handlers.remove(request('DELETE',`/${job.id}`),job.id).json()).toMatchObject({job:{state:'cancelled'}})
 })
 it('rejects cross-origin mutations and never accepts private-key or trading inputs',async()=>{
  const f=fixture();expect((await f.handlers.create(request('POST','',key,input,'https://attacker.test'))).status).toBe(403)
  for(const value of [{...input,privateKey:'NEVER UPLOAD'},{...input,kind:'scheduled-trade'},{...input,maxTransactions:501}])expect((await f.handlers.create(request('POST','',key,value))).status).toBe(400)
  expect(f.start).not.toHaveBeenCalled()
 })
 it('bounds response pages and does not reveal jobs to malformed/missing capabilities',async()=>{
  const f=fixture(),job=f.store.create(input,key);expect(f.handlers.get(request('GET',`/${job.id}?limit=500`),job.id).status).toBe(400);expect(f.handlers.get(request('GET',`/${job.id}`,'short'),job.id).status).toBe(404)
 })
 it('keeps persistent history storage separate from public assets and private X records',()=>{
  const base={NODE_ENV:'production' as const,RPC_URL:'https://rpc.example.test/?api-key=PRIVATE',RAILWAY_VOLUME_MOUNT_PATH:resolve('/data'),BACKGROUND_JOBS_STORAGE_DIR:resolve('/data/jobs'),ASSET_STORAGE_DIR:resolve('/data/assets'),X_STORAGE_DIR:resolve('/data/x')}
  expect(resolveBackgroundJobConfig(base)?.storage).toBe(resolve('/data/jobs'))
  for(const value of [base.ASSET_STORAGE_DIR,base.X_STORAGE_DIR,resolve('/data/assets/jobs'),resolve('/data'),resolve('/outside/jobs')])expect(resolveBackgroundJobConfig({...base,BACKGROUND_JOBS_STORAGE_DIR:value})).toBeNull()
  expect(resolveBackgroundJobConfig({...base,RPC_URL:'http://localhost:8899'})).toBeNull();expect(resolveBackgroundJobConfig({...base,BACKGROUND_JOBS_STORAGE_DIR:'relative/jobs'})).toBeNull()
  expect(JSON.stringify(backgroundJobReadiness(base))).not.toContain('PRIVATE');expect(backgroundJobReadiness({...base,AUTOMATION_WALLET_ENCRYPTION_KEY:'a'.repeat(64)})).not.toHaveProperty('unattendedTrading')
  expect(resolveBackgroundJobConfig({...base,FUNDING_STORAGE_DIR:base.BACKGROUND_JOBS_STORAGE_DIR})).toBeNull()
  expect(resolveBackgroundJobConfig({...base,AUTOMATION_STORAGE_DIR:base.BACKGROUND_JOBS_STORAGE_DIR})).toBeNull()
 })
})
