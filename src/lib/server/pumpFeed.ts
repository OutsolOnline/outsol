import {PublicKey,SolanaJSONRPCErrorCode} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {bondingCurvePda,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import bs58 from 'bs58'
import {isAllowedRequestOrigin} from './requestOrigin'

export interface PumpFeedItem {mint:string;name:string;symbol:string;creator:string;timestamp:number;signature:string}
export interface PumpFeedSnapshot {status:'ready'|'unavailable';items:PumpFeedItem[];fetchedAt:string;coverage:'recent-confirmed-transactions';warning?:string}
const PROGRAM=PUMP_PROGRAM_ID.toBase58(),DISCRIMINATOR=Buffer.from([27,114,169,77,222,235,99,118])
const COVERAGE='recent-confirmed-transactions' as const
const WARNING='Limited recent confirmed Pump.fun transaction window; launches may be missed. Unsupported transaction versions are omitted. This feed provides no zero-block or first-block guarantee.'
const UNSUPPORTED_VERSION=Symbol('unsupported transaction version')
const MAX_AGE=300,MAX_ITEMS=30,MAX_RESPONSE=524_288
const U64_MAX=(1n<<64n)-1n
const validSignature=(value:unknown):value is string=>{try{return typeof value==='string'&&value.length>=64&&value.length<=88&&bs58.decode(value).length===64}catch{return false}}
const recent=(value:unknown,now:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=now-MAX_AGE&&value<=now+30
const publicText=(value:unknown,maxBytes:number):value is string=>typeof value==='string'&&!!value.trim()&&Buffer.byteLength(value,'utf8')<=maxBytes&&!/[\u0000-\u001f\u007f]/.test(value)
const unsigned=(value:{toString():string},max=U64_MAX)=>{const text=value.toString();if(!/^\d{1,20}$/.test(text))throw new Error('Invalid event scalar');const number=BigInt(text);if(number>max)throw new Error('Invalid event scalar');return number}

function decodeEvent(encoded:string,signature:string,blockTime:number,now:number):PumpFeedItem|null {
 try {
  if(encoded.length>4096||encoded.length%4!==0||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return null
  const bytes=Buffer.from(encoded,'base64')
  if(bytes.length<8||bytes.length>2048||bytes.toString('base64')!==encoded||!bytes.subarray(0,8).equals(DISCRIMINATOR))return null
  const event=PUMP_SDK.decodeCreateEventBc(bytes.subarray(8))
  if(!publicText(event.name,32)||!publicText(event.symbol,10)||typeof event.uri!=='string'||Buffer.byteLength(event.uri)>1024)return null
  if(!event.quoteMint.equals(PublicKey.default)&&!event.quoteMint.equals(NATIVE_MINT))return null
  if(!event.tokenProgram.equals(TOKEN_PROGRAM_ID)&&!event.tokenProgram.equals(TOKEN_2022_PROGRAM_ID))return null
  if(event.mint.equals(PublicKey.default)||event.creator.equals(PublicKey.default)||event.user.equals(PublicKey.default)||!bondingCurvePda(event.mint).equals(event.bondingCurve))return null
  const timestamp=Number(unsigned(event.timestamp,BigInt(Number.MAX_SAFE_INTEGER)))
  if(!recent(timestamp,now)||Math.abs(timestamp-blockTime)>60)return null
  for(const value of [event.virtualTokenReserves,event.virtualSolReserves,event.realTokenReserves,event.virtualQuoteReserves])unsigned(value)
  if(unsigned(event.tokenTotalSupply)===0n||unsigned(event.creatorFeeBps,10_000n)>10_000n||event.depth!==0||typeof event.isMayhemMode!=='boolean'||typeof event.isCashbackEnabled!=='boolean'||typeof event.isHolderReward!=='boolean')return null
  return {mint:event.mint.toBase58(),name:event.name,symbol:event.symbol,creator:event.creator.toBase58(),timestamp,signature}
 }catch{return null}
}

/** Decode only official Pump events in a successfully completed Pump frame.
 * Events from nested programs and failed (even caught) invocations are ignored. */
export function decodeConfirmedPumpCreates(input:unknown,signature:string,now:number):PumpFeedItem[] {
 if(!validSignature(signature)||!Number.isSafeInteger(now)||!input||typeof input!=='object'||Array.isArray(input))return []
 const tx=input as {err?:unknown;logs?:{err?:unknown};blockTime?:unknown;meta?:{err?:unknown;logMessages?:unknown};transaction?:{signatures?:unknown}}
 if(tx.err!=null||tx.logs?.err!=null||tx.meta?.err!==null||!recent(tx.blockTime,now)||!Array.isArray(tx.transaction?.signatures)||tx.transaction.signatures[0]!==signature)return []
 const logs=tx.meta.logMessages
 if(!Array.isArray(logs)||logs.length>512||logs.some(line=>typeof line!=='string'||line.length>8192)||logs.reduce((sum,line)=>sum+Buffer.byteLength(line),0)>262_144)return []
 const stack:Array<{program:string;events:PumpFeedItem[]}>=[],confirmed:PumpFeedItem[]=[]
 for(const line of logs as string[]){
  const invoke=/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d{1,2})\]$/.exec(line)
  if(invoke){const depth=Number(invoke[2]);if(depth!==stack.length+1||depth>64)return [];stack.push({program:invoke[1],events:[]});continue}
  const finished=/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed:.*)$/.exec(line)
  if(finished){
   const frame=stack.pop();if(!frame||frame.program!==finished[1])return []
   if(finished[2]==='success'){const destination=stack.length?stack[stack.length-1].events:confirmed;destination.push(...frame.events.slice(0,MAX_ITEMS-destination.length))}
   continue
  }
  if(line==='Log truncated')return []
  if(stack.at(-1)?.program===PROGRAM&&line.startsWith('Program data: ')){
   const item=decodeEvent(line.slice(14),signature,tx.blockTime,now)
   if(item&&stack[stack.length-1].events.length<MAX_ITEMS)stack[stack.length-1].events.push(item)
  }
 }
 if(stack.length)return []
 return [...new Map(confirmed.map(item=>[item.mint,item])).values()].slice(0,MAX_ITEMS)
}

