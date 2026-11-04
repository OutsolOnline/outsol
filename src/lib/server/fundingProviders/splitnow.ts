import {randomBytes} from 'node:crypto'
import {publicAddress,parseExactUnits,formatUnits} from '../../walletOperations/model'
import {CAPABILITY_PATTERN,FUNDING_POLICY_VERSION,FundingError,PROVIDER_ID_PATTERN,QUOTE_REVIEW_MS,parseFundingPlan,parseOrderReview,type FundingPlan,type FundingQuote,type FundingReceipt,type FundingRoute,type FundingState} from '../../fundingProviders/model'
import type {FundingPersistence,OrderRecord,QuoteRecord} from './storage'

const API='https://splitnow.io/api',MAX_RESPONSE=262_144,QUOTE_STORAGE_MS=10*60_000,RECEIPT_MS=90*24*60*60_000
const unavailable=()=>new FundingError('provider_unavailable',502,'SplitNOW could not return verified funding details. Try again later; no wallet transaction has been sent.')
const notFound=()=>new FundingError('not_found',404,'This private funding receipt was not found. Import its recovery file or check the selected receipt.')
const states=new Set<FundingState>(['pending','sending','monitoring','expired','halted','failed','refunded','completed'])
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();return value as Record<string,unknown>}
function identifier(value:unknown):string{if(typeof value!=='string'||!PROVIDER_ID_PATTERN.test(value))throw unavailable();return value}
function amount(value:unknown,allowZero=false):string{
 if(typeof value!=='number'&&typeof value!=='string')throw unavailable()
 const numeric=Number(value)
 if(!Number.isFinite(numeric)||numeric<0||(!allowZero&&numeric===0)||numeric>2_000)throw unavailable()
 // Provider estimates may include fractional lamports; they are never used to sign.
 if(typeof value==='string'&&!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value))throw unavailable()
 return numeric.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:9})
}
function sameAmount(value:unknown,expected:string){
 try{
  // Do not round an upstream commitment into the reviewed amount. Fractional
  // lamports are tolerable for estimates only, never for the actual deposit.
  if(typeof value==='string')return parseExactUnits(value,9).toString()===expected
  return typeof value==='number'&&Number.isFinite(value)&&value===Number(formatUnits(expected,9))
 }catch{return false}
}
function solInput(value:unknown,plan:FundingPlan){const row=object(value);if(row.fromAssetId!=='sol'||row.fromNetworkId!=='solana'||!sameAmount(row.fromAmount,plan.amountLamports))throw unavailable()}
async function boundedJson(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.ok||!response.body||Number(response.headers.get('content-length'))>MAX_RESPONSE){void response.body?.cancel().catch(()=>{});throw unavailable()}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true})
 try{
  if(signal.aborted)throw unavailable()
  while(true){const {value,done}=await reader.read();if(signal.aborted)throw unavailable();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE){cancel();throw unavailable()}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
function pause(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms))}
async function persistent<T>(operation:()=>Promise<T>):Promise<T>{try{return await operation()}catch{throw new FundingError('storage_unavailable',503,'Private funding receipts are unavailable. No new funding order can be created until storage is restored.')}}
function message(state:FundingState){
 const messages:Record<FundingState,string>={creating:'Order creation was started. Refresh this receipt; do not create a replacement order.',uncertain:'The provider may have accepted this order, but its response could not be saved or verified. Do not send funds or create a duplicate. Keep this receipt and contact SplitNOW support.',verification_required:'Provider details do not match the reviewed order or could not be verified. Do not deposit. Keep this receipt and contact SplitNOW support.',pending:'Provider reports that this order is awaiting a deposit. Verify the amount, Solana network and destinations before funding manually.',sending:'Provider reports that funds are being sent to its exchange routes.',monitoring:'Provider reports that the exchange routes are being monitored.',expired:'Provider reports this order has expired. Do not send a deposit.',halted:'Provider reports a halted order. Keep this receipt and contact SplitNOW support.',failed:'Provider reports a failed order. Keep this receipt and contact SplitNOW support.',refunded:'Provider reports this order was refunded. Check the actual refund transaction with SplitNOW.',completed:'Provider reports this order is complete. Confirm the received SOL in your wallets.'}
 return messages[state]
}
function baseReceipt(value:OrderRecord,now:number,state:FundingState):FundingReceipt{return {plan:value.plan,state,createdAt:new Date(value.createdAt).toISOString(),updatedAt:new Date(now).toISOString(),exchangeId:value.exchangeId,...(value.orderId?{orderId:value.orderId}:{}),message:message(state),platformFeeBps:0}}

/** Implements only the published SplitNOW SDK REST contract. No private endpoint,
 * automatic deposit, wallet key, mixer claim or guaranteed CEX source is involved. */
