import {AutomationError,CAPABILITY_PATTERN} from '../../automationWallets/model'
import {isAllowedRequestOrigin} from '../requestOrigin'
import {automationReadiness,automationRuntime,startAutomationWalletWorker} from './config'
import type {createAutomationService} from './service'

const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}
function capability(request:Request){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'');if(!match||!CAPABILITY_PATTERN.test(match[1]))throw new AutomationError(404,'Restore the private automation recovery receipt.');return match[1]}
async function body(request:Request):Promise<Record<string,unknown>>{
 if(Number(request.headers.get('content-length'))>8192)throw new AutomationError(413,'The automation request is too large.')
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new AutomationError(415,'Send the reviewed details as JSON.')
 const reader=request.body?.getReader();if(!reader)throw new AutomationError(400,'Review the automation details.')
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),cancel=()=>{void reader.cancel().catch(()=>{})},chunks:Uint8Array[]=[];let size=0
 signal.addEventListener('abort',cancel,{once:true})
 try{while(true){const row=await reader.read();if(signal.aborted)throw new Error();if(row.done)break;size+=row.value.length;if(size>8192)throw new AutomationError(413,'The automation request is too large.');chunks.push(row.value)}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value}
 catch(error){if(error instanceof AutomationError)throw error;throw new AutomationError(400,'The automation details could not be read.')}finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function createAutomationHandlers(options:{service?:()=>ReturnType<typeof createAutomationService>;readiness?:()=>unknown}={}){
 const service=options.service||(()=>automationRuntime().service),clients=new Map<string,{count:number;until:number}>(),creates=new Map<string,{count:number;until:number}>()
 let global={count:0,until:0},globalCreates={count:0,until:0},active=0
 const limited=(request:Request,create=false)=>{
  const now=Date.now(),map=create?creates:clients,windowMs=create?3_600_000:60_000,limit=create?2:90
  const client=(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown').slice(0,64)
  for(const [key,entry] of map)if(entry.until<=now)map.delete(key)
  if(map.size>=1000&&!map.has(client))throw new AutomationError(429,'Automation is busy; try again shortly.')
  const entry=map.get(client)||{count:0,until:now+windowMs};map.set(client,entry)
  let aggregate=create?globalCreates:global;if(aggregate.until<=now)aggregate={count:0,until:now+windowMs};if(create)globalCreates=aggregate;else global=aggregate
  if(++entry.count>limit||++aggregate.count>(create?10:300)||active>=8)throw new AutomationError(429,'The automation request limit was reached. Try again later.')
 }
 return {
  async GET(){if(!options.readiness&&!options.service)try{startAutomationWalletWorker()}catch{/* Report workerRunning=false; future requests retry a recovered volume. */}return Response.json((options.readiness||automationReadiness)(),{headers})},
  async POST(request:Request):Promise<Response>{
   let counted=false
   try{
    if(!request.headers.get('origin')||!isAllowedRequestOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')throw new AutomationError(403,'Open automation wallets in this application to continue.')
    if(new URL(request.url).search)throw new AutomationError(400,'Keep the private recovery capability out of URLs.')
    limited(request);active++;counted=true;const value=await body(request),action=value.action
    const allowed:Record<string,string[]>={create:['action','consent'],status:['action'],backup:['action','consent'],review:['action','plan'],arm:['action','hash','consent'],cancel:['action']}
    if(typeof action!=='string'||!allowed[action]||Object.keys(value).some(k=>!allowed[action].includes(k)))throw new AutomationError(400,'Choose a supported dedicated wallet action. Existing private keys are never accepted.')
    let result:unknown
    if(action==='create'){if(value.consent!==true)throw new AutomationError(400,'Consent to a new dedicated server-held wallet with separate funds.');limited(request,true);result=service().create()}
    else {const owner=capability(request),s=service();switch(action){case 'status':result=await s.status(owner);break;case 'backup':result=s.backup(owner,value.consent===true);break;case 'review':result=await s.review(owner,value.plan);break;case 'arm':if(typeof value.hash!=='string'||!/^\w{64}$/.test(value.hash))throw new AutomationError(400,'Review the exact plan first.');result=await s.arm(owner,value.hash,value.consent===true);break;case 'cancel':result=s.cancel(owner);break}}
    return Response.json(result,{headers})
   }catch(error){const safe=error instanceof AutomationError?error:new AutomationError(503,'Automation is unavailable. Keep your recovery receipt and keypair backup, and try again later.');return Response.json({error:safe.message},{status:safe.status,headers})}
   finally{if(counted)active--}
  },
 }
}
export const automationHandlers=createAutomationHandlers()
