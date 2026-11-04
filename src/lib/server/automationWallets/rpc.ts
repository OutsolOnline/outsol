import type {fetchBounded} from '../../transactions/http'

/** The wallet worker never takes an RPC URL from a request or follows redirects. */
export function createAutomationRpcFetch(endpoint:string,upstream:typeof fetch=fetch,timeoutMs=20_000):typeof fetch {
 return async(url,init)=>{
  if(String(url)!==endpoint)throw new Error('Unexpected automation RPC destination')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs)
  const signal=init?.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal
  let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined
  try{
   response=await upstream(url,{...init,redirect:'error',signal})
   if(!response.ok)throw new Error('Automation RPC unavailable')
   reader=response.body?.getReader();if(!reader)throw new Error('Empty automation RPC response')
   const chunks:Uint8Array[]=[];let size=0
   while(true){const row=await reader.read();if(row.done)break;size+=row.value.length;if(size>2_097_152)throw new Error('Automation RPC response too large');chunks.push(row.value)}
   const responseHeaders=new Headers(response.headers);responseHeaders.delete('content-encoding');responseHeaders.delete('content-length')
   return new Response(Buffer.concat(chunks),{status:response.status,headers:responseHeaders})
  }finally{
   clearTimeout(timer);controller.abort()
   if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}
   else if(response?.body)await response.body.cancel().catch(()=>{})
  }
 }
}
/** Reused native simulators receive the same bounded transport as Connection RPC calls. */
export function createAutomationSimulationFetch(endpoint:string,upstream:typeof fetch=fetch,timeoutMs=20_000):typeof fetchBounded {
 const transport=createAutomationRpcFetch(endpoint,upstream,timeoutMs)
 return async<T>(url:string,init:RequestInit,read:(response:Response)=>Promise<T>):Promise<T>=>read(await transport(url,init))
}
