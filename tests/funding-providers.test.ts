import {afterEach, describe, expect, it, vi} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseFundingPlan, FundingError} from '../src/lib/fundingProviders/model'
import {FundingStore} from '../src/lib/server/fundingProviders/storage'
import {createSplitNowService} from '../src/lib/server/fundingProviders/splitnow'
import {createFundingHandlers} from '../src/lib/server/fundingProviders/handlers'
import {fundingAvailability} from '../src/lib/server/fundingProviders/config'

const A=Keypair.generate().publicKey.toBase58(), B=Keypair.generate().publicKey.toBase58(), DEPOSIT=Keypair.generate().publicKey.toBase58()
const NOW=1_793_750_400_000, QUOTE='6789abcdef0123456789abcd', KEY='private-provider-key'
const plan=()=>parseFundingPlan({amountSol:'1',recipients:[{address:A},{address:B}]})
const json=(data:unknown)=>Response.json({success:true,data})
const quote=()=>({_id:QUOTE,type:'floating_rate',quoteInput:{fromAmount:1,fromAssetId:'sol',fromNetworkId:'solana'},quoteLegs:[{quoteId:QUOTE,quoteLegInput:{fromAmount:1,fromAssetId:'sol',fromNetworkId:'solana'},quoteLegOutput:{toPctBips:10000,toAmount:0.98,toAssetId:'sol',toNetworkId:'solana',toExchangerId:'binance'}}]})
const order=()=>({shortId:'123456',status:'user_deposit_pending',statusShort:'pending',type:'floating_rate',depositWalletAddress:DEPOSIT,depositAmount:1,expiredAt:new Date(NOW+600_000).toISOString(),orderInput:{fromAmount:1,fromAssetId:'sol',fromNetworkId:'solana'},orderOutputs:[{toAddress:A,toPctBips:5000,toAssetId:'sol',toNetworkId:'solana',toExchangerId:'binance',toAmount:0.49},{toAddress:B,toPctBips:5000,toAssetId:'sol',toNetworkId:'solana',toExchangerId:'binance',toAmount:0.49}]})
const directories:string[]=[]
async function fixture(override?:(url:string,init?:RequestInit)=>Promise<Response>){
 const directory=await mkdtemp(join(tmpdir(),'launchpier-funding-'));directories.push(directory)
 const store=new FundingStore({directory,key:Buffer.alloc(32,19),now:()=>NOW}), calls:{url:string;init?:RequestInit}[]=[]
 const upstream=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
  calls.push({url:String(url),init});if(override)return override(String(url),init)
  if(String(url).endsWith('/assets/limits/'))return Response.json({limits:[{assetId:'sol',minDeposit:0.1,maxDeposit:100}]})
  if(String(url).endsWith('/quotes/'))return json(QUOTE)
  if(String(url).endsWith(`/quotes/${QUOTE}`))return json(quote())
  if(String(url).endsWith('/orders/'))return json({shortId:'123456'})
  return json(order())
 })
 const service=createSplitNowService({store,apiKey:KEY,upstreamFetch:upstream,now:()=>NOW,wait:async()=>{}})
 return {service,store,calls,upstream,directory}
}
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})))})

describe('explicit SOL funding plans',()=>{
 it('allocates integer basis points, preserving exact SOL and canonical wallet addresses',()=>{const p=plan();expect(p).toEqual({amountSol:'1',amountLamports:'1000000000',recipients:[{address:A,shareBps:5000},{address:B,shareBps:5000}]});expect(parseFundingPlan({amountSol:'0.300000001',recipients:[{address:A}]}).amountLamports).toBe('300000001')})
 it.each(['0','-1','1e2',' 1','1.0000000001','1000.000000001','NaN'])('rejects unsafe amount %s',amountSol=>expect(()=>parseFundingPlan({amountSol,recipients:[{address:A}]})).toThrow())
 it('rejects duplicate wallets, private fields, oversized groups and malformed allocation',()=>{
  for(const input of [{amountSol:'1',recipients:[{address:A},{address:A}]},{amountSol:'1',recipients:[{address:A,privateKey:'never'}]},{amountSol:'1',recipients:Array.from({length:21},()=>({address:A}))},{amountSol:'1',recipients:[{address:A,shareBps:9999}]},{amountSol:'1',recipients:[{address:A,shareBps:5000},{address:B}]}])expect(()=>parseFundingPlan(input)).toThrow()
 })
})

