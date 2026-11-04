import {isAllowedRequestOrigin} from '../requestOrigin'
import {backgroundJobReadiness,type BackgroundJobReadiness} from './config'
import {getBackgroundJobStore,startBackgroundJobWorker} from './service'
import type {BackgroundJobStore} from './store'
import {BackgroundJobRateLimitError,parseJobInput,validCapability} from './model'

export const JOB_ACCESS_HEADER='x-launchpier-job-key'
const response=(value:unknown,status=200,retryAfter?:number)=>Response.json(value,{status,headers:{'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}})
const idValid=(value:string)=>/^[a-f0-9]{40}$/.test(value)
async function requestBody(request:Request):Promise<unknown>{
 if(!request.headers.get('content-type')?.startsWith('application/json')||Number(request.headers.get('content-length'))>2048||!request.body)throw Error('Invalid request body.')
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;const timeout=setTimeout(()=>{void reader.cancel()},5000)
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2048)throw Error('Request body is too large.');chunks.push(chunk.value)}return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown}finally{clearTimeout(timeout);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
type Dependencies={store:()=>BackgroundJobStore|null;start:()=>void;readiness:()=>BackgroundJobReadiness}
export function createBackgroundJobHandlers(dependencies:Partial<Dependencies>={}){
 const deps:Dependencies={store:getBackgroundJobStore,start:startBackgroundJobWorker,readiness:backgroundJobReadiness,...dependencies}
 const check=(request:Request)=>isAllowedRequestOrigin(request)?null:response({error:'This request origin is not allowed.'},403)
 const unavailable=()=>response({error:'Background indexing is unavailable. Private persistent storage and a server RPC are required.'},503)
 return{
  status(request:Request){const denied=check(request);if(denied)return denied;try{const readiness=deps.readiness();if(readiness.available&&!deps.store())return response({...readiness,available:false,reason:'Private persistent storage is unavailable. Background indexing is paused.'});return response(readiness)}catch{return response({...deps.readiness(),available:false,reason:'Private persistent storage is unavailable. Background indexing is paused.'})}},
  async create(request:Request){
   const denied=check(request);if(denied)return denied
   const key=request.headers.get(JOB_ACCESS_HEADER);if(!validCapability(key))return response({error:'A valid job access key is required.'},400)
   let input;try{input=parseJobInput(await requestBody(request))}catch{return response({error:'Provide a token mint, a transaction limit from 25 to 500 and a unique request identifier.'},400)}
   try{const store=deps.store();if(!store)return unavailable();const client=(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown').slice(0,64),job=store.create(input,key,client);deps.start();return response({job},202)}catch(error){if(error instanceof BackgroundJobRateLimitError)return response({error:error.message},429,error.retryAfter);return response({error:'This request could not be queued. The queue may be full, or its request identifier was already used with different settings.'},409)}
  },
  get(request:Request,id:string){
   const denied=check(request);if(denied)return denied
   const key=request.headers.get(JOB_ACCESS_HEADER);if(!idValid(id)||!validCapability(key))return response({error:'History index not found.'},404)
   const url=new URL(request.url),offset=Number(url.searchParams.get('offset')??'0'),limit=Number(url.searchParams.get('limit')??'25')
   if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>25)return response({error:'Invalid result page.'},400)
   try{const store=deps.store();if(!store)return unavailable();const job=store.read(id,key);if(!job)return response({error:'History index not found.'},404);return response({job,receipts:store.receipts(id,key,offset,limit),offset,limit})}catch{return unavailable()}
  },
  remove(request:Request,id:string){
   const denied=check(request);if(denied)return denied
   const key=request.headers.get(JOB_ACCESS_HEADER);if(!idValid(id)||!validCapability(key))return response({error:'History index not found.'},404)
   try{const store=deps.store();if(!store)return unavailable();const job=store.cancel(id,key);return job?response({job}):response({error:'History index not found.'},404)}catch{return unavailable()}
  },
 }
}
export const backgroundJobHandlers=createBackgroundJobHandlers()
