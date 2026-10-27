import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {OnlinePumpSdk} from '@pump-fun/pump-sdk'
import {prepareMultiLaunch} from '../src/lib/multiLaunch/session'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'
import {confirmSignatures} from '../src/lib/transactions/send'
import {TradingSession} from '../src/lib/tradingSessions/engine'
import {readTokenPosition} from '../src/lib/venues/trade'
import {readTradePending,readTradeHistory,type TradeStorage} from '../src/lib/venues/tradeHistory'
import {DEFAULT_SESSION_FORM,sessionConfigFromForm} from '../src/lib/tradingSessions/draft'

afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_TRADING_SESSION_LOCALNET!=='1')('bounded sessions with signed fake-SOL Surfpool execution',()=>{
 it('confirms two fresh DCA buys and one triggered sale with native signed simulation and original public receipts',async()=>{
  const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint)
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool is allowed')
  const fresh=Keypair.generate(),payer=fresh.publicKey.toBase58(),realFetch=globalThis.fetch
  let runtimeVerified=false
  const localFetch:typeof fetch=async(input,init)=>{
   if(new URL(String(input)).origin!==url.origin)throw new Error('The fake-SOL session test blocked an external request')
   const call=JSON.parse(String(init?.body))
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
    if(!runtimeVerified)throw new Error('Identify Surfpool before requesting or spending fake SOL')
    const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((encoded:string)=>VersionedTransaction.deserialize(Buffer.from(encoded,'base64')).message.staticAccountKeys[0].toBase58())
    if(payers.some((address:string)=>address!==payer))throw new Error('Only the fresh in-memory fake-SOL payer may submit')
   }
   return realFetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30_000)})
  }
  vi.stubGlobal('fetch',localFetch)
  const rpc=async(method:string,params:unknown[]=[])=>{const response=await localFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const value=await response.json();if(value.error)throw new Error(value.error.message);return value.result}
  const version=await rpc('getVersion'),info=await rpc('surfnet_getSurfnetInfo')
  if(typeof version['surfnet-version']!=='string'||info.value?.startup?.phase!=='ready')throw new Error('The loopback endpoint is not a ready Surfpool runtime')
  await rpc('surfnet_getLocalSignatures',[0]);runtimeVerified=true
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:localFetch,disableRetryOnRateLimit:true}),values=new Map<string,string>()
  const locks={request:async<T,>(_name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>callback({})}
  const storage:TradeStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}}
  vi.stubGlobal('localStorage',storage)
  const airdrop=await connection.requestAirdrop(fresh.publicKey,2_000_000_000)
  expect((await confirmSignatures(connection,[airdrop],{timeoutMs:10_000,pollIntervalMs:100})).status).toBe('confirmed')
  const global=await new OnlinePumpSdk(connection).fetchGlobal(),accounts=Object.values(global).flat().filter((value):value is PublicKey=>value instanceof PublicKey)
  await connection.getMultipleAccountsInfo([...new Map(accounts.map(account=>[account.toBase58(),account])).values()])
  const launch=await prepareMultiLaunch(connection,{payer,rows:[{name:'OutSol Session Alpha',symbol:'OSSESA',buySol:'0.01'},{name:'OutSol Session Beta',symbol:'OSSESB',buySol:'0.01'}],shared:{description:'Local fake-SOL session test',image:new Blob(['local artwork'],{type:'image/png'})},slippage:5,priorityFeeSol:0.0001,jitoTipSol:0.00001},{readSigner:()=>payer},{upload:async metadata=>({success:true,metadataUri:`https://example.com/${metadata.symbol}.json`}),simulate:async(conn,packets,options)=>{
   const keys=[...new Map(packets.flatMap(packet=>packet.message.staticAccountKeys).map(key=>[key.toBase58(),key])).values()]
   for(let index=0;index<keys.length;index+=100)await conn.getMultipleAccountsInfo(keys.slice(index,index+100))
   return simulateAtomicBundle(conn,packets,options)
  },sendBundle:(conn,packets,options)=>submitAtomicBundle(conn,packets,{...options,endpoint}),locks})
  const created=await launch.run({approved:true,readSigner:()=>payer,sign:async packets=>{packets.forEach(packet=>packet.sign([fresh]));return packets}})
  expect(created.status,created.error).toBe('confirmed')
  const mint=created.rows[0].mint,signer={approved:true as const,readSigner:()=>payer,sign:async(transaction:VersionedTransaction)=>{transaction.sign([fresh]);return transaction}}
  const config=sessionConfigFromForm({...DEFAULT_SESSION_FORM,mode:'dca',mint,action:'buy',buySol:'0.005',sellPercent:'unused hidden field',maxTrades:'2',intervalSeconds:'5',maxDebitSol:'0.05'},'fresh-fake-sol-wallet',payer)
  const beforeBuy=await connection.getBalance(fresh.publicKey),beforeTokens=await readTokenPosition(connection,mint,payer)
  const dca=await new TradingSession(connection,config,{storage,locks}).run(signer)
  expect(dca.status,dca.message).toBe('completed');expect(dca.rows.map(row=>row.status)).toEqual(['confirmed','confirmed'])
  const afterBuy=await connection.getBalance(fresh.publicKey),bought=await readTokenPosition(connection,mint,payer)
  expect(BigInt(bought.tokenRaw)).toBeGreaterThan(BigInt(beforeTokens.tokenRaw));expect(BigInt(beforeBuy)-BigInt(afterBuy)).toBeGreaterThan(0n)
  expect(BigInt(dca.reservedDebitLamports)).toBeGreaterThanOrEqual(BigInt(beforeBuy)-BigInt(afterBuy));expect(BigInt(dca.reservedDebitLamports)).toBeLessThanOrEqual(50_000_000n)
  const saleConfig=sessionConfigFromForm({...DEFAULT_SESSION_FORM,mode:'cap',action:'sell',mint,buySol:'unused hidden field',capDirection:'at-or-above',capSol:'0.000000001',maxDebitSol:'0.01'},'fresh-fake-sol-wallet',payer)
  const sale=await new TradingSession(connection,saleConfig,{storage,locks}).run(signer)
  expect(sale.status,sale.message).toBe('completed');expect(sale.rows[0].status).toBe('confirmed')
  const sold=await readTokenPosition(connection,mint,payer)
  expect(BigInt(sold.tokenRaw)).toBe(BigInt(bought.tokenRaw)-BigInt(bought.tokenRaw)*25n/100n)
  expect(readTradePending(storage)).toBeNull();expect(readTradeHistory(storage)).toHaveLength(3)
  const signatures=[...dca.rows,...sale.rows].map(row=>row.signature!)
  expect(new Set(signatures).size).toBe(3)
  const statuses=await connection.getSignatureStatuses(signatures,{searchTransactionHistory:true})
  expect(statuses.value.every(value=>value&&!value.err&&['confirmed','finalized'].includes(value.confirmationStatus!))).toBe(true)
  expect(JSON.stringify([...values.values()])).not.toMatch(/secretKey|encodedTransactions|signedBytes/)
  console.log(JSON.stringify({proof:'signed-local-trading-session',runtime:'surfpool',realSolSpent:false,mint,signatures,dcaReservedDebitLamports:dca.reservedDebitLamports,dcaActualDebitLamports:String(BigInt(beforeBuy)-BigInt(afterBuy)),sellPercentOfRemaining:25}))
 },180_000)
})
