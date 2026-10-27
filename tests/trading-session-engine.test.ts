import {describe,expect,it,vi,afterEach} from 'vitest'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import {TradingSession} from '../src/lib/tradingSessions/engine'
import {simulateSignedTrade,readSolCurveQuote} from '../src/lib/tradingSessions/chain'
import {readTradePending,readTradeHistory,saveTradePending,type TradeStorage} from '../src/lib/venues/tradeHistory'
import type {PreparedTrade,TradeInput} from '../src/lib/venues/trade'
import type {LaunchFeed,SessionPorts,TradingSessionConfig,TradingSessionJournal} from '../src/lib/tradingSessions/types'

afterEach(()=>vi.unstubAllGlobals())
const key=Keypair.generate(),payer=key.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),creator=Keypair.generate().publicKey.toBase58()
const base:TradingSessionConfig={version:1,mode:'dca',walletId:'wallet',payer,mint,action:'buy',buySol:'0.01',sellPercent:25,maxTrades:2,intervalMs:5000,durationMs:60000,maxDebitSol:'0.05',slippage:5,priorityFeeSol:0.0001}
function memory():TradeStorage{const values=new Map<string,string>();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v)},removeItem:k=>{values.delete(k)}}}
function prepared(input:TradeInput):PreparedTrade{
 const mintKey=new PublicKey(input.mint),curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),mintKey.toBuffer()],PUMP_PROGRAM_ID)[0]
 const global=PublicKey.findProgramAddressSync([Buffer.from('global')],PUMP_PROGRAM_ID)[0],event=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_PROGRAM_ID)[0]
 const addresses=[global,Keypair.generate().publicKey,mintKey,curve,getAssociatedTokenAddressSync(mintKey,curve,true),getAssociatedTokenAddressSync(mintKey,key.publicKey),key.publicKey,SystemProgram.programId,TOKEN_PROGRAM_ID,Keypair.generate().publicKey,event,PUMP_PROGRAM_ID]
 const data=Buffer.alloc(24);Buffer.from([102,6,61,18,1,218,235,234]).copy(data);data.writeBigUInt64LE(100n,8);data.writeBigUInt64LE(10_000_000n,16)
 const transaction=new VersionedTransaction(new TransactionMessage({payerKey:key.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[new TransactionInstruction({programId:PUMP_PROGRAM_ID,data,keys:addresses.map((pubkey,i)=>({pubkey,isSigner:i===6,isWritable:[1,3,4,5,6,9].includes(i)}))})]}).compileToV0Message())
 return {transaction,input,position:{mint:input.mint,payer,decimals:6,tokenRaw:'0',solLamports:'1000000000',tokenProgram:TOKEN_PROGRAM_ID.toBase58(),ata:getAssociatedTokenAddressSync(mintKey,key.publicKey).toBase58(),status:'active'},maxBuyLamports:'10000000',maxSellRaw:'0',tokenAmountRaw:'100',minimumSolOut:'0',tokenChangeRaw:'100',solChangeLamports:'-10005000',networkFeeLamports:'5000',createdAt:1_000_000,message:Buffer.from(transaction.message.serialize()).toString('base64')}
}
function harness(patch:Partial<TradingSessionConfig>={}){
 let time=1_000_000,available=true
 const storage=memory(),sent:VersionedTransaction[]=[],messages:string[]=[],waits:number[]=[]
 const connection={getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',isBlockhashValid:async()=>({context:{slot:100},value:true}),getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000})} as unknown as Connection
 const ports:SessionPorts={now:()=>time,wait:async ms=>{waits.push(ms);time+=ms},prepare:async(_connection,input)=>{const result=prepared(input);messages.push(result.message);return result},readCurve:async()=>({capLamports:'100000000000',creator}),fetchFeed:async()=>({status:'unavailable',items:[],fetchedAt:new Date(time).toISOString(),coverage:'recent-confirmed-transactions'}),simulateSigned:async(_connection,tx)=>{expect(tx.signatures[0].some(byte=>byte!==0)).toBe(true);return {walletBeforeLamports:'1000000000',netDebitLamports:'10005000',networkFeeLamports:'5000'}},send:async(_connection,tx,opts)=>{try{opts.onBroadcast?.()}catch(error){return {status:'failed',signature:'',submitted:false,error:String(error)}}sent.push(tx);const {signedTransactionSignature}=await import('../src/lib/transactions/send');return {status:'confirmed',signature:signedTransactionSignature(tx),submitted:true}},assertAvailable:()=>{if(!available)throw new Error('Another operation is pending')},locks:{request:async(name,_opts,callback)=>{expect(name).toBe('vanity-launch-submission');return callback({})}},storage}
 const config={...base,...patch}
 const signer={approved:true as const,readSigner:()=>available?payer:null,sign:async(tx:VersionedTransaction)=>{tx.sign([key]);return tx}}
 return {connection,ports,config,signer,storage,sent,messages,waits,setAvailable:(value:boolean)=>{available=value},advance:(ms:number)=>{time+=ms},now:()=>time}
}
describe('bounded trading engine',()=>{
 it('prepares and signs fresh native messages, saves pending before send, and honors the total debit ceiling',async()=>{
  const h=harness();const original=h.ports.send
  h.ports.send=async(...args)=>{expect(readTradePending(h.storage)?.signature).toBeTruthy();return original(...args)}
  const result=await new TradingSession(h.connection,h.config,h.ports).run(h.signer)
  expect(result.status).toBe('completed');expect(h.sent).toHaveLength(2);expect(h.messages[0]).not.toBe(h.messages[1]);expect(h.waits).toEqual([5000])
  expect(result.reservedDebitLamports).toBe('40010000');expect(readTradePending(h.storage)).toBeNull();expect(readTradeHistory(h.storage)).toHaveLength(2)
 })
 it('stops before the next signature when the remaining hard debit ceiling cannot cover buy, fee and rent',async()=>{
  const h=harness({maxDebitSol:'0.03'}),sign=vi.fn(h.signer.sign)
  const result=await new TradingSession(h.connection,h.config,h.ports).run({...h.signer,sign})
  expect(h.sent).toHaveLength(1);expect(sign).toHaveBeenCalledOnce();expect(result.message).toMatch(/budget|ceiling/i)
 })
 it('preserves the original signature and stops immediately on unknown confirmation',async()=>{
  const h=harness();h.ports.send=async(_connection,tx,opts)=>{opts.onBroadcast?.();const {signedTransactionSignature}=await import('../src/lib/transactions/send');return {status:'unknown',signature:signedTransactionSignature(tx),submitted:true}}
  const result=await new TradingSession(h.connection,h.config,h.ports).run(h.signer)
  expect(result.status).toBe('unknown');expect(result.rows).toHaveLength(1);expect(readTradePending(h.storage)?.signature).toBe(result.rows[0].signature);expect(h.waits).toEqual([])
 })
 it('checks the live key after signing and signed simulation, and again after saving the public journal',async()=>{
  for(const boundary of ['sign','simulate','journal']){
   const h=harness();const signer={...h.signer,onChange:(journal:TradingSessionJournal)=>{if(boundary==='journal'&&journal.phase==='sending')h.setAvailable(false)}}
   if(boundary==='sign')signer.sign=async tx=>{tx.sign([key]);h.setAvailable(false);return tx}
   if(boundary==='simulate')h.ports.simulateSigned=async()=>{h.setAvailable(false);return {walletBeforeLamports:'1000000000',netDebitLamports:'10005000',networkFeeLamports:'5000'}}
   await new TradingSession(h.connection,h.config,h.ports).run(signer)
   expect(h.sent,boundary).toHaveLength(0);expect(readTradePending(h.storage),boundary).toBeNull()
  }
 })
 it('rejects a wallet-mutated message and a signed simulation that exceeds the debit reservation',async()=>{
  const h=harness();h.signer.sign=async tx=>{tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.sign([key]);return tx}
  const result=await new TradingSession(h.connection,h.config,h.ports).run(h.signer)
  expect(result.message).toMatch(/message|changed/i);expect(h.sent).toHaveLength(0)
  const h2=harness();h2.ports.simulateSigned=async()=>({walletBeforeLamports:'1000000000',netDebitLamports:'21000000',networkFeeLamports:'5000'})
  const result2=await new TradingSession(h2.connection,h2.config,h2.ports).run(h2.signer)
  expect(result2.message).toMatch(/debit|cost|ceiling/i);expect(h2.sent).toHaveLength(0)
 })
 it('cancels before broadcasting, never rearms a used instance, and rejects preexisting pending work',async()=>{
  const h=harness(),abort=new AbortController();h.ports.simulateSigned=async()=>{abort.abort();return {walletBeforeLamports:'1000000000',netDebitLamports:'10005000',networkFeeLamports:'5000'}}
  const session=new TradingSession(h.connection,h.config,h.ports),result=await session.run({...h.signer,signal:abort.signal})
  expect(result.status).toBe('stopped');expect(h.sent).toHaveLength(0);await expect(session.run(h.signer)).rejects.toThrow(/used|rearm/i)
  const h2=harness();saveTradePending({action:'buy',mint,payer,signature:'original',blockhash:mint,submittedAt:new Date().toISOString(),maxBuyLamports:'1',maxSellRaw:'0'},h2.storage)
  const blocked=await new TradingSession(h2.connection,h2.config,h2.ports).run(h2.signer);expect(blocked.message).toMatch(/pending|confirmation/i);expect(h2.messages).toHaveLength(0)
 })
 it('stops expired sessions without catch-up bursts and saves a confirmed receipt even when the key locks during confirmation',async()=>{
  const h=harness();h.ports.prepare=async(_connection,input)=>{h.advance(60001);return prepared(input)}
  const expired=await new TradingSession(h.connection,h.config,h.ports).run(h.signer);expect(expired.status).toBe('completed');expect(h.sent).toHaveLength(0)
  const h2=harness();const send=h2.ports.send;h2.ports.send=async(...args)=>{const result=await send(...args);h2.setAvailable(false);return result}
  const locked=await new TradingSession(h2.connection,h2.config,h2.ports).run(h2.signer);expect(locked.rows[0].status).toBe('confirmed');expect(readTradeHistory(h2.storage)).toHaveLength(1);expect(h2.sent).toHaveLength(1)
 })
 it('seeds the detection baseline, filters older launches and buys each newly detected mint at most once',async()=>{
  const h=harness({mode:'new-launch',mint:undefined,keyword:'orbit',maxTrades:2,durationMs:16000}),newMint=Keypair.generate().publicKey.toBase58()
  const item=(address:string,timestamp:number)=>({mint:address,name:'Orbit idea',symbol:'ORB',creator,timestamp,signature:'public signature'})
  let polls=0;h.ports.fetchFeed=async()=>({status:'ready',items:++polls===1?[item(mint,1000)]:[item(mint,999),item(newMint,1005)],fetchedAt:new Date(h.now()).toISOString(),coverage:'recent-confirmed-transactions'})
  const result=await new TradingSession(h.connection,h.config,h.ports).run(h.signer)
  expect(h.sent).toHaveLength(1);expect(result.rows[0].mint).toBe(newMint);expect(polls).toBeGreaterThan(1)
 })
 it('stops clearly when the launch feed is unavailable and compares cap thresholds using integer lamports',async()=>{
  const h=harness({mode:'new-launch',mint:undefined,creator,maxTrades:1})
  expect((await new TradingSession(h.connection,h.config,h.ports).run(h.signer)).message).toMatch(/feed|unavailable/i);expect(h.sent).toHaveLength(0)
  const h2=harness({mode:'cap',maxTrades:1,capSol:'100.000000001',capDirection:'at-or-above',durationMs:10000})
  await new TradingSession(h2.connection,h2.config,h2.ports).run(h2.signer);expect(h2.sent).toHaveLength(0)
 })
 it('rejects an inconsistent quoted buy ceiling and labels provider feed failures clearly',async()=>{
  const h=harness({maxDebitSol:'0.015'});h.ports.prepare=async(_connection,input)=>({...prepared(input),maxBuyLamports:'1'})
  const result=await new TradingSession(h.connection,h.config,h.ports).run(h.signer)
  expect(h.sent).toHaveLength(0);expect(result.message).toMatch(/ceiling|preview|budget/i)
  const h2=harness({mode:'new-launch',mint:undefined,keyword:'orbit'});h2.ports.fetchFeed=async()=>{throw new Error('HTTP 503')}
  expect((await new TradingSession(h2.connection,h2.config,h2.ports).run(h2.signer)).message).toMatch(/launch feed.*unavailable/i)
 })
 it('checks again inside the send callback and refuses a durable journal failure before broadcast',async()=>{
  const h=harness();h.ports.send=async(_connection,_tx,opts)=>{h.setAvailable(false);try{opts.onBroadcast?.()}catch{return {status:'failed',signature:'',submitted:false,error:'locked'}};throw new Error('Unexpected broadcast')}
  const result=await new TradingSession(h.connection,h.config,h.ports).run(h.signer)
  expect(result.rows[0].status).toBe('not-submitted');expect(readTradePending(h.storage)).toBeNull()
  const h2=harness();const write=h2.storage.setItem
  h2.storage.setItem=(key,value)=>{if(key==='outsol-trading-sessions-v1'&&value.includes('"phase":"sending"'))throw new Error('quota');write(key,value)}
  await new TradingSession(h2.connection,h2.config,h2.ports).run(h2.signer)
  expect(h2.sent).toHaveLength(0);expect(readTradePending(h2.storage)).toBeNull()
 })
 it('never signs a cap trade when the fresh locked quote reverses the triggering observation',async()=>{
  for(const action of ['buy','sell'] as const){
   const h=harness({mode:'cap',action,maxTrades:1,capSol:'100',capDirection:action==='buy'?'at-or-below':'at-or-above'})
   let reads=0;h.ports.readCurve=async()=>({capLamports:(++reads===1?(action==='buy'?99_000_000_000n:101_000_000_000n):(action==='buy'?101_000_000_000n:99_000_000_000n)).toString(),creator})
   const sign=vi.fn(h.signer.sign),result=await new TradingSession(h.connection,h.config,h.ports).run({...h.signer,sign})
   expect(sign,action).not.toHaveBeenCalled();expect(h.sent,action).toHaveLength(0);expect(result.message).toMatch(/cap.*moved|threshold/i)
  }
 })
})

describe('signed same-bank simulation and SOL cap',()=>{
 it('requests signature verification without replacing the signed blockhash and measures both token and wallet changes',async()=>{
  const draft=prepared({...base,mint:mint!,action:'buy'} as TradeInput);draft.transaction.sign([key]);let request:Record<string,unknown>|null=null
  const data=Buffer.alloc(165);data.writeBigUInt64LE(100n,64)
  vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{request=JSON.parse(String(init.body));return Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:[{lamports:1000000000},null],postExecutionAccounts:[{lamports:989995000},{data:[data.toString('base64'),'base64']}]}]}}})})
  const connection={rpcEndpoint:'https://rpc.invalid',getFeeForMessage:async()=>({value:5000})} as unknown as Connection
  expect(await simulateSignedTrade(connection,draft.transaction,draft,()=>{})).toEqual({walletBeforeLamports:'1000000000',netDebitLamports:'10005000',networkFeeLamports:'5000'})
  expect((request as unknown as {params:unknown[]}).params[1]).toMatchObject({skipSigVerify:false,replaceRecentBlockhash:false})
 })
 it('decodes the native curve and uses integer market cap, rejecting graduated or non-Pump accounts',async()=>{
  const data=Buffer.alloc(49);Buffer.from([23,183,248,55,96,216,172,96]).copy(data);data.writeBigUInt64LE(3n,8);data.writeBigUInt64LE(10000001n,16);data.writeBigUInt64LE(1000n,40)
  const info={data,owner:PUMP_PROGRAM_ID,lamports:1,executable:false,rentEpoch:0}
  const connection={getAccountInfo:async()=>info} as unknown as Connection
  expect((await readSolCurveQuote(connection,mint,()=>{})).capLamports).toBe('3333333666')
  data[48]=1;await expect(readSolCurveQuote(connection,mint,()=>{})).rejects.toThrow(/graduat|complete/i)
  info.owner=SystemProgram.programId;await expect(readSolCurveQuote(connection,mint,()=>{})).rejects.toThrow(/Pump|curve/i)
 })
})