function endpoint():string {
 const value=process.env.RPC_URL
 if(!value)throw new Error('Provider unavailable')
 const url=new URL(value)
 if(url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Provider unavailable')
 return value
}
async function boundedJson(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.ok||Number(response.headers.get('content-length'))>MAX_RESPONSE||!response.body){void response.body?.cancel().catch(()=>{});throw new Error('Provider unavailable')}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0,timedOut=false
 const abort=()=>{timedOut=true;void reader.cancel().catch(()=>{})},timer=setTimeout(abort,4000)
 signal.addEventListener('abort',abort,{once:true})
 try{
  if(signal.aborted)throw new Error('Provider unavailable')
  while(true){const {done,value}=await reader.read();if(timedOut||signal.aborted)throw new Error('Provider unavailable');if(done)break;length+=value.byteLength;if(length>MAX_RESPONSE){void reader.cancel().catch(()=>{});throw new Error('Provider unavailable')}chunks.push(value)}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);reader.releaseLock()}
}

/** One fixed feed per process: shared cache, refresh budget and in-flight work.
 * Transport injection is server-side testing only; requests cannot choose RPC. */
export function createPumpFeedService(upstreamFetch:typeof fetch=fetch,clock:()=>number=Date.now):()=>Promise<PumpFeedSnapshot> {
 let cached:PumpFeedSnapshot|undefined,expires=0,inflight:Promise<PumpFeedSnapshot>|undefined,retained:PumpFeedItem[]=[]
 const seen=new Map<string,true>(),refreshes:number[]=[]
 const unavailable=():PumpFeedSnapshot=>({status:'unavailable',items:[],fetchedAt:new Date(clock()).toISOString(),coverage:COVERAGE,warning:`Pump.fun discovery is temporarily unavailable. ${WARNING}`})
 const refresh=async():Promise<PumpFeedSnapshot>=>{
  const now=clock(),seconds=Math.floor(now/1000)
  while(refreshes.length&&refreshes[0]<=now-60_000)refreshes.shift()
  if(refreshes.length>=3)return unavailable()
  refreshes.push(now)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000)
  try{
   const provider=endpoint()
   const rpc=async(method:'getSignaturesForAddress'|'getTransaction',params:unknown[])=>{
    if(controller.signal.aborted)throw new Error('Provider unavailable')
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(4000)])
    const response=await upstreamFetch(provider,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal,cache:'no-store',redirect:'error'})
    const data=await boundedJson(response,signal) as {jsonrpc?:unknown;id?:unknown;error?:{code?:unknown};result?:unknown}
    // A newer transaction format is outside this fixed version-0 reader's
    // coverage, not evidence that the provider or every other sample failed.
    if(method==='getTransaction'&&data&&typeof data==='object'&&!Array.isArray(data)&&data.jsonrpc==='2.0'&&data.id===1&&data.error&&typeof data.error==='object'&&!Array.isArray(data.error)&&data.error.code===SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION&&!Object.prototype.hasOwnProperty.call(data,'result'))return UNSUPPORTED_VERSION
    if(!data||typeof data!=='object'||data.error||!Object.prototype.hasOwnProperty.call(data,'result'))throw new Error('Provider unavailable')
    return data.result
   }
   const recentSignatures=await rpc('getSignaturesForAddress',[PROGRAM,{limit:12,commitment:'confirmed'}])
   if(!Array.isArray(recentSignatures))throw new Error('Provider unavailable')
   const selected=recentSignatures.slice(0,12).filter((value):value is {signature:string;err:null;slot:number;blockTime:number|null;confirmationStatus:string}=>value&&typeof value==='object'&&validSignature(value.signature)&&value.err===null&&Number.isSafeInteger(value.slot)&&value.slot>=0&&(value.blockTime===null||recent(value.blockTime,seconds))&&['confirmed','finalized'].includes(value.confirmationStatus)&&!seen.has(value.signature))
   const signatures=[...new Set(selected.map(value=>value.signature))],found:PumpFeedItem[]=[],visited:string[]=[]
   let cursor=0
   await Promise.all(Array.from({length:Math.min(2,signatures.length)},async()=>{
    try{while(cursor<signatures.length){if(controller.signal.aborted)throw new Error('Provider unavailable');const signature=signatures[cursor++],tx=await rpc('getTransaction',[signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);if(tx===UNSUPPORTED_VERSION){visited.push(signature);continue}if(tx!==null){found.push(...decodeConfirmedPumpCreates(tx,signature,seconds));visited.push(signature)}}}
    catch(error){controller.abort();throw error}
   }))
   for(const signature of visited){seen.set(signature,true);if(seen.size>256)seen.delete(seen.keys().next().value!)}
   const latestSeconds=Math.floor(clock()/1000)
   retained=[...new Map([...retained,...found].filter(item=>recent(item.timestamp,latestSeconds)).sort((a,b)=>b.timestamp-a.timestamp).map(item=>[item.mint,item])).values()].slice(0,MAX_ITEMS)
   return {status:'ready',items:retained.map(item=>({...item})),fetchedAt:new Date(clock()).toISOString(),coverage:COVERAGE,warning:WARNING}
  }catch{return unavailable()}
  finally{clearTimeout(timer)}
 }
 return async()=>{
  if(cached&&clock()<expires)return {...cached,items:cached.items.map(item=>({...item}))}
  if(!inflight)inflight=refresh().then(snapshot=>{cached=snapshot;expires=clock()+20_000;return snapshot}).finally(()=>{inflight=undefined})
  const snapshot=await inflight
  return {...snapshot,items:snapshot.items.map(item=>({...item}))}
 }
}

