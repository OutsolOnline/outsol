import {isAllowedRequestOrigin} from '@/lib/server/requestOrigin'
import {validateMarketSaleInput} from './market'
const json=(status:number,error:string)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}})
async function boundedText(body:ReadableStream<Uint8Array>|null,limit:number):Promise<string>{if(!body)throw new Error('Missing body');const reader=body.getReader(),decoder=new TextDecoder();let text='',size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Body too large');text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}finally{await reader.cancel().catch(()=>{})}}
/** The browser supplies public trade intent only, never an endpoint, token or key. */
export function createMarketBuildHandler(options:{fetch?:typeof fetch;apiKey?:string}={}){
 const fetcher=options.fetch??fetch
 let nextBuildAt=0
 return async(request:Request):Promise<Response>=>{
  if(!isAllowedRequestOrigin(request))return json(403,'Origin not allowed')
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return json(415,'Send a JSON sale configuration.')
  let input:ReturnType<typeof validateMarketSaleInput>
  try{input=validateMarketSaleInput(JSON.parse(await boundedText(request.body,3000)))}catch{return json(400,'The sale configuration is incomplete or invalid.')}
  const parameters=new URLSearchParams({inputMint:input.mint,outputMint:'So11111111111111111111111111111111111111112',amount:input.amountRaw,taker:input.payer,payer:input.payer,nativeDestinationAccount:input.payer,slippageBps:String(input.slippageBps),platformFeeBps:'0',wrapAndUnwrapSol:'true',maxAccounts:'48',transactionVersion:'0'})
  const key=options.apiKey??process.env.JUPITER_API_KEY,headers:Record<string,string>={Accept:'application/json'}
  if(key)headers['x-api-key']=key
  // Group previews are sequential but can still outrun the provider's free
  // allowance. Reserve bounded read-only build slots across this server process.
  const now=Date.now(),wait=Math.max(0,nextBuildAt-now)
  if(wait>10000)return json(429,'Other market previews are queued. Wait a moment and refresh this review.')
  nextBuildAt=Math.max(now,nextBuildAt)+(key?1100:2100)
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait))
  if(request.signal.aborted)return json(408,'The market preview was cancelled. Nothing was submitted.')
  try{
   const response=await fetcher('https://api.jup.ag/swap/v2/build?'+parameters,{method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)})
   if(response.status===429)return json(429,'Market routing is rate limited. Wait a moment and refresh this preview.')
   if(response.status===401||response.status===403)return json(503,'Market routing needs operator API setup. Native active Pump.fun sales remain available.')
   if(!response.ok)return json(response.status===400?422:502,'No supported market route is available for this token and amount. Nothing was submitted.')
   const raw=await boundedText(response.body,500000),body=JSON.parse(raw)
   if(!body||typeof body!=='object'||body.error)return json(422,'The market could not build a supported exit for this token. Nothing was submitted.')
   const fields=['inputMint','outputMint','inAmount','outAmount','otherAmountThreshold','swapMode','slippageBps','routePlan','platformFee','computeBudgetInstructions','setupInstructions','swapInstruction','cleanupInstruction','otherInstructions','tipInstruction','addressesByLookupTableAddress','transactionVersion']
   return Response.json(Object.fromEntries(fields.filter(field=>Object.prototype.hasOwnProperty.call(body,field)).map(field=>[field,body[field]])),{headers:{'Cache-Control':'no-store'}})
  }catch{return json(502,'Market routing is unavailable. Your tokens have not moved; refresh the preview to try again.')}
 }
}
