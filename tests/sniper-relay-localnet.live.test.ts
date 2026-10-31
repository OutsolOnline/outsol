import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdir,writeFile} from 'node:fs/promises'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {OnlinePumpSdk} from '@pump-fun/pump-sdk'
import {prepareMultiLaunch} from '../src/lib/multiLaunch/session'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'
import {confirmSignatures} from '../src/lib/transactions/send'
import {TradingSession} from '../src/lib/tradingSessions/engine'
import {readTokenPosition} from '../src/lib/venues/trade'
import {readTradePending,readTradeHistory,type TradeStorage} from '../src/lib/venues/tradeHistory'
import {DEFAULT_SESSION_FORM,sessionConfigFromForm} from '../src/lib/tradingSessions/draft'
import {readRelayReceipts} from '../src/lib/relay/history'
import {readPendingWalletOperation} from '../src/lib/walletOperations/history'
import {prepareSaleBatch,executeSaleBatch} from '../src/lib/sales/batch'

afterEach(()=>vi.unstubAllGlobals())

describe.skipIf(process.env.RUN_SNIPER_RELAY_LOCALNET!=='1')('sniper → Relay recipient → sale with isolated fake SOL',()=>{
 it('preserves existing source holdings, relays the exact new purchase and sells the recipient balance through the product batch',async()=>{
  const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint)
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool is allowed')
  const source=Keypair.generate(),recipient=Keypair.generate(),payer=source.publicKey.toBase58(),destination=recipient.publicKey.toBase58(),allowed=new Set([payer,destination]),realFetch=globalThis.fetch
  let runtimeVerified=false
  const transport:typeof fetch=async(input,init)=>{
   if(new URL(String(input)).origin!==url.origin)throw new Error('The fake-SOL Relay test blocked an external request')
   const call=JSON.parse(String(init?.body))
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
    if(!runtimeVerified)throw new Error('Identify Surfpool before requesting or spending fake SOL')
    const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((encoded:string)=>VersionedTransaction.deserialize(Buffer.from(encoded,'base64')).message.staticAccountKeys[0].toBase58())
    if(payers.some((address:string)=>!allowed.has(address)))throw new Error('Only generated in-memory fake-SOL wallets may submit')
   }
   return realFetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30_000)})
  }
  vi.stubGlobal('fetch',transport)
  const rpc=async(method:string,params:unknown[]=[])=>{const response=await transport(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const value=await response.json();if(value.error)throw new Error(value.error.message);return value.result}
  const version=await rpc('getVersion'),info=await rpc('surfnet_getSurfnetInfo')
  if(typeof version['surfnet-version']!=='string'||info.value?.startup?.phase!=='ready')throw new Error('The loopback endpoint is not a ready Surfpool runtime')
  await rpc('surfnet_getLocalSignatures',[0]);runtimeVerified=true
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:transport,disableRetryOnRateLimit:true}),values=new Map<string,string>()
  const storage:TradeStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}}
  vi.stubGlobal('localStorage',storage)
  let lockHeld=false
  const locks={request:async<T,>(name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>{expect(name).toBe('vanity-launch-submission');if(lockHeld)throw new Error('Unexpected nested transaction lock');lockHeld=true;try{return await callback({})}finally{lockHeld=false}}}
  for(const [key,lamports] of [[source,2_000_000_000],[recipient,20_000_000]] as const){const signature=await connection.requestAirdrop(key.publicKey,lamports);expect((await confirmSignatures(connection,[signature],{timeoutMs:10_000,pollIntervalMs:100})).status).toBe('confirmed')}
  const global=await new OnlinePumpSdk(connection).fetchGlobal(),accounts=Object.values(global).flat().filter((value):value is PublicKey=>value instanceof PublicKey)
  await connection.getMultipleAccountsInfo([...new Map(accounts.map(account=>[account.toBase58(),account])).values()])
  const launch=await prepareMultiLaunch(connection,{payer,rows:[{name:'OutSol Relay Proof',symbol:'OSRELAY',buySol:'0.01'},{name:'OutSol Relay Control',symbol:'OSRELCTRL',buySol:'0'}],shared:{description:'Local fake-SOL Relay acceptance',image:new Blob(['local artwork'],{type:'image/png'})},slippage:5,priorityFeeSol:0.0001,jitoTipSol:0.00001},{readSigner:()=>payer},{upload:async metadata=>({success:true,metadataUri:`https://example.com/${metadata.symbol}.json`}),simulate:async(conn,packets,options)=>{
   const keys=[...new Map(packets.flatMap(packet=>packet.message.staticAccountKeys).map(key=>[key.toBase58(),key])).values()]
   for(let index=0;index<keys.length;index+=100)await conn.getMultipleAccountsInfo(keys.slice(index,index+100))
   return simulateAtomicBundle(conn,packets,options)
  },sendBundle:(conn,packets,options)=>submitAtomicBundle(conn,packets,{...options,endpoint}),locks})
  const created=await launch.run({approved:true,readSigner:()=>payer,sign:async packets=>{packets.forEach(packet=>packet.sign([source]));return packets}})
  expect(created.status,created.error).toBe('confirmed')
  const mint=created.rows[0].mint,before=await readTokenPosition(connection,mint,payer),recipientBefore=await connection.getBalance(recipient.publicKey)
  expect(BigInt(before.tokenRaw)).toBeGreaterThan(0n)
  const config=sessionConfigFromForm({...DEFAULT_SESSION_FORM,mode:'dca',mint,action:'buy',buySol:'0.005',maxTrades:'1',intervalSeconds:'5',durationSeconds:'300',maxDebitSol:'0.1',relayEnabled:'true',relayWalletId:'fresh-recipient',relayDestination:destination,relayMaxDebitSol:'0.01'},'fresh-source',payer)
  const session=await new TradingSession(connection,config,{storage,locks}).run({approved:true,readSigner:()=>payer,sign:async transaction=>{expect(lockHeld).toBe(true);transaction.sign([source]);return transaction}})
  expect(session.status,session.message).toBe('completed')
  expect(session.rows).toHaveLength(1);expect(session.rows[0].status).toBe('confirmed');expect(session.rows[0].relay?.status).toBe('confirmed')
  const after=await readTokenPosition(connection,mint,payer),received=await readTokenPosition(connection,mint,destination),relay=session.rows[0].relay!
  expect(after.tokenRaw).toBe(before.tokenRaw)
  expect(received.tokenRaw).toBe(relay.amountRaw);expect(BigInt(received.tokenRaw)).toBeGreaterThan(0n)
  expect(await connection.getBalance(recipient.publicKey)).toBe(recipientBefore)
  const sourceDebit=BigInt(before.solLamports)-BigInt(after.solLamports)
  expect(sourceDebit).toBeGreaterThan(0n);expect(sourceDebit).toBeLessThanOrEqual(BigInt(session.reservedDebitLamports));expect(BigInt(session.reservedDebitLamports)).toBeLessThanOrEqual(100_000_000n)
  const transferReceipts=readRelayReceipts(storage)
  expect(transferReceipts).toHaveLength(1);expect(transferReceipts[0]).toMatchObject({source:payer,destination,mint,amountRaw:received.tokenRaw,status:'confirmed',signature:relay.signature})
  expect(readPendingWalletOperation(storage)).toBeNull();expect(readTradePending(storage)).toBeNull()
  const sourceSignatures=[session.rows[0].signature!,relay.signature!]
  let measuredSourceDebit=0n
  for(const signature of sourceSignatures){const tx=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});expect(tx?.meta?.err).toBeNull();expect(tx?.transaction.message.staticAccountKeys[0].toBase58()).toBe(payer);measuredSourceDebit+=BigInt(tx!.meta!.preBalances[0])-BigInt(tx!.meta!.postBalances[0])}
  expect(measuredSourceDebit).toBe(sourceDebit)
  const review=await prepareSaleBatch(connection,[{walletId:'fresh-recipient',walletName:'Relay recipient',payer:destination,mint,tokenProgram:received.tokenProgram,amountRaw:received.tokenRaw,decimals:received.decimals}],{slippageBps:500,priorityFeeLamports:'100000'},{storage,locks})
  expect(review.rows[0].status,review.rows[0].error).toBe('ready');expect(review.rows[0].route).toBe('pump')
  const sale=await executeSaleBatch(connection,review,{approved:true,readSigner:id=>id==='fresh-recipient'?destination:null,sign:async(id,transaction)=>{expect(id).toBe('fresh-recipient');expect(lockHeld).toBe(true);transaction.sign([recipient]);return transaction}},{storage,locks})
  expect(sale.status,sale.error).toBe('completed');expect(sale.rows[0].status,sale.rows[0].error).toBe('confirmed')
  const finalRecipient=await readTokenPosition(connection,mint,destination)
  expect(finalRecipient.tokenRaw).toBe('0');expect(BigInt(finalRecipient.solLamports)).toBeGreaterThan(BigInt(received.solLamports))
  expect((await readTokenPosition(connection,mint,payer)).tokenRaw).toBe(before.tokenRaw)
  expect(readTradePending(storage)).toBeNull();expect(readTradeHistory(storage)).toHaveLength(2)
  expect(JSON.stringify([...values.values()])).not.toMatch(/secretKey|encodedTransactions|signedBytes/)
  const signatures=[...sourceSignatures,sale.rows[0].signature!],statuses=await connection.getSignatureStatuses(signatures,{searchTransactionHistory:true})
  expect(statuses.value.every(value=>value&&!value.err&&['confirmed','finalized'].includes(value.confirmationStatus!))).toBe(true)
  await mkdir('work',{recursive:true})
  await writeFile('work/relay-session-proof.json',JSON.stringify({proof:'production-session-buy-auto-relay-recipient-sale',runtime:'surfpool',runtimeVersion:version['surfnet-version'],realSolSpent:false,network:'local-mainnet-fork',source:payer,recipient:destination,mint,sourceExistingTokenRaw:before.tokenRaw,sourceFinalTokenRaw:(await readTokenPosition(connection,mint,payer)).tokenRaw,newlyPurchasedAndRelayedRaw:relay.amountRaw,recipientAfterSaleTokenRaw:finalRecipient.tokenRaw,sourceDebitLamports:sourceDebit.toString(),sourceReservedDebitLamports:session.reservedDebitLamports,saleMinimumSolOut:review.rows[0].minimumSolOut,recipientNetSaleLamports:(BigInt(finalRecipient.solLamports)-BigInt(received.solLamports)).toString(),signatures,limitations:['Local fake-SOL execution only; no mainnet landing or first-block guarantee.','Acceptance covers native active Pump.fun sale, not Jupiter external route execution.']},null,2)+'\n')
 },240_000)
})