describe('documented SplitNOW boundary and capability-owned recovery',()=>{
 it('requests the official SOL route with private authentication and returns no account internals',async()=>{
  const {service,calls}=await fixture();const result=await service.quote(plan())
  expect(result.routes).toEqual([{exchangeId:'binance',estimatedOutputSol:'0.98'}]);expect(result.plan).toEqual(plan());expect(result.capability).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(calls.every(row=>row.url.startsWith('https://splitnow.io/api/')&&row.init?.redirect==='error'&&row.init?.cache==='no-store')).toBe(true)
  const post=calls.find(row=>row.url.endsWith('/quotes/'))!
  expect(post.init?.headers).toMatchObject({'x-api-key':KEY});expect(JSON.parse(String(post.init?.body))).toEqual({type:'floating_rate',quoteInput:{fromAmount:1,fromAssetId:'sol',fromNetworkId:'solana'},quoteOutputs:[{toPctBips:10000,toAssetId:'sol',toNetworkId:'solana'}]})
  expect(JSON.stringify(result)).not.toContain(KEY);expect(JSON.stringify(result)).not.toContain(QUOTE);expect(calls.some(row=>row.url.includes('/orders/'))).toBe(false)
 })
 it('creates exactly one reviewed order under simultaneous retries, then verifies deposit and every recipient',async()=>{
  const {service,calls}=await fixture();const q=await service.quote(plan())
  const results=await Promise.allSettled([service.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true}),service.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true})])
  expect(results.some(row=>row.status==='fulfilled')).toBe(true);expect(calls.filter(row=>row.url.endsWith('/orders/'))).toHaveLength(1)
  const receipt=await service.status(q.capability);expect(receipt.deposit).toEqual({address:DEPOSIT,amountSol:'1',expiresAt:new Date(NOW+600_000).toISOString()});expect(receipt.state).toBe('pending')
  const body=JSON.parse(String(calls.find(row=>row.url.endsWith('/orders/'))!.init?.body));expect(body.orderOutputs.map((row:{toAddress:string;toPctBips:number})=>[row.toAddress,row.toPctBips])).toEqual([[A,5000],[B,5000]])
 })
 it('requires affirmative policy consent and a current supported route before consuming the quote',async()=>{
  const {service,calls}=await fixture();const q=await service.quote(plan())
  for(const review of [{exchangeId:'binance',policiesAccepted:false,reviewConfirmed:true},{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:false},{exchangeId:'evil/route',policiesAccepted:true,reviewConfirmed:true}])await expect(service.createOrder(q.capability,review)).rejects.toBeInstanceOf(FundingError)
  expect(calls.filter(row=>row.url.endsWith('/orders/'))).toHaveLength(0)
  expect((await service.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true})).state).toBe('pending')
 })
 it('never creates a second order after an ambiguous provider POST failure',async()=>{
  const base=await fixture();const alternate=createSplitNowService({store:base.store,apiKey:KEY,now:()=>NOW,wait:async()=>{},upstreamFetch:async(url,init)=>{if(String(url).endsWith('/orders/'))throw new Error(`leaked ${KEY}`);return base.upstream(url,init)}})
  const q=await alternate.quote(plan());const receipt=await alternate.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true})
  expect(receipt.state).toBe('uncertain');expect(JSON.stringify(receipt)).not.toContain(KEY)
  expect((await alternate.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true})).state).toBe('uncertain')
 })
 it('blocks stale quotes and minimum allocations without creating an order',async()=>{
  const {service,store,calls}=await fixture();const q=await service.quote(plan());const later=createSplitNowService({store,apiKey:KEY,upstreamFetch:async()=>{throw new Error('unexpected')},now:()=>NOW+61_000,wait:async()=>{}})
  await expect(later.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true})).rejects.toMatchObject({code:'quote_expired'})
  await expect(service.quote(parseFundingPlan({amountSol:'0.1',recipients:[{address:A},{address:B}]}))).rejects.toMatchObject({code:'deposit_limit'})
  expect(calls.filter(row=>row.url.endsWith('/orders/'))).toHaveLength(0)
 })
 it('does not reveal or query another owner’s order using short IDs or guessed capabilities',async()=>{
  const {service,calls}=await fixture();const q=await service.quote(plan());await service.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true});const count=calls.length
  await expect(service.status('123456')).rejects.toMatchObject({code:'not_found'});await expect(service.status('z'.repeat(43))).rejects.toMatchObject({code:'not_found'});expect(calls).toHaveLength(count)
 })
 it('rejects a changed network, amount, recipient or allocation before disclosing a deposit address',async()=>{
  for(const mutate of [(o:ReturnType<typeof order>)=>{o.orderInput.fromNetworkId='ethereum'},(o:ReturnType<typeof order>)=>{o.orderInput.fromAmount=2},(o:ReturnType<typeof order>)=>{o.orderInput.fromAmount=1.0000000001},(o:ReturnType<typeof order>)=>{o.orderOutputs[1].toAddress=A},(o:ReturnType<typeof order>)=>{o.orderOutputs[1].toPctBips=4000}]){
   const base=await fixture();const guarded=createSplitNowService({store:base.store,apiKey:KEY,now:()=>NOW,wait:async()=>{},upstreamFetch:async(url,init)=>{if(String(url).endsWith('/orders/123456')){const o=order();mutate(o);return json(o)}return base.upstream(url,init)}})
   const q=await guarded.quote(plan());const receipt=await guarded.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true});expect(receipt.deposit).toBeUndefined();expect(receipt.state).toBe('verification_required')
  }
 })
 it('persists encrypted records across instances with hashed capability filenames',async()=>{
  const {service,directory}=await fixture();const q=await service.quote(plan());await service.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true})
  const names=await readdir(directory);expect(names.every(name=>!name.includes(q.capability))).toBe(true)
  for(const name of names){const text=await readFile(join(directory,name),'utf8');expect(text).not.toContain(q.capability);expect(text).not.toContain(A);expect(text).not.toContain(KEY)}
  const restored=new FundingStore({directory,key:Buffer.alloc(32,19),now:()=>NOW});expect((await restored.getOrder(q.capability))?.orderId).toBe('123456')
 })
 it('scrubs provider errors, bounds response bytes, and enforces aggregate upstream capacity',async()=>{
  const bad=await fixture(async()=>new Response(KEY.repeat(100_000),{headers:{'content-length':'2000000'}}));await expect(bad.service.quote(plan())).rejects.toMatchObject({code:'provider_unavailable'})
  const {service}=await fixture();for(let i=0;i<6;i++)await service.quote(plan());await expect(service.quote(plan())).rejects.toMatchObject({code:'rate_limit'})
 })
 it('withholds expired deposit instructions and labels completion as provider-reported',async()=>{
  for(const completed of [false,true]){
   const base=await fixture();const guarded=createSplitNowService({store:base.store,apiKey:KEY,now:()=>NOW,wait:async()=>{},upstreamFetch:async(url,init)=>{if(String(url).endsWith('/orders/123456')){const o=order();o.expiredAt=new Date(NOW-1000).toISOString();if(completed){o.status='completed';o.statusShort='completed'}return json(o)}return base.upstream(url,init)}})
   const q=await guarded.quote(plan());const receipt=await guarded.createOrder(q.capability,{exchangeId:'binance',policiesAccepted:true,reviewConfirmed:true});expect(receipt.state).toBe(completed?'completed':'expired');expect(receipt.deposit).toBeUndefined();if(completed)expect(receipt.message).toContain('Provider reports')
  }
 })
})

