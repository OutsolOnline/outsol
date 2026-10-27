import {afterEach,describe,expect,it,vi} from 'vitest'
import {Keypair,PublicKey} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {bondingCurvePda,PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import bs58 from 'bs58'
import {createPumpFeedHandler,createPumpFeedService,decodeConfirmedPumpCreates} from '../src/lib/server/pumpFeed'

const NOW=1_798_992_000_000,PUMP=PUMP_PROGRAM_ID.toBase58(),signature=bs58.encode(new Uint8Array(64).fill(9))
const string=(text:string)=>{const bytes=Buffer.from(text),length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes])}
const u64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes}
function event(overrides:{name?:string;symbol?:string;quote?:PublicKey;tokenProgram?:PublicKey;curve?:PublicKey;timestamp?:number;mint?:PublicKey}={}){
 const mint=overrides.mint??Keypair.generate().publicKey,creator=Keypair.generate().publicKey
 return {mint:mint.toBase58(),creator:creator.toBase58(),data:Buffer.concat([Buffer.from([27,114,169,77,222,235,99,118]),string(overrides.name??'Feed Test'),string(overrides.symbol??'FEED'),string('https://example.com/token.json'),mint.toBuffer(),(overrides.curve??bondingCurvePda(mint)).toBuffer(),creator.toBuffer(),creator.toBuffer(),u64(BigInt(overrides.timestamp??NOW/1000)),u64(1_000_000n),u64(30_000_000_000n),u64(800_000n),u64(1_000_000n),(overrides.tokenProgram??TOKEN_2022_PROGRAM_ID).toBuffer(),Buffer.from([0,0]),(overrides.quote??PublicKey.default).toBuffer(),u64(30_000_000_000n),u64(0n),Buffer.from([0,0])]).toString('base64')}
}
function transaction(data:string,logs?:string[]){return {blockTime:NOW/1000,slot:100,transaction:{signatures:[signature]},meta:{err:null,logMessages:logs??[`Program ${PUMP} invoke [1]`,`Program data: ${data}`,`Program ${PUMP} success`]}}}
function rpc(result:unknown){return Response.json({jsonrpc:'2.0',id:1,result})}
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()})
describe('confirmed Pump create feed decoder',()=>{
 it.each([PublicKey.default,NATIVE_MINT])('decodes official SDK CreateEvent bytes for SOL quote %s',quote=>{
  const created=event({quote}),items=decodeConfirmedPumpCreates(transaction(created.data),signature,NOW/1000)
  expect(items).toEqual([{mint:created.mint,creator:created.creator,name:'Feed Test',symbol:'FEED',timestamp:NOW/1000,signature}])
 })
 it.each(['wrong-emitter','nested-emitter','failed-invocation','failed-transaction','malformed-base64','wrong-discriminator','non-sol','bad-curve','bad-program','oversized-name','old','future','truncated','mismatched-signature'])('rejects %s data without publishing an item',kind=>{
  let created=event(),logs:undefined|string[]
  if(kind==='non-sol')created=event({quote:Keypair.generate().publicKey})
  if(kind==='bad-curve')created=event({curve:Keypair.generate().publicKey})
  if(kind==='bad-program')created=event({tokenProgram:Keypair.generate().publicKey})
  if(kind==='oversized-name')created=event({name:'🐸'.repeat(9)})
  if(kind==='old')created=event({timestamp:NOW/1000-301})
  if(kind==='future')created=event({timestamp:NOW/1000+31})
  if(kind==='malformed-base64')created.data='not base64!!'
  if(kind==='wrong-discriminator'){const bytes=Buffer.from(created.data,'base64');bytes[0]=0;created.data=bytes.toString('base64')}
  const other=Keypair.generate().publicKey.toBase58()
  if(kind==='wrong-emitter')logs=[`Program ${other} invoke [1]`,`Program data: ${created.data}`,`Program ${other} success`]
  if(kind==='nested-emitter')logs=[`Program ${PUMP} invoke [1]`,`Program ${other} invoke [2]`,`Program data: ${created.data}`,`Program ${other} success`,`Program ${PUMP} success`]
  if(kind==='failed-invocation')logs=[`Program ${PUMP} invoke [1]`,`Program data: ${created.data}`,`Program ${PUMP} failed: custom program error`]
  if(kind==='truncated')logs=[`Program ${PUMP} invoke [1]`,`Program data: ${created.data}`]
  const tx=transaction(created.data,logs)
  if(kind==='failed-transaction')(tx.meta as {err:unknown}).err={InstructionError:[0,'Custom']}
  if(kind==='mismatched-signature')tx.transaction.signatures=['other']
  expect(decodeConfirmedPumpCreates(tx,signature,NOW/1000)).toEqual([])
 })
 it('accepts a legacy SPL token event but ignores a failed child emitter',()=>{
  const created=event({tokenProgram:TOKEN_PROGRAM_ID}),other=Keypair.generate().publicKey.toBase58()
  const logs=[`Program ${PUMP} invoke [1]`,`Program ${other} invoke [2]`,`Program data: ${created.data}`,`Program ${other} failed: ignored`,`Program data: ${created.data}`,`Program ${PUMP} success`]
  expect(decodeConfirmedPumpCreates(transaction(created.data,logs),signature,NOW/1000)).toHaveLength(1)
 })
})
describe('bounded server Pump feed transport',()=>{
 it('omits only unsupported-version transactions, keeps supported creations, and remembers both signatures',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');let now=NOW
  const unsupported=bs58.encode(new Uint8Array(64).fill(10)),created=event(),methods:string[]=[]
  const feed=createPumpFeedService(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));methods.push(body.method)
   if(body.method==='getSignaturesForAddress')return rpc([unsupported,signature].map(signature=>({signature,err:null,slot:100,blockTime:NOW/1000,confirmationStatus:'confirmed'})))
   expect(body.params[1]).toEqual({encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'})
   if(body.params[0]===unsupported)return Response.json({jsonrpc:'2.0',id:1,error:{code:-32015,message:'do-not-reveal upstream payload'}})
   return rpc(transaction(created.data))
  },()=>now)
  const result=await feed()
  expect(result.status).toBe('ready');expect(result.items.map(item=>item.mint)).toEqual([created.mint]);expect(result.warning).toMatch(/unsupported.*versions.*omitted/i)
  expect(JSON.stringify(result)).not.toContain('do-not-reveal')
  expect(methods.filter(method=>method==='getTransaction')).toHaveLength(2)
  now+=20_000;expect((await feed()).status).toBe('ready')
  expect(methods.filter(method=>method==='getTransaction')).toHaveLength(2)
 })
 it('returns a ready empty sample when every sampled transaction has an unsupported version',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key')
  const feed=createPumpFeedService(async(_url,init)=>JSON.parse(String(init?.body)).method==='getSignaturesForAddress'?rpc([{signature,err:null,slot:100,blockTime:NOW/1000,confirmationStatus:'confirmed'}]):Response.json({jsonrpc:'2.0',id:1,error:{code:-32015}}),()=>NOW)
  const result=await feed();expect(result.status).toBe('ready');expect(result.items).toEqual([]);expect(result.warning).toMatch(/unsupported.*versions.*omitted/i)
 })
 it.each(['signature-version-error','other-rpc-error','string-error-code','http-429','http-401','malformed-json'])('preserves HTTP 503 for %s instead of omitting an uncertain provider failure',async kind=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key')
  const handler=createPumpFeedHandler(async(_url,init)=>{
   const body=JSON.parse(String(init?.body))
   if(body.method==='getSignaturesForAddress'&&kind!=='signature-version-error')return rpc([{signature,err:null,slot:100,blockTime:NOW/1000,confirmationStatus:'confirmed'}])
   if(kind==='http-429'||kind==='http-401')return Response.json({error:'do-not-reveal'},{status:kind==='http-429'?429:401})
   if(kind==='malformed-json')return new Response('{broken')
   return Response.json({jsonrpc:'2.0',id:1,error:{code:kind==='signature-version-error'?-32015:kind==='string-error-code'?'-32015':-32005,message:'do-not-reveal'}})
  },()=>NOW)
  const response=await handler(new Request('https://outsol.example/api/pump-feed')),value=await response.json()
  expect(response.status).toBe(503);expect(value.status).toBe('unavailable');expect(value.items).toEqual([]);expect(JSON.stringify(value)).not.toContain('do-not-reveal')
 })
 it('coalesces clients, caches for 20 seconds and avoids rereading seen signatures',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');let now=NOW,calls=0
  const created=event(),methods:string[]=[]
  const feed=createPumpFeedService(async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));methods.push(body.method);if(body.method==='getSignaturesForAddress'){expect(body.params).toEqual([PUMP,{limit:12,commitment:'confirmed'}]);return rpc([{signature,err:null,slot:100,blockTime:NOW/1000,confirmationStatus:'confirmed'}])}expect(body.params[1]).toEqual({encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'});return rpc(transaction(created.data))},()=>now)
  const snapshots=await Promise.all(Array.from({length:20},()=>feed()))
  expect(snapshots.every(snapshot=>snapshot.status==='ready'&&snapshot.items.length===1)).toBe(true)
  expect(calls).toBe(2)
  now+=19_999;await feed();expect(calls).toBe(2)
  now+=1;expect((await feed()).items).toHaveLength(1)
  expect(methods).toEqual(['getSignaturesForAddress','getTransaction','getSignaturesForAddress'])
  now+=301_000;expect((await feed()).items).toEqual([])
 })
 it('caps transaction reads at 12 and concurrency at 2 even when upstream sends more signatures',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');let active=0,maxActive=0,transactions=0
  const signatures=Array.from({length:30},(_,index)=>({signature:bs58.encode(new Uint8Array(64).fill(index+1)),err:null,slot:100,blockTime:NOW/1000,confirmationStatus:'confirmed'}))
  const feed=createPumpFeedService(async(_url,init)=>{const body=JSON.parse(String(init?.body));if(body.method==='getSignaturesForAddress')return rpc(signatures);transactions++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return rpc(null)},()=>NOW)
  expect((await feed()).status).toBe('ready');expect(transactions).toBe(12);expect(maxActive).toBe(2)
 })
 it('deduplicates mints and retains at most 30 real recent creations',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');let now=NOW,batch=0
  const transactions=new Map<string,ReturnType<typeof transaction>>()
  const feed=createPumpFeedService(async(_url,init)=>{
   const body=JSON.parse(String(init?.body))
   if(body.method==='getSignaturesForAddress')return rpc(Array.from({length:12},(_,index)=>{
    const sig=bs58.encode(new Uint8Array(64).fill(++batch)),created=event({timestamp:now/1000}),tx=transaction(created.data);tx.blockTime=now/1000;tx.transaction.signatures=[sig];transactions.set(sig,tx)
    return {signature:sig,err:null,slot:100+index,blockTime:now/1000,confirmationStatus:'confirmed'}
   }))
   return rpc(transactions.get(body.params[0]))
  },()=>now)
  expect((await feed()).items).toHaveLength(12)
  now+=20_000;expect((await feed()).items).toHaveLength(24)
  now+=20_000;const items=(await feed()).items;expect(items).toHaveLength(30);expect(new Set(items.map(item=>item.mint)).size).toBe(30)
 })
 it('times out an unfinished response body and caches the unavailable result',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');vi.useFakeTimers();let calls=0
  const feed=createPumpFeedService(async()=>{calls++;return new Response(new ReadableStream<Uint8Array>())},()=>NOW)
  const pending=feed();await vi.advanceTimersByTimeAsync(4001)
  expect((await pending).status).toBe('unavailable');expect((await feed()).status).toBe('unavailable');expect(calls).toBe(1)
 })
 it('scrubs JSON RPC errors and refuses a declared oversized body without reading it',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key')
  const failed=createPumpFeedService(async()=>Response.json({jsonrpc:'2.0',id:1,error:{message:'private-key',data:'https://rpc.example/private-key'}}),()=>NOW)
  expect(JSON.stringify(await failed())).not.toContain('private-key')
  const oversized=createPumpFeedService(async()=>new Response('{}',{headers:{'content-length':'524289'}}),()=>NOW)
  expect((await oversized()).status).toBe('unavailable')
 })
 it.each(['missing','insecure','error','oversized'])('returns no invented feed items or credentials on %s provider',async kind=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('RPC_URL',kind==='missing'?'':kind==='insecure'?'http://rpc.example/private-key':'https://rpc.example/private-key')
  let calls=0
  const feed=createPumpFeedService(async()=>{calls++;if(kind==='oversized')return new Response('x'.repeat(524_289));throw new Error('https://rpc.example/private-key failed')},()=>NOW)
  const result=await feed();expect(result.status).toBe('unavailable');expect(result.items).toEqual([]);expect(JSON.stringify(result)).not.toContain('private-key')
  if(kind==='missing'||kind==='insecure')expect(calls).toBe(0)
 })
 it('rejects foreign origins and all query variations before contacting RPC',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');let calls=0
  const handler=createPumpFeedHandler(async()=>{calls++;return rpc([])},()=>NOW)
  expect((await handler(new Request('https://outsol.example/api/pump-feed',{headers:{origin:'https://evil.example'}}))).status).toBe(403)
  for(const query of ['?source=https://evil.example','?limit=100','?mint=abc'])expect((await handler(new Request(`https://outsol.example/api/pump-feed${query}`))).status).toBe(400)
  expect(calls).toBe(0)
 })
 it('limits each client to 30 requests and all clients to 120 per minute',async()=>{
  vi.stubEnv('RPC_URL','https://rpc.example/private-key');let calls=0
  const handler=createPumpFeedHandler(async()=>{calls++;return rpc([])},()=>NOW),request=(client:string)=>new Request('https://outsol.example/api/pump-feed',{headers:{'x-forwarded-for':client}})
  for(let client=0;client<4;client++){for(let index=0;index<30;index++)expect((await handler(request(String(client)))).status).toBe(200);expect((await handler(request(String(client)))).status).toBe(429)}
  expect((await handler(request('fifth-client'))).status).toBe(429);expect(calls).toBe(1)
 })
})
