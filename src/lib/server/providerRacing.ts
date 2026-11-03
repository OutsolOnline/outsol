import {createPublicKey,verify} from 'node:crypto'
import {VersionedTransaction} from '@solana/web3.js'
import bs58 from 'bs58'

const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const FAILURE='Submission could not be verified. Preserve the original signature and check confirmation before another spending operation.'
export function readSubmissionProviders():string[]{
 try{
  const primary=process.env.RPC_URL
  if(!process.env.RPC_RACE_URLS)return primary?[primary]:[]
  const extra:unknown=JSON.parse(process.env.RPC_RACE_URLS)
  if(!primary||!Array.isArray(extra)||!extra.length||extra.length>2||extra.some(value=>typeof value!=='string'))throw new Error()
  const endpoints=[...new Set([primary,...extra])]
  for(const endpoint of endpoints){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash||endpoint.length>2000)throw new Error()}
  return endpoints
 }catch{throw new Error('Redundant submission provider configuration is unavailable.')}
}
interface RpcCall {jsonrpc:string;id:unknown;method:string;params:unknown[]}
function inspect(value:unknown):{call:RpcCall;signature:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(FAILURE)
 const call=value as RpcCall
 if(call.jsonrpc!=='2.0'||call.method!=='sendTransaction'||!Array.isArray(call.params)||call.params.length!==2||typeof call.params[0]!=='string'||call.params[0].length>1648||!(call.id===null||typeof call.id==='number'&&Number.isSafeInteger(call.id)||typeof call.id==='string'&&call.id.length<=128))throw new Error(FAILURE)
 const config=call.params[1] as Record<string,unknown>
 if(!config||typeof config!=='object'||Array.isArray(config)||config.encoding!=='base64'||config.skipPreflight===true||Object.keys(config).some(key=>!['encoding','skipPreflight','preflightCommitment','maxRetries','minContextSlot'].includes(key)))throw new Error(FAILURE)
 const bytes=Buffer.from(call.params[0],'base64'),transaction=VersionedTransaction.deserialize(bytes),required=transaction.message.header.numRequiredSignatures
 if(bytes.length>1232||bytes.toString('base64')!==call.params[0]||!Buffer.from(transaction.serialize()).equals(bytes)||required<1||required!==transaction.signatures.length)throw new Error(FAILURE)
 for(let index=0;index<required;index++){
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),transaction.message.staticAccountKeys[index].toBuffer()]),format:'der',type:'spki'})
  if(!verify(null,transaction.message.serialize(),key,transaction.signatures[index]))throw new Error(FAILURE)
 }
 return {call,signature:bs58.encode(transaction.signatures[0])}
}
async function boundedJson(response:Response):Promise<Record<string,unknown>>{
 if(!response.ok||!response.body)throw new Error(FAILURE)
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new Error(FAILURE);chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!result||typeof result!=='object'||Array.isArray(result)||result.error||result.jsonrpc!=='2.0')throw new Error(FAILURE);return result
}
/** Same signed packet, same signature, multiple verified mainnet transports.
 * This never constructs a transaction, adds a tip, changes fees or retries with a new hash. */
export function createTransactionRacer(transport:typeof fetch=fetch,clock:()=>number=Date.now){
 const verified=new Map<string,number>()
 return async(value:unknown,endpoints:string[]):Promise<{jsonrpc:'2.0';id:unknown;result:string}>=>{
  const {call,signature}=inspect(value)
  if(!Array.isArray(endpoints)||!endpoints.length||endpoints.length>3||new Set(endpoints).size!==endpoints.length)throw new Error(FAILURE)
  for(const endpoint of endpoints){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error(FAILURE)}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000),body=JSON.stringify(call)
  const rpc=async(endpoint:string,payload:string)=>boundedJson(await transport(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:payload,cache:'no-store',redirect:'error',signal:controller.signal}))
  try{
   const tasks=endpoints.map(async endpoint=>{
    if((verified.get(endpoint)??0)<=clock()){
     const proof=await rpc(endpoint,JSON.stringify({jsonrpc:'2.0',id:'outsol-network-proof',method:'getGenesisHash',params:[]}))
     if(proof.id!=='outsol-network-proof'||proof.result!==GENESIS)throw new Error(FAILURE)
     if(verified.size>=16)verified.clear();verified.set(endpoint,clock()+60000)
    }
    const response=await rpc(endpoint,body)
    if(response.id!==call.id||response.result!==signature)throw new Error(FAILURE)
    return {jsonrpc:'2.0' as const,id:call.id,result:signature}
   })
   return await Promise.any(tasks)
  }catch{throw new Error(FAILURE)}finally{clearTimeout(timer);controller.abort()}
 }
}
