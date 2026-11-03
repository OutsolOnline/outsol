import {afterEach,describe,it,expect,vi} from 'vitest'
import {Keypair,PublicKey} from '@solana/web3.js'
import {MintLayout,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import bs58 from 'bs58'
import {createTokenMarketService,createTokenMarketHandler} from '../src/lib/server/tokenMarket'
import {ObservedBuyWatcher} from '../src/lib/tradingSessions/observedTrades'
import {NOW,PUMP,mint,wallet,signature,tx,tradeBytes} from './token-market-fixtures'
const rpc=(result:unknown)=>Response.json({jsonrpc:'2.0',id:1,result})
function account(data:Buffer,owner=TOKEN_PROGRAM_ID.toBase58()){return {data:[data.toString('base64'),'base64'],owner,executable:false,lamports:2039280,rentEpoch:0,space:data.length}}
function mintBank(){
 const data=Buffer.alloc(82);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1_000_000_000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data)
 const curve=Buffer.alloc(81);Buffer.from([23,183,248,55,96,216,172,96]).copy(curve);for(let i=0;i<5;i++)curve.writeBigUInt64LE(1_000_000_000n,8+i*8);new PublicKey(wallet).toBuffer().copy(curve,49)
 return {context:{slot:100},value:[account(data),account(curve,PUMP)]}
}
function tokenAccount(owner:string,amount:bigint){const data=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(data);new PublicKey(owner).toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;return account(data)}
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()})

