import {afterEach,describe,expect,it} from 'vitest'
import {createServer,type Server} from 'node:http'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import {simulateTradePreview,type PreparedTrade} from '../src/lib/venues/trade'
import {simulateSignedTrade} from '../src/lib/tradingSessions/chain'
import {createAutomationSimulationFetch} from '../src/lib/server/automationWallets/rpc'
const servers:Server[]=[]
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()))}})
function prepared():PreparedTrade{
 const key=Keypair.generate(),payer=key.publicKey,mint=Keypair.generate().publicKey,curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),mint.toBuffer()],PUMP_PROGRAM_ID)[0]
 const pda=(seed:string)=>PublicKey.findProgramAddressSync([Buffer.from(seed)],PUMP_PROGRAM_ID)[0]
 const addresses=[pda('global'),Keypair.generate().publicKey,mint,curve,getAssociatedTokenAddressSync(mint,curve,true),getAssociatedTokenAddressSync(mint,payer),payer,SystemProgram.programId,TOKEN_PROGRAM_ID,Keypair.generate().publicKey,pda('__event_authority'),PUMP_PROGRAM_ID]
 const data=Buffer.alloc(24);Buffer.from([102,6,61,18,1,218,235,234]).copy(data);data.writeBigUInt64LE(100n,8);data.writeBigUInt64LE(10_000_000n,16)
 const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[new TransactionInstruction({programId:PUMP_PROGRAM_ID,data,keys:addresses.map((pubkey,i)=>({pubkey,isSigner:i===6,isWritable:[1,3,4,5,6,9].includes(i)}))})]}).compileToV0Message());transaction.sign([key])
 return {transaction,input:{action:'buy',mint:mint.toBase58(),payer:payer.toBase58(),buySol:'0.01',sellPercent:100,slippage:5,priorityFeeSol:0.0001},position:{mint:mint.toBase58(),payer:payer.toBase58(),decimals:9,tokenRaw:'0',solLamports:'1000000000',tokenProgram:TOKEN_PROGRAM_ID.toBase58(),ata:getAssociatedTokenAddressSync(mint,payer).toBase58(),status:'active'},maxBuyLamports:'10000000',maxSellRaw:'0',tokenAmountRaw:'100',minimumSolOut:'0',tokenChangeRaw:'100',solChangeLamports:'-10005000',networkFeeLamports:'5000',createdAt:1,message:Buffer.from(transaction.message.serialize()).toString('base64')}
}
describe('both native simulation paths use the hosted RPC boundary',()=>{
 for(const signed of [false,true])for(const mode of ['rejected','oversized','redirect'] as const){it(`${signed?'signed original':'unsigned preview'} closes/refuses ${mode} responses`,async()=>{
  let closed=false,redirected=false,requestBody=''
  const server=createServer((request,response)=>{if(request.url==='/destination'){redirected=true;response.end('{}');return}request.on('data',chunk=>{requestBody+=chunk});response.on('close',()=>{closed=true});if(mode==='redirect'){response.writeHead(302,{Location:'/destination'});response.end();return}response.writeHead(mode==='rejected'?503:200,{'Content-Type':'application/json'});response.write(mode==='oversized'?Buffer.alloc(2_097_153,32):'{');if(mode==='oversized')response.end()})
  servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();const endpoint=`http://127.0.0.1:${address.port}/`,p=prepared(),simulationFetch=createAutomationSimulationFetch(endpoint,fetch,1000)
  const connection={rpcEndpoint:endpoint,getFeeForMessage:async()=>({value:5000})} as unknown as Connection
  const operation=signed?simulateSignedTrade(connection,p.transaction,p,()=>{},simulationFetch):simulateTradePreview(connection,p.transaction,p.position,{action:'buy',maxBuyLamports:10_000_000n,maxSellRaw:0n,minimumSolOut:0n},simulationFetch)
  await expect(operation).rejects.toThrow();await new Promise(resolve=>setTimeout(resolve,30));expect(closed).toBe(true);expect(redirected).toBe(false)
  const config=JSON.parse(requestBody).params[1];expect(config.skipSigVerify).toBe(!signed);expect(config.replaceRecentBlockhash).toBe(!signed)
 })}
})
