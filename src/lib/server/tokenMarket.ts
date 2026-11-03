import {PublicKey,type AccountInfo} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount} from '@solana/spl-token'
import {bondingCurvePda,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {canonicalAddress,canonicalSignature,decodeConfirmedPumpEvidence,mergeTrades,buildCandles} from '../market/events'
import {decodeConfirmedBalanceChanges} from '../accounting/fills'
import type {TokenMarketSnapshot,TokenAccountDistribution} from '../market/types'
import {isAllowedRequestOrigin} from './requestOrigin'

const VERSION=Symbol('unsupported-version'),MAX_BODY=1_048_576,WINDOW=20_000
const COVERAGE='Bounded confirmed Pump.fun bonding-curve transaction sample. PumpSwap trades, full history, exact intra-slot order and a complete holder count are not covered.'
const emptyDistribution=():TokenAccountDistribution=>({status:'unavailable',owners:[],sampledAccounts:0,sampledAmountRaw:'0',sampledSupplyPct:null,slot:null})
function snapshot(mint:string,now:number,receipt=false):TokenMarketSnapshot{return {status:'unavailable',mint,fetchedAt:new Date(now).toISOString(),decimals:null,supplyRaw:null,curveStatus:'unverified',trades:[],candles:[],distribution:emptyDistribution(),balanceChanges:[],coverage:{kind:receipt?'receipts':'recent',requested:0,read:0,missing:0,unsupported:0,failed:0,invalid:0,complete:false},warnings:[COVERAGE]}}
function endpoint(){
 const value=process.env.RPC_URL;if(!value)throw new Error('Provider unavailable')
 const url=new URL(value)
 if(url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Provider unavailable')
 return value
}
async function boundedJson(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.ok||Number(response.headers.get('content-length'))>MAX_BODY||!response.body){void response.body?.cancel().catch(()=>{});throw new Error('Provider unavailable')}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,aborted=false
 const cancel=()=>{aborted=true;void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true})
 try{
  if(signal.aborted)throw new Error('Provider unavailable')
  while(true){const {done,value}=await reader.read();if(aborted||signal.aborted)throw new Error('Provider unavailable');if(done)break;size+=value.length;if(size>MAX_BODY){cancel();throw new Error('Provider unavailable')}chunks.push(value)}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result))
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
function account(input:unknown):AccountInfo<Buffer>{
 const row=input as {data?:unknown;owner?:unknown;lamports?:unknown;executable?:unknown}
 if(!row||!canonicalAddress(row.owner)||row.executable!==false||typeof row.lamports!=='number'||!Number.isSafeInteger(row.lamports)||row.lamports<0||!Array.isArray(row.data)||row.data.length!==2||row.data[1]!=='base64'||typeof row.data[0]!=='string'||row.data[0].length>22_000)throw new Error('Invalid account')
 const data=Buffer.from(row.data[0],'base64');if(data.toString('base64')!==row.data[0])throw new Error('Invalid account')
 return {data,owner:new PublicKey(row.owner),lamports:row.lamports,executable:false}
}
function bank(input:unknown):{slot:number;value:unknown[]}{const row=input as {context?:{slot?:unknown};value?:unknown};if(!row||!Number.isSafeInteger(row.context?.slot)||Number(row.context?.slot)<0||!Array.isArray(row.value))throw new Error('Invalid bank');return {slot:Number(row.context!.slot),value:row.value}}
function validTx(input:unknown,signature:string):input is {slot:number;blockTime:number;meta:{err:unknown};transaction:{signatures:string[]}}{
 const row=input as {slot?:unknown;blockTime?:unknown;meta?:{err?:unknown};transaction?:{signatures?:unknown}}
 return !!row&&typeof row==='object'&&Number.isSafeInteger(row.slot)&&Number(row.slot)>=0&&Number.isSafeInteger(row.blockTime)&&Number(row.blockTime)>=1_577_836_800&&!!row.meta&&Object.hasOwn(row.meta,'err')&&Array.isArray(row.transaction?.signatures)&&row.transaction.signatures[0]===signature
}

/** Fixed server RPC only. Per-process cache/inflight/refresh caps bound arbitrary
 * mint requests; each refresh reads <=12 tx (<=8 explicit receipts), concurrency 2. */