describe('bounded private token-market RPC boundary',()=>{
 it('keeps two sampled accounts under one owner without claiming complete holder coverage',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-token');const methods:string[]=[],addresses=[Keypair.generate().publicKey.toBase58(),Keypair.generate().publicKey.toBase58()]
  const service=createTokenMarketService(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));methods.push(body.method)
   if(body.method==='getMultipleAccounts')return rpc(body.params[0][0]===mint?mintBank():{context:{slot:101},value:[tokenAccount(wallet,100_000_000n),tokenAccount(wallet,200_000_000n)]})
   if(body.method==='getTokenLargestAccounts')return rpc({context:{slot:100},value:addresses.map(address=>({address,amount:'0',decimals:6,uiAmount:null,uiAmountString:'0'}))})
   if(body.method==='getSignaturesForAddress')return rpc([{signature,slot:100,err:null,blockTime:NOW/1000,confirmationStatus:'confirmed'}])
   return rpc(tx())
  },()=>NOW)
  const result=await service(mint)
  expect(result.status).toBe('ready');expect(result.distribution).toMatchObject({status:'ready',sampledAccounts:2,sampledSupplyPct:30,owners:[{owner:wallet,amountRaw:'300000000',accounts:2,supplyPct:30}]})
  expect(result.coverage).toMatchObject({requested:1,read:1,complete:false})
  expect(result.trades).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('private-token')
  expect(methods.filter(method=>method==='getTransaction')).toHaveLength(1)
 })
 it('caps transaction reads at 12, concurrency at 2 and coalesces repeated mint work',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-token');let active=0,max=0,reads=0
  const service=createTokenMarketService(async(_url,init)=>{
   const body=JSON.parse(String(init?.body))
   if(body.method==='getMultipleAccounts')return rpc(mintBank())
   if(body.method==='getTokenLargestAccounts')return rpc({context:{slot:100},value:[]})
   if(body.method==='getSignaturesForAddress'){expect(body.params[1]).toEqual({limit:12,commitment:'confirmed'});return rpc(Array.from({length:50},(_,i)=>({signature:bs58.encode(new Uint8Array(64).fill(i+1)),slot:100,err:null,blockTime:NOW/1000,confirmationStatus:'confirmed'})))}
   reads++;max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return rpc(null)
  },()=>NOW)
  const rows=await Promise.all(Array.from({length:15},()=>service(mint)))
  expect(reads).toBe(12);expect(max).toBe(2);expect(rows[0].coverage).toMatchObject({requested:12,missing:12,read:0,complete:false})
 })
 it('reports unavailable/malformed/unsupported samples explicitly while retaining supported events',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-token')
  const signatures=[signature,...[8,9,10].map(n=>bs58.encode(new Uint8Array(64).fill(n)))]
  const service=createTokenMarketService(async(_url,init)=>{
   const body=JSON.parse(String(init?.body))
   if(body.method==='getMultipleAccounts')return rpc(mintBank())
   if(body.method==='getTokenLargestAccounts')throw new Error('secret')
   if(body.method==='getSignaturesForAddress')return rpc(signatures.map(signature=>({signature,err:null,slot:100,confirmationStatus:'confirmed'})))
   const index=signatures.indexOf(body.params[0])
   if(index===1)return rpc(null)
   if(index===2)return Response.json({jsonrpc:'2.0',id:1,error:{code:-32015,message:'secret'}})
   if(index===3)return rpc({meta:{err:null}})
   return rpc(tx())
  },()=>NOW)
  const result=await service(mint)
  expect(result.status).toBe('ready');expect(result.trades).toHaveLength(1);expect(result.coverage).toMatchObject({requested:4,read:1,missing:1,unsupported:1,invalid:1,complete:false})
  expect(result.distribution.status).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('secret')
 })
 it('returns receipt-only evidence without scanning history or concentration and caches request copies safely',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-token');let reads=0
  const service=createTokenMarketService(async(_url,init)=>{const body=JSON.parse(String(init?.body));if(body.method==='getMultipleAccounts')return rpc(mintBank());expect(body.method).toBe('getTransaction');reads++;return rpc(tx())},()=>NOW)
  const first=await service(mint,[signature]);first.warnings.push('mutated')
  const second=await service(mint,[signature])
  expect(reads).toBe(1);expect(second.coverage.kind).toBe('receipts');expect(second.warnings).not.toContain('mutated')
 })
 it.each(['truncated','unclosed','bad-base64','bad-layout','non-sol'] as const)('marks %s Pump evidence incomplete so an overlapping guard sample stops',async kind=>{
  vi.stubEnv('RPC_URL','https://rpc.example/synthetic')
  const second=bs58.encode(new Uint8Array(64).fill(23)),bad=tx(undefined,second)
  if(kind==='truncated')bad.meta.logMessages.push('Log truncated')
  if(kind==='unclosed')bad.meta.logMessages.pop()
  if(kind==='bad-base64')bad.meta.logMessages[1]='Program data: !!!!'
  if(kind==='bad-layout')bad.meta.logMessages[1]=`Program data: ${Buffer.from([189,219,127,211,78,230,97,238]).toString('base64')}`
  if(kind==='non-sol')bad.meta.logMessages[1]=`Program data: ${tradeBytes({quote:Keypair.generate().publicKey.toBase58()})}`
  const service=createTokenMarketService(async(_url,init)=>{
   const body=JSON.parse(String(init?.body))
   if(body.method==='getMultipleAccounts')return rpc(mintBank())
   if(body.method==='getTokenLargestAccounts')return rpc({context:{slot:100},value:[]})
   if(body.method==='getSignaturesForAddress')return rpc([signature,second].map(signature=>({signature,err:null,slot:100,confirmationStatus:'confirmed'})))
   return rpc(body.params[0]===signature?tx():bad)
  },()=>NOW)
  const result=await service(mint)
  expect(result.coverage).toMatchObject({requested:2,read:1,invalid:kind==='non-sol'?0:1,unsupported:kind==='non-sol'?1:0})
  expect(result.trades).toHaveLength(1)
  const watcher=new ObservedBuyWatcher(mint,{minBuySol:'0.1',whitelist:[]},[],NOW-5000,'cumulative')
  watcher.observe({...result,coverage:{...result.coverage,requested:1,read:1,invalid:0,unsupported:0}},NOW)
  expect(()=>watcher.observe({...result,fetchedAt:new Date(NOW+5000).toISOString()},NOW+5000)).toThrow(/coverage|unreadable/i)
 })
 it('counts a completely parsed non-trade transaction as read',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/synthetic')
  const service=createTokenMarketService(async(_url,init)=>{const body=JSON.parse(String(init?.body));return rpc(body.method==='getMultipleAccounts'?mintBank():tx([]))},()=>NOW)
  expect((await service(mint,[signature])).coverage).toMatchObject({read:1,invalid:0,unsupported:0})
 })
 it('rejects foreign origin, invalid mint, excess signatures and unknown queries before contacting RPC',async()=>{
  let calls=0;const handler=createTokenMarketHandler(async()=>{calls++;return rpc(null)},()=>NOW)
  expect((await handler(new Request(`https://outsol.example/api/token-market?mint=${mint}`,{headers:{origin:'https://evil.example'}}))).status).toBe(403)
  for(const query of ['mint=not-an-address',`mint=${mint}&url=https://evil.example`,`mint=${mint}&${Array.from({length:9},()=>`signature=${signature}`).join('&')}`,`mint=${mint}&mint=${mint}`])expect((await handler(new Request(`https://outsol.example/api/token-market?${query}`))).status).toBe(400)
  expect(calls).toBe(0)
 })
 it('bounds rate/body size and never returns upstream secrets',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-token')
  const handler=createTokenMarketHandler(async()=>new Response('{}',{headers:{'content-length':'1048577'}}),()=>NOW)
  const req=()=>new Request(`https://outsol.example/api/token-market?mint=${mint}`)
  const failed=await handler(req());expect(failed.status).toBe(503);expect(JSON.stringify(await failed.json())).not.toContain('private-token')
  for(let i=1;i<30;i++)await handler(req())
  expect((await handler(req())).status).toBe(429)
 })
})