describe('funding HTTP safety',()=>{
 it('returns setup-required without contacting providers or leaking keys',async()=>{
  const upstream=vi.fn();const handlers=createFundingHandlers({service:()=>{throw new FundingError('setup_required',503,'Provider funding setup is required.')}})
  const response=await handlers.quote(new Request('https://app.example/api/funding-providers/quote',{method:'POST',headers:{origin:'https://app.example','content-type':'application/json'},body:JSON.stringify({amountSol:'1',recipients:[{address:A}]})}));expect(response.status).toBe(503);expect(upstream).not.toHaveBeenCalled();expect(await response.text()).toContain('setup_required')
 })
 it('rejects cross-origin, oversize requests and absent recovery credentials before provider access',async()=>{
  const get=vi.fn();const handlers=createFundingHandlers({service:get})
  expect((await handlers.quote(new Request('https://app.example/api/funding-providers/quote',{method:'POST',headers:{origin:'https://other.example'},body:'{}'}))).status).toBe(403)
  expect((await handlers.quote(new Request('https://app.example/api/funding-providers/quote',{method:'POST',headers:{'content-type':'application/json','content-length':'999999'},body:'{}'}))).status).toBe(413)
  expect((await handlers.status(new Request('https://app.example/api/funding-providers/status',{method:'POST'}))).status).toBe(404);expect(get).not.toHaveBeenCalled()
 })
 it('keeps configuration flags honest and refuses private-store overlap',()=>{
  vi.stubEnv('SPLITNOW_FUNDING_ENABLED','true');vi.stubEnv('SPLITNOW_API_KEY',KEY);vi.stubEnv('FUNDING_STORAGE_KEY',Buffer.alloc(32,7).toString('base64'));vi.stubEnv('RAILWAY_VOLUME_MOUNT_PATH',join(tmpdir(),'launchpier-volume'));vi.stubEnv('FUNDING_STORAGE_DIR',join(tmpdir(),'launchpier-volume','funding'))
  expect(fundingAvailability().splitnow.configured).toBe(true);expect(JSON.stringify(fundingAvailability())).not.toContain(KEY)
  for(const name of ['ASSET_STORAGE_DIR','X_STORAGE_DIR','BACKGROUND_JOBS_STORAGE_DIR','AUTOMATION_STORAGE_DIR']){vi.stubEnv(name,join(tmpdir(),'launchpier-volume','funding'));expect(fundingAvailability().splitnow.configured).toBe(false);vi.stubEnv(name,'')}
  expect(fundingAvailability().husher.status).toBe('partner_access_required');expect(fundingAvailability().liveProviderAcceptanceVerified).toBe(false)
 })
})