export function createTokenMarketService(upstreamFetch:typeof fetch=fetch,clock:()=>number=Date.now){
 const cache=new Map<string,{expires:number;value:TokenMarketSnapshot}>(),inflight=new Map<string,Promise<TokenMarketSnapshot>>(),refreshes:number[]=[]
 const refresh=async(mint:string,signatures:string[]):Promise<TokenMarketSnapshot>=>{
  const result=snapshot(mint,clock(),signatures.length>0),now=clock()
  while(refreshes.length&&refreshes[0]<=now-60_000)refreshes.shift()
  if(refreshes.length>=6){result.warnings.push('Market refresh capacity reached. Retry shortly.');return result}refreshes.push(now)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000)
  try{
   const provider=endpoint()
   const rpc=async(method:string,params:unknown[]):Promise<unknown>=>{
    if(controller.signal.aborted)throw new Error('Provider unavailable')
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(4000)])
    const response=await upstreamFetch(provider,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal,cache:'no-store',redirect:'error'})
    const data=await boundedJson(response,signal) as {jsonrpc?:unknown;id?:unknown;result?:unknown;error?:{code?:unknown}}
    if(!data||typeof data!=='object'||Array.isArray(data)||data.jsonrpc!=='2.0'||data.id!==1)throw new Error('Provider unavailable')
    if(method==='getTransaction'&&data.error?.code===-32015&&!Object.hasOwn(data,'result'))return VERSION
    if(data.error||!Object.hasOwn(data,'result'))throw new Error('Provider unavailable')
    return data.result
   }
   const key=new PublicKey(mint),mintBank=bank(await rpc('getMultipleAccounts',[[mint,bondingCurvePda(key).toBase58()],{encoding:'base64',commitment:'confirmed'}]))
   if(mintBank.value.length!==2)throw new Error('Invalid mint bank')
   const mintInfo=account(mintBank.value[0])
   if(!mintInfo.owner.equals(TOKEN_PROGRAM_ID)&&!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))throw new Error('Unsupported mint owner')
   const state=unpackMint(key,mintInfo,mintInfo.owner)
   if(!state.isInitialized||state.decimals>18)throw new Error('Unsupported mint state')
   result.decimals=state.decimals;result.supplyRaw=state.supply.toString()
   let curve
   try{const info=account(mintBank.value[1]);if(!info.owner.equals(PUMP_PROGRAM_ID))throw new Error();curve=PUMP_SDK.decodeBondingCurve(info);if(!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT))throw new Error()}catch{result.status='unsupported';result.warnings.push('No supported SOL-quoted Pump.fun curve verified for this mint.');return result}
   result.curveStatus=curve.complete?'graduated':'active'
   let selected=signatures
   if(!selected.length){
    const history=await rpc('getSignaturesForAddress',[mint,{limit:12,commitment:'confirmed'}])
    if(!Array.isArray(history))throw new Error('Invalid signature sample')
    selected=[...new Set(history.slice(0,12).filter(row=>row&&typeof row==='object'&&canonicalSignature(row.signature)&&row.err===null&&Number.isSafeInteger(row.slot)&&row.slot>=0&&['confirmed','finalized'].includes(row.confirmationStatus)).map(row=>row.signature as string))]
   }
   result.coverage.requested=selected.length
   let cursor=0
   await Promise.all(Array.from({length:Math.min(2,selected.length)},async()=>{
    while(cursor<selected.length){
     const signature=selected[cursor++]
     try{
      const tx=await rpc('getTransaction',[signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}])
      if(tx===VERSION){result.coverage.unsupported++;continue}if(tx===null){result.coverage.missing++;continue}
      if(!validTx(tx,signature)){result.coverage.invalid++;continue}if(tx.meta.err!==null){result.coverage.failed++;continue}
      const evidence=decodeConfirmedPumpEvidence(tx,signature,mint,state.decimals,Math.floor(clock()/1000))
      if(evidence.status!=='complete'){result.coverage[evidence.status]++;continue}
      result.coverage.read++
      const events=evidence.trades
      result.trades.push(...events);result.balanceChanges.push(...decodeConfirmedBalanceChanges(tx,signature,mint,events))
     }catch{result.coverage.missing++}
    }
   }))
   result.trades=mergeTrades(result.trades);result.candles=buildCandles(result.trades)
   result.balanceChanges.sort((a,b)=>a.slot-b.slot||a.signature.localeCompare(b.signature)||a.wallet.localeCompare(b.wallet))
   if(!signatures.length){
    try{
     const largest=bank(await rpc('getTokenLargestAccounts',[mint,{commitment:'confirmed'}])),addresses=largest.value.slice(0,20).map(row=>(row as {address?:unknown})?.address)
     if(addresses.some(address=>!canonicalAddress(address))||new Set(addresses).size!==addresses.length)throw new Error('Invalid largest accounts')
     const resolved=addresses.length?bank(await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot:largest.slot}])):{slot:largest.slot,value:[]}
     if(resolved.slot<largest.slot||resolved.value.length!==addresses.length)throw new Error('Incomplete owner sample')
     const owners=new Map<string,{amount:bigint;accounts:number}>();let total=0n
     for(let i=0;i<addresses.length;i++){
      const info=account(resolved.value[i]),token=unpackAccount(new PublicKey(addresses[i] as string),info,mintInfo.owner)
      if(!token.mint.equals(key)||!token.isInitialized)throw new Error('Wrong token account')
      const owner=token.owner.toBase58(),prior=owners.get(owner)??{amount:0n,accounts:0};prior.amount+=token.amount;prior.accounts++;owners.set(owner,prior);total+=token.amount
     }
     if(total>state.supply)throw new Error('Sample exceeds supply')
     const percent=(amount:bigint)=>state.supply?Number(amount*1_000_000n/state.supply)/10_000:0
     result.distribution={status:'ready',owners:[...owners].map(([owner,value])=>({owner,amountRaw:value.amount.toString(),accounts:value.accounts,supplyPct:percent(value.amount)})).sort((a,b)=>b.supplyPct-a.supplyPct),sampledAccounts:addresses.length,sampledAmountRaw:total.toString(),sampledSupplyPct:state.supply?percent(total):null,slot:resolved.slot}
    }catch{result.warnings.push('Largest-account owner sample is unavailable; no holder count is inferred.')}
   }
   if(result.coverage.missing+result.coverage.unsupported+result.coverage.invalid+result.coverage.failed>0)result.warnings.push('Some sampled transactions are missing, unsupported, failed or unreadable. This is incomplete market and accounting coverage.')
   if(result.curveStatus==='graduated')result.warnings.push('This mint has graduated. PumpSwap market events are not included in this curve-only sample.')
   result.status='ready';return result
  }catch{result.warnings.push('Confirmed market data is temporarily unavailable. Retry shortly.');return result}
  finally{clearTimeout(timer)}
 }
 return async(mint:string,signatures:string[]=[]):Promise<TokenMarketSnapshot>=>{
  if(!canonicalAddress(mint)||!Array.isArray(signatures)||signatures.length>8||signatures.some(value=>!canonicalSignature(value))||new Set(signatures).size!==signatures.length)throw new Error('Invalid market lookup')
  const key=[mint,...[...signatures].sort()].join(':'),cached=cache.get(key)
  if(cached&&cached.expires>clock())return structuredClone(cached.value)
  if(!inflight.has(key)){
   const promise=refresh(mint,signatures).then(value=>{if(cache.size>=24)cache.delete(cache.keys().next().value!);cache.set(key,{value,expires:clock()+WINDOW});return value}).finally(()=>inflight.delete(key));inflight.set(key,promise)
  }
  return structuredClone(await inflight.get(key)!)
 }
}