export function createSplitNowService(options:{store:FundingPersistence;apiKey:string;upstreamFetch?:typeof fetch;now?:()=>number;wait?:(ms:number)=>Promise<void>}){
 const store=options.store,upstream=options.upstreamFetch||fetch,now=options.now||Date.now,wait=options.wait||pause
 const quoteStarts:number[]=[],requests:number[]=[]
 function capacity(list:number[],limit:number){const current=now();while(list.length&&list[0]<=current-60_000)list.shift();if(list.length>=limit)throw new FundingError('rate_limit',429,'Provider funding is busy. Wait a minute before refreshing or preparing another quote.');list.push(current)}
 async function api(path:string,body?:unknown):Promise<unknown>{
  capacity(requests,40)
  if(!options.apiKey||options.apiKey.length>1_000||/[\s\x00-\x1f\x7f]/.test(options.apiKey))throw new FundingError('setup_required',503,'SplitNOW funding setup is required.')
  const signal=AbortSignal.timeout(6_000)
  try{
   const response=await upstream(`${API}${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-api-key':options.apiKey},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',redirect:'error',signal})
   const value=object(await boundedJson(response,signal))
   if(path.startsWith('/quotes')||path.startsWith('/orders')){if(value.success!==true||!Object.hasOwn(value,'data'))throw unavailable();return value.data}
   return value
  }catch(error){if(error instanceof FundingError)throw error;throw unavailable()}
 }
 async function quote(input:FundingPlan):Promise<FundingQuote>{
  const plan=parseFundingPlan({amountSol:input.amountSol,recipients:input.recipients});capacity(quoteStarts,6)
  const limits=object(await api('/assets/limits/'))
  if(!Array.isArray(limits.limits)||limits.limits.length>500)throw unavailable()
  const entry=limits.limits.find(value=>object(value).assetId==='sol');if(!entry)throw unavailable()
  const limit=object(entry),minimum=amount(limit.minDeposit),minRaw=parseExactUnits(minimum,9)
  const maximum=limit.maxDeposit===null?null:parseExactUnits(amount(limit.maxDeposit),9)
  const total=BigInt(plan.amountLamports)
  for(const recipient of plan.recipients){const share=total*BigInt(recipient.shareBps)/10_000n;if(share<minRaw||maximum!==null&&share>maximum)throw new FundingError('deposit_limit',400,`Each recipient allocation must meet SplitNOW's current deposit limits (minimum ${minimum} SOL).`)}
  const quoteId=identifier(await api('/quotes/',{type:'floating_rate',quoteInput:{fromAmount:Number(plan.amountSol),fromAssetId:'sol',fromNetworkId:'solana'},quoteOutputs:[{toPctBips:10000,toAssetId:'sol',toNetworkId:'solana'}]}))
  await wait(1_000)
  const result=object(await api(`/quotes/${quoteId}`));if(result._id!==quoteId||result.type!=='floating_rate')throw unavailable();solInput(result.quoteInput,plan)
  if(!Array.isArray(result.quoteLegs)||!result.quoteLegs.length||result.quoteLegs.length>100)throw unavailable()
  const routes:FundingRoute[]=[],ids=new Set<string>()
  for(const value of result.quoteLegs){
   const leg=object(value);if(leg.quoteId!==quoteId)throw unavailable();solInput(leg.quoteLegInput,plan)
   const output=object(leg.quoteLegOutput)
   if(output.toAssetId!=='sol'||output.toNetworkId!=='solana'||output.toPctBips!==10000)throw unavailable()
   const exchangeId=identifier(output.toExchangerId),estimatedOutputSol=amount(output.toAmount,true)
   if(estimatedOutputSol==='0')continue
   if(ids.has(exchangeId))throw unavailable();ids.add(exchangeId);routes.push({exchangeId,estimatedOutputSol})
  }
  if(!routes.length)throw unavailable();routes.sort((a,b)=>Number(b.estimatedOutputSol)-Number(a.estimatedOutputSol))
  const capability=randomBytes(32).toString('base64url'),quotedAt=now(),reviewExpiresAt=quotedAt+QUOTE_REVIEW_MS
  const value:QuoteRecord={kind:'quote',plan,quoteId,routes,quotedAt,reviewExpiresAt,minPerWalletSol:minimum,expiresAt:quotedAt+QUOTE_STORAGE_MS}
  await persistent(()=>store.putQuote(capability,value))
  return {capability,plan,routes,quotedAt:new Date(quotedAt).toISOString(),expiresAt:new Date(reviewExpiresAt).toISOString(),minPerWalletSol:minimum,platformFeeBps:0,providerMaxServiceFeeBps:100,itemizedFeesAvailable:false}
 }
 async function verifiedStatus(value:OrderRecord):Promise<FundingReceipt>{
  if(!value.orderId)return baseReceipt(value,now(),'uncertain')
  try{
   const result=object(await api(`/orders/${identifier(value.orderId)}`))
   if(result.shortId!==value.orderId||result.type!=='floating_rate')throw unavailable();solInput(result.orderInput,value.plan)
   if(!Array.isArray(result.orderOutputs)||result.orderOutputs.length!==value.plan.recipients.length)throw unavailable()
   const expected=new Map(value.plan.recipients.map(row=>[row.address,row.shareBps])),observed=new Set<string>()
   for(const output of result.orderOutputs){
    const row=object(output),address=publicAddress(row.toAddress,true)
    if(row.toAssetId!=='sol'||row.toNetworkId!=='solana'||observed.has(address)||expected.get(address)!==row.toPctBips)throw unavailable()
    identifier(row.toExchangerId);observed.add(address)
   }
   if(!states.has(result.statusShort as FundingState))throw unavailable()
   let state=result.statusShort as FundingState
   const receipt=baseReceipt(value,now(),state)
   if(typeof result.depositAmount!=='undefined'&&!sameAmount(result.depositAmount,value.plan.amountLamports))throw unavailable()
   let expiresAt:string|undefined
   if(result.expiredAt!==undefined){if(typeof result.expiredAt!=='string'||result.expiredAt.length>40||!Number.isFinite(Date.parse(result.expiredAt)))throw unavailable();expiresAt=new Date(result.expiredAt).toISOString();if(Date.parse(expiresAt)<=now()&&state==='pending')state='expired'}
   receipt.state=state;receipt.message=message(state)
   if(state==='pending'&&result.depositWalletAddress){receipt.deposit={address:publicAddress(result.depositWalletAddress),amountSol:value.plan.amountSol,...(expiresAt?{expiresAt}:{})}}
   else if(state==='pending')receipt.message='SplitNOW is still preparing deposit details. Refresh this receipt; do not send funds until a verified address is available.'
   return receipt
  }catch{return baseReceipt(value,now(),'verification_required')}
 }
 async function status(capability:string):Promise<FundingReceipt>{
  if(!CAPABILITY_PATTERN.test(capability))throw notFound()
  const value=await persistent(()=>store.getOrder(capability));if(!value||value.kind!=='order')throw notFound()
  return verifiedStatus(value)
 }
 async function createOrder(capability:string,review:unknown):Promise<FundingReceipt>{
  if(!CAPABILITY_PATTERN.test(capability))throw notFound()
  const confirmation=parseOrderReview(review)
  return store.lock(capability,async()=>{
   const existing=await persistent(()=>store.getOrder(capability));if(existing)return verifiedStatus(existing)
   const proposed=await persistent(()=>store.getQuote(capability));if(!proposed||proposed.kind!=='quote')throw notFound()
   if(proposed.reviewExpiresAt<=now())throw new FundingError('quote_expired',409,'This floating quote is no longer current. Request a fresh quote and review it again.')
   if(!proposed.routes.some(row=>row.exchangeId===confirmation.exchangeId))throw new FundingError('invalid_request',400,'Choose one of the routes returned in this quote.')
   // Atomic filesystem claim prevents two processes from creating orders from one quote.
   const claimed=await persistent(()=>store.takeQuote(capability));if(!claimed)throw new FundingError('invalid_request',409,'This quote is already being used. Recover its funding receipt instead of creating another order.')
   const value:OrderRecord={kind:'order',stage:'creating',plan:claimed.plan,quoteId:claimed.quoteId,exchangeId:confirmation.exchangeId,createdAt:now(),consentedAt:now(),policyVersion:FUNDING_POLICY_VERSION,expiresAt:now()+RECEIPT_MS}
   // Persist uncertainty BEFORE contacting the provider; no POST retry is safe without
   // a documented upstream idempotency key. A crash never turns this quote reusable.
   await persistent(()=>store.putOrder(capability,value))
   try{
    const created=object(await api('/orders/',{type:'floating_rate',quoteId:value.quoteId,orderInput:{fromAmount:Number(value.plan.amountSol),fromAssetId:'sol',fromNetworkId:'solana'},orderOutputs:value.plan.recipients.map(row=>({toAddress:row.address,toPctBips:row.shareBps,toAssetId:'sol',toNetworkId:'solana',toExchangerId:value.exchangeId}))}))
    value.orderId=identifier(created.shortId);value.stage='submitted'
    await persistent(()=>store.putOrder(capability,value));await wait(1_000)
   }catch{
    value.stage='uncertain';try{await store.putOrder(capability,value)}catch{}
    return baseReceipt(value,now(),'uncertain')
   }
   return verifiedStatus(value)
  })
 }
 return {quote,createOrder,status}
}
