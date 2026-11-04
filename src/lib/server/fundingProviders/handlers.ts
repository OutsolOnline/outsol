import {CAPABILITY_PATTERN,FundingError,parseFundingPlan} from '../../fundingProviders/model'
import {isAllowedRequestOrigin} from '../requestOrigin'
import {fundingAvailability,fundingService} from './config'
import type {createSplitNowService} from './splitnow'

const headers={'Cache-Control':'private, no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}
const deny=()=>new FundingError('invalid_request',403,'This funding request must come from this application.')
function capability(request:Request){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'');if(!match||!CAPABILITY_PATTERN.test(match[1]))throw new FundingError('not_found',404,'Import or select the private funding recovery receipt.');return match[1]}
async function body(request:Request):Promise<unknown>{
 if(Number(request.headers.get('content-length'))>16_384)throw new FundingError('invalid_request',413,'Funding request is too large.')
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new FundingError('invalid_request',415,'Send funding details as JSON.')
 if(!request.body)throw new FundingError('invalid_request',400,'Review the funding details.')
 const reader=request.body.getReader(),parts:Uint8Array[]=[];let length=0
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5_000)]),cancel=()=>{void reader.cancel().catch(()=>{})}
 signal.addEventListener('abort',cancel,{once:true})
 try{
  while(true){const row=await reader.read();if(signal.aborted)throw new Error();if(row.done)break;length+=row.value.length;if(length>16_384){cancel();throw new FundingError('invalid_request',413,'Funding request is too large.')}parts.push(row.value)}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 }catch(error){if(error instanceof FundingError)throw error;throw new FundingError('invalid_request',400,'Funding details could not be read.')}finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
export function createFundingHandlers(options:{service?:()=>ReturnType<typeof createSplitNowService>;availability?:()=>unknown}={}){
 const service=options.service||fundingService
 const handle=(fn:(request:Request)=>Promise<unknown>)=>async(request:Request)=>{
  try{if(!isAllowedRequestOrigin(request))throw deny();return Response.json(await fn(request),{headers})}
  catch(error){const safe=error instanceof FundingError?error:new FundingError('provider_unavailable',502,'Funding details are unavailable. Keep any recovery receipt and try again later.');return Response.json({error:safe.message,code:safe.code},{status:safe.status,headers})}
 }
 return {
  availability:handle(async()=> (options.availability||fundingAvailability)()),
  quote:handle(async request=>{const plan=parseFundingPlan(await body(request));return service().quote(plan)}),
  order:handle(async request=>{const owner=capability(request),review=await body(request);return service().createOrder(owner,review)}),
  status:handle(async request=>{const owner=capability(request);return service().status(owner)}),
 }
}