export function createTokenMarketHandler(upstreamFetch:typeof fetch=fetch,clock:()=>number=Date.now){
 const market=createTokenMarketService(upstreamFetch,clock),clients=new Map<string,{count:number;expires:number}>();let global={count:0,expires:0}
 return async(request:Request):Promise<Response>=>{
  const headers={'Cache-Control':'no-store','Content-Type':'application/json'},reject=(status:number,message:string)=>Response.json({error:message},{status,headers})
  try{
   if(!isAllowedRequestOrigin(request))return reject(403,'Origin not allowed.')
   const now=clock();if(now>=global.expires)global={count:0,expires:now+60_000}
   const client=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,64)||'unknown'
   for(const [key,quota] of clients)if(quota.expires<=now)clients.delete(key)
   if(clients.size>=1000&&!clients.has(client))return reject(429,'Market data is busy. Retry shortly.')
   const prior=clients.get(client),quota=prior&&prior.expires>now?prior:{count:0,expires:now+60_000};clients.set(client,quota)
   if(++quota.count>30||++global.count>120)return reject(429,'Market request limit reached. Retry shortly.')
   const params=new URL(request.url).searchParams,mint=params.get('mint'),signatures=params.getAll('signature')
   if(request.method!=='GET'||request.url.length>1600||params.getAll('mint').length!==1||[...params.keys()].some(key=>key!=='mint'&&key!=='signature')||!canonicalAddress(mint)||signatures.length>8||signatures.some(value=>!canonicalSignature(value))||new Set(signatures).size!==signatures.length)return reject(400,'Use one Solana mint and up to eight distinct transaction signatures.')
   const value=await market(mint,signatures)
   return Response.json(value,{status:value.status==='unavailable'?503:200,headers})
  }catch{return reject(503,'Confirmed market data is temporarily unavailable.')}
 }
}
