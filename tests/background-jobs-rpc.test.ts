import {describe,expect,it,vi} from 'vitest'
import {Keypair,PublicKey} from '@solana/web3.js'
import {MintLayout,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import bs58 from 'bs58'
import {createHistoryReader,validHistoryRpcUrl} from '../src/lib/server/backgroundJobs/rpc'
import {RpcBudgetError} from '../src/lib/server/backgroundJobs/worker'
import {createServer} from 'node:http'

const mint=Keypair.generate().publicKey.toBase58(),signature=bs58.encode(new Uint8Array(64).fill(1)),entry={signature,slot:100,blockTime:1793790000,failed:false}
const envelope=(result:unknown)=>Response.json({jsonrpc:'2.0',id:1,result})
function mintValue(){const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return{value:{owner:TOKEN_PROGRAM_ID.toBase58(),executable:false,data:[data.toString('base64'),'base64']}}}
describe('fixed read-only indexing RPC',()=>{
 it.each([503,200])('closes a rejected streaming HTTP %i response instead of leaving its socket alive',async status=>{
  let closeStream!:()=>void,stream:ReturnType<typeof setInterval>|undefined,timer:ReturnType<typeof setTimeout>|undefined
  const closed=new Promise<void>(resolve=>{closeStream=resolve})
  const server=createServer((_request,response)=>{
   response.writeHead(status,{'content-type':'application/json',...(status===200?{'content-length':'2000000'}:{})});response.flushHeaders()
   response.on('close',()=>{if(stream)clearInterval(stream);closeStream()});stream=setInterval(()=>response.write(' '),25)
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
   const address=server.address();if(!address||typeof address==='string')throw new Error('Local test server did not bind')
   const reader=createHistoryReader(`http://127.0.0.1:${address.port}`)
   await expect(reader.signatures(mint,null,25)).rejects.toThrow(status===503?'RPC request failed':'exceeded its limit')
   await Promise.race([closed,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Rejected RPC body is still connected')),1000)})])
  }finally{if(timer)clearTimeout(timer);if(stream)clearInterval(stream);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
 })
 it('validates a mint then paginates only confirmed signatures with a bounded original cursor',async()=>{
  const calls:{method:string;params:unknown[]}[]=[],fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const call=JSON.parse(init!.body as string);calls.push(call);return envelope(call.method==='getAccountInfo'?mintValue():[{...entry,err:null}])}) as unknown as typeof fetch
  const reader=createHistoryReader('https://rpc.example.test/?api-key=server-only',{fetcher});expect(await reader.mintDecimals(mint)).toBe(6);expect(await reader.signatures(mint,signature,25)).toEqual([entry]);expect(calls.map(row=>row.method)).toEqual(['getAccountInfo','getSignaturesForAddress']);expect(calls[1].params).toEqual([mint,{limit:25,before:signature,commitment:'confirmed'}])
 })
 it('distinguishes unavailable receipts, failed execution and unsupported evidence',async()=>{
  let result:unknown=null;const fetcher=vi.fn(async()=>envelope(result)) as unknown as typeof fetch,reader=createHistoryReader('https://rpc.example.test',{fetcher})
  expect((await reader.receipt(mint,6,entry)).status).toBe('missing');result={slot:100,blockTime:entry.blockTime,transaction:{signatures:[signature]},meta:{err:{InstructionError:[0,'bad']}}};expect((await reader.receipt(mint,6,{...entry,failed:true})).status).toBe('failed')
  result={slot:101,blockTime:entry.blockTime,transaction:{signatures:[signature]},meta:{err:null}};expect((await reader.receipt(mint,6,entry)).status).toBe('invalid')
  result={slot:100,blockTime:entry.blockTime,transaction:{signatures:[signature]},meta:{err:null,logMessages:[]}};expect((await reader.receipt(mint,6,entry)).status).toBe('confirmed')
 })
 it('rejects oversized, malformed and repeated signature pages',async()=>{
  let rows:unknown=[{...entry,err:null},{...entry,err:null}];const reader=createHistoryReader('https://rpc.example.test',{fetcher:vi.fn(async()=>envelope(rows)) as unknown as typeof fetch});await expect(reader.signatures(mint,null,25)).rejects.toThrow()
  rows=Array.from({length:26},()=>({...entry,err:null}));await expect(reader.signatures(mint,null,25)).rejects.toThrow()
 })
 it('enforces a persistent read budget before contacting the RPC and never submits transactions',async()=>{
  const fetcher=vi.fn();const reader=createHistoryReader('https://rpc.example.test',{fetcher:fetcher as unknown as typeof fetch,reserveRead:()=>false});await expect(reader.signatures(mint,null,25)).rejects.toBeInstanceOf(RpcBudgetError);expect(fetcher).not.toHaveBeenCalled()
  expect(validHistoryRpcUrl('http://rpc.example.test')).toBeNull();expect(validHistoryRpcUrl('https://user:secret@rpc.example.test')).toBeNull();expect(validHistoryRpcUrl('http://127.0.0.1:8899',true)).toBeNull()
 })
})