/** Read-only HTTP boundary. Limits are per process; the aggregate cap also
 * bounds requests when forwarded client addresses are changed. */
export function createPumpFeedHandler(upstreamFetch:typeof fetch=fetch,clock:()=>number=Date.now){
 const feed=createPumpFeedService(upstreamFetch,clock),clients=new Map<string,{count:number;expires:number}>();let globalWindow={count:0,expires:0}
 return async(request:Request):Promise<Response>=>{
  const headers={'Cache-Control':'no-store','Content-Type':'application/json'},reject=(status:number,warning:string)=>Response.json({status:'unavailable',items:[],fetchedAt:new Date(clock()).toISOString(),coverage:COVERAGE,warning},{status,headers})
  try{
   if(!isAllowedRequestOrigin(request))return reject(403,'Origin not allowed')
   const now=clock();if(now>=globalWindow.expires)globalWindow={count:0,expires:now+60_000}
   const client=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,64)||'unknown'
   if(clients.size>=1000)for(const [key,value] of clients)if(value.expires<=now)clients.delete(key)
   if(clients.size>=1000&&!clients.has(client))return reject(429,'Discovery is busy; retry shortly')
   const prior=clients.get(client),quota=prior&&prior.expires>now?prior:{count:0,expires:now+60_000};clients.set(client,quota)
   if(++quota.count>30)return reject(429,'Discovery rate limit; retry shortly')
   if(++globalWindow.count>120)return reject(429,'Discovery rate limit; retry shortly')
   if(request.method!=='GET'||new URL(request.url).searchParams.size!==0)return reject(400,'Only the fixed Pump.fun feed is available; query parameters are not supported')
   const snapshot=await feed()
   return Response.json(snapshot,{status:snapshot.status==='ready'?200:503,headers})
  }catch{return reject(503,'Pump.fun discovery is temporarily unavailable')}
 }
}
