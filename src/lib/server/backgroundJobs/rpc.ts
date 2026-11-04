import {PublicKey} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint} from '@solana/spl-token'
import {canonicalSignature,decodeConfirmedPumpEvidence} from '../../market/events'
import {decodeConfirmedBalanceChanges} from '../../accounting/fills'
import type {HistoryReceipt,SignatureEntry} from './model'
import {validatePage} from './model'
import {RpcBudgetError,UnsupportedMintError,type HistoryReader} from './worker'

const MAX_BODY=1_048_576
export function validHistoryRpcUrl(value:string|undefined,production=process.env.NODE_ENV==='production'):string|null{
 try{if(!value||value.length>4096)return null;const url=new URL(value);if(url.username||url.password||url.hash||!(url.protocol==='https:'||(!production&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))return null;return url.toString()}catch{return null}
}
async function limitedJson(response:Response):Promise<unknown>{
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Error('The RPC request failed.')}
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>MAX_BODY){await response.body.cancel().catch(()=>{});throw new Error('The RPC response exceeded its limit.')}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BODY)throw new Error('The RPC response exceeded its limit.');parts.push(part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
}
export function createHistoryReader(url:string,options:{fetcher?:typeof fetch;reserveRead?:()=>boolean;now?:()=>number}={}):HistoryReader{
 const checkedUrl=validHistoryRpcUrl(url);if(!checkedUrl)throw new Error('A private server RPC is required.');const rpcUrl:string=checkedUrl
 const fetcher=options.fetcher??fetch,now=options.now??Date.now
 async function rpc(method:'getAccountInfo'|'getSignaturesForAddress'|'getTransaction',params:unknown[]):Promise<unknown>{
  if(options.reserveRead&&!options.reserveRead())throw new RpcBudgetError('The indexing read budget is temporarily exhausted.')
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000)
  try{
   const response=await fetcher(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:controller.signal,redirect:'error',cache:'no-store'})
   const body=await limitedJson(response) as {jsonrpc?:unknown;id?:unknown;error?:unknown;result?:unknown}
   if(!body||body.jsonrpc!=='2.0'||body.id!==1||body.error||!Object.prototype.hasOwnProperty.call(body,'result'))throw new Error('The RPC returned an invalid response.')
   return body.result
  }finally{clearTimeout(timeout);controller.abort()}
 }
 return{
  async mintDecimals(mint){
   const result=await rpc('getAccountInfo',[mint,{encoding:'base64',commitment:'confirmed'}]) as {value?:{owner?:unknown;data?:unknown;executable?:unknown}}
   const value=result?.value
   if(!value||typeof value.owner!=='string'||value.executable!==false||!Array.isArray(value.data)||value.data.length!==2||value.data[1]!=='base64'||typeof value.data[0]!=='string'||value.data[0].length>8192)throw new UnsupportedMintError('Unsupported mint evidence.')
   try{
    const owner=new PublicKey(value.owner),data=Buffer.from(value.data[0],'base64')
    if(data.toString('base64')!==value.data[0]||(!owner.equals(TOKEN_PROGRAM_ID)&&!owner.equals(TOKEN_2022_PROGRAM_ID))||new PublicKey(mint).equals(NATIVE_MINT))throw new Error('Unsupported mint program.')
    const account=unpackMint(new PublicKey(mint),{data,owner,lamports:0,executable:false,rentEpoch:0},owner)
    if(!account.isInitialized||account.decimals>18)throw new Error('Unsupported mint fields.')
    return account.decimals
   }catch{throw new UnsupportedMintError('Unsupported mint evidence.')}
  },
  async signatures(mint,before,limit){
   const result=await rpc('getSignaturesForAddress',[mint,{limit,...(before?{before}:{}),commitment:'confirmed'}])
   if(!Array.isArray(result)||result.length>limit)throw new Error('The RPC returned an invalid history page.')
   const rows=result.map(row=>{if(!row||!Object.prototype.hasOwnProperty.call(row,'err'))throw new Error('Missing transaction status.');return{signature:row.signature as string,slot:row.slot as number,blockTime:row.blockTime as number|null,failed:row.err!==null}})
   validatePage(rows,limit);return rows
  },
  async receipt(mint,decimals,entry){
   if(!canonicalSignature(entry.signature))throw new Error('Invalid history signature.')
   const result=await rpc('getTransaction',[entry.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}])
   const base:HistoryReceipt={signature:entry.signature,slot:entry.slot,blockTime:entry.blockTime,status:'missing',trades:[],balanceChanges:[]}
   if(result===null)return base
   const tx=result as {slot?:unknown;blockTime?:unknown;meta?:{err?:unknown};transaction?:{signatures?:unknown[]}}
   if(!tx||typeof tx!=='object'||tx.slot!==entry.slot||tx.blockTime!==entry.blockTime||tx.transaction?.signatures?.[0]!==entry.signature||!tx.meta||!Object.prototype.hasOwnProperty.call(tx.meta,'err')||(tx.meta.err!==null)!==entry.failed)return{...base,status:'invalid'}
   if(tx.meta.err!==null)return{...base,status:'failed'}
   const evidence=decodeConfirmedPumpEvidence(result,entry.signature,mint,decimals,Math.floor(now()/1000))
   if(evidence.status!=='complete')return{...base,status:evidence.status}
   const balanceChanges=decodeConfirmedBalanceChanges(result,entry.signature,mint,evidence.trades)
   if(evidence.trades.length>16||balanceChanges.length>32)return{...base,status:'unsupported'}
   return{...base,status:'confirmed',trades:evidence.trades,balanceChanges}
  },
 }
}
