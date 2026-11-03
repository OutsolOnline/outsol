import {afterEach,describe,expect,it,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount} from '@solana/spl-token'
import {buildCreateTransaction} from '../src/lib/pumpfun/api'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'
import {confirmSignatures,sendAndConfirmTransaction} from '../src/lib/transactions/send'
import {saveStagedLaunchPlan,attachStagedLaunchMint} from '../src/lib/buyPlans/launchHandoff'
import {readBuyPlan} from '../src/lib/buyPlans/model'
import {prepareBuyPlan,executeBuyPlan} from '../src/lib/buyPlans/engine'
import {readBuyPlanJournals,reconcileBuyPlanJournals} from '../src/lib/buyPlans/history'
import {readTradePending} from '../src/lib/venues/tradeHistory'
import {StrategyQueue} from '../src/lib/tradingSessions/strategyQueue'
import type {StrategyQueueConfig} from '../src/lib/tradingSessions/queueModel'

afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_BUY_PLANS_LOCALNET!=='1')('staged plans with guarded fake-SOL native execution',()=>{
 it('deploys with zero immediate buyers, executes pair forwarding, recovers originals and continues a paused multi-wallet queue',async()=>{
  const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint)
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Only an unauthenticated loopback Surfpool runtime may execute fake-SOL staged plans.')
  const creator=Keypair.generate(),buyers=[Keypair.generate(),Keypair.generate()],receivers=[Keypair.generate(),Keypair.generate()],mint=Keypair.generate(),owned=new Set([creator,...buyers,...receivers].map(key=>key.publicKey.toBase58())),realFetch=globalThis.fetch
  let verified=false,broadcasts=0
  const guarded:typeof fetch=async(resource,init)=>{
   if(new URL(String(resource)).origin!==url.origin)throw new Error('This fake-SOL test refuses every external request.')
   const call=JSON.parse(String(init?.body))
   if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared simulator mutation is forbidden.')
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
    if(!verified)throw new Error('Identify the fake runtime before any funding or submission.')
    const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((encoded:string)=>VersionedTransaction.deserialize(Buffer.from(encoded,'base64')).message.staticAccountKeys[0].toBase58())
    if(payers.some((payer:string)=>!owned.has(payer)))throw new Error('Only freshly generated test wallets may spend fake SOL.')
    if(call.method!=='requestAirdrop')broadcasts++
   }
   if(call.method==='simulateBundle'){
    const keys=[...new Set((call.params[0].encodedTransactions as string[]).flatMap(raw=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')).message.staticAccountKeys.map(key=>key.toBase58())))]
    for(let offset=0;offset<keys.length;offset+=100){const response=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[keys.slice(offset,offset+100),{encoding:'base64',commitment:'confirmed'}]}),redirect:'error',signal:AbortSignal.timeout(30000)});if((await response.json()).error)throw new Error('Read-only local protocol hydration failed.')}
   }
   return realFetch(resource,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30000)})
  }
  vi.stubGlobal('fetch',guarded)
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guarded,disableRetryOnRateLimit:true}),version=await connection.getVersion() as unknown as Record<string,unknown>
  expect(typeof version['surfnet-version']).toBe('string')
  const info=await guarded(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'surfnet_getSurfnetInfo',params:[]})});expect((await info.json()).result.value.startup.phase).toBe('ready')
  expect(await connection.getGenesisHash()).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');verified=true
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  vi.stubGlobal('localStorage',storage)
  const locks={request:async<T,>(_name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>callback({})}
  for(const key of [creator,...buyers]){const signature=await connection.requestAirdrop(key.publicKey,1_000_000_000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:100})).status).toBe('confirmed')}
  const settings=saveStagedLaunchPlan({version:1,mode:'manual',groupId:'fake-library',wallets:buyers.map((key,index)=>({walletId:`buyer-${index}`,publicKey:key.publicKey.toBase58(),name:`Pair ${index} source`,buySol:0.01,delaySeconds:0,transferTo:receivers[index].publicKey.toBase58()})),intervalMinSeconds:0,intervalMaxSeconds:0,deferBuys:true},{slippage:5,priorityFeeSol:0.0001},storage)
  const beforeCreatorLaunch=await Promise.all(buyers.map(key=>connection.getBalance(key.publicKey))),built=await buildCreateTransaction({connection,userPublicKey:creator.publicKey.toBase58(),mintKeypair:mint,metadata:{name:'Staged Plan QA',symbol:'STAGE',description:''},metadataUri:'https://example.com/staged-qa.json',initialBuyAmount:0,slippage:5,priorityFee:0.0001,jitoTipLamports:10000})
  expect(built.success,built.error).toBe(true)
  const packets=built.transactions??[built.transaction!];packets.forEach(packet=>packet.sign([creator]))
  const simulation=await simulateAtomicBundle(connection,packets,{verifySignatures:true,payer:creator.publicKey.toBase58(),accounts:[creator.publicKey.toBase58()]});expect(simulation.success,simulation.error).toBe(true)
  const launch=packets.length===1?await sendAndConfirmTransaction(connection,packets[0],{timeoutMs:10000,pollIntervalMs:100}):await submitAtomicBundle(connection,packets,{endpoint,timeoutMs:10000,pollIntervalMs:100})
  expect(launch.status,launch.error).toBe('confirmed');expect(await Promise.all(buyers.map(key=>connection.getBalance(key.publicKey)))).toEqual(beforeCreatorLaunch)
  attachStagedLaunchMint(settings,{slippage:5,priorityFeeSol:0.0001},mint.publicKey.toBase58(),storage)
  const saved=readBuyPlan(storage)!,plan={...saved,mode:'sequence' as const,intervalSeconds:0},keys=new Map(buyers.map((key,index)=>[`buyer-${index}`,key]))
  const options={approved:true as const,storage,locks,readKeypair:(id:string)=>keys.get(id)??null,assertCurrent:()=>{}},buyBroadcasts=broadcasts
  const prepared=await prepareBuyPlan(connection,plan,plan.rows.map(row=>row.id),options,{send:async(...args)=>{const result=await sendAndConfirmTransaction(...args);return {...result,status:'unknown' as const}}}),first=await executeBuyPlan(prepared,options)
  expect(first.status,first.error).toBe('unknown');expect(broadcasts-buyBroadcasts).toBe(1);expect(readTradePending(storage)?.signature).toBe(first.rows[0].signature)
  const recovered=await reconcileBuyPlanJournals(connection,{storage,locks});expect(recovered[0].rows[0].status).toBe('confirmed');expect(recovered[0].rows[1].status).toBe('not-submitted');expect(readTradePending(storage)).toBeNull()
  const remaining=await prepareBuyPlan(connection,plan,[plan.rows[1].id],options),second=await executeBuyPlan(remaining,options)
  expect(second.status,second.error).toBe('completed');expect(broadcasts-buyBroadcasts).toBe(2)
  const tokenBalance=async(owner:PublicKey)=>{const address=getAssociatedTokenAddressSync(mint.publicKey,owner,false,TOKEN_2022_PROGRAM_ID),info=await connection.getAccountInfo(address,'confirmed');return info?unpackAccount(address,info,TOKEN_2022_PROGRAM_ID).amount:0n}
  const rows=[recovered[0].rows[0],second.rows[0]]
  for(const [index,row] of rows.entries()){expect(await tokenBalance(buyers[index].publicKey)).toBe(0n);expect((await tokenBalance(receivers[index].publicKey)).toString()).toBe(row.tokenRaw);expect(await connection.getBalance(receivers[index].publicKey)).toBe(0);const tx=await connection.getTransaction(row.signature!,{commitment:'confirmed',maxSupportedTransactionVersion:0});expect(tx?.meta?.err).toBeNull();expect(BigInt(tx!.meta!.preBalances[0])-BigInt(tx!.meta!.postBalances[0])).toBeLessThanOrEqual(BigInt(row.maxDebitLamports))}
  const queueConfig:StrategyQueueConfig={version:1,id:crypto.randomUUID(),name:'Actual native multi-wallet continuation',durationMs:120000,maxDebitSol:'0.06',steps:buyers.map((key,index)=>({id:`queue-${index}`,name:`Pair ${index} strategy`,config:{version:1,mode:index?'cap':'dca',walletId:`buyer-${index}`,payer:key.publicKey.toBase58(),mint:mint.publicKey.toBase58(),action:'buy',buySol:'0.003',sellPercent:100,maxTrades:1,intervalMs:5000,durationMs:60000,maxDebitSol:'0.03',slippage:5,priorityFeeSol:0.0001,...(index?{capDirection:'at-or-above' as const,capSol:'0.000000001'}:{}),relay:{walletId:`receiver-${index}`,destination:receivers[index].publicKey.toBase58(),maxDebitSol:'0.01'}}}))}
  const queue=new StrategyQueue(connection,queueConfig),paused=await queue.run({...options,onChange:value=>{if(value.attempts[0]?.journal.rows[0]?.relay?.status==='confirmed')queue.pause()}})
  expect(paused.status,paused.message).toBe('paused');expect(paused.attempts).toHaveLength(1)
  const continued=await new StrategyQueue(connection,queueConfig).run({...options,resumeFrom:paused})
  expect(continued.status,continued.message).toBe('completed');expect(continued.attempts).toHaveLength(2)
  expect(continued.attempts[0].journal.rows[0].signature).toBe(paused.attempts[0].journal.rows[0].signature)
  for(const key of buyers)expect(await tokenBalance(key.publicKey)).toBe(0n)
  expect(readBuyPlanJournals(storage).flatMap(run=>run.rows.filter(row=>row.signature&&row.status==='confirmed'))).toHaveLength(2)
  expect(JSON.stringify([...values.values()])).not.toMatch(/secretKey|privateKey|encodedTransactions|signedBytes/)
  const signatures=[...rows.map(row=>row.signature!),...continued.attempts.flatMap(attempt=>attempt.journal.rows.flatMap(row=>[row.signature!,row.relay!.signature!]))]
  expect(new Set(signatures).size).toBe(6)
  const finality=await confirmSignatures(connection,signatures,{timeoutMs:10000,pollIntervalMs:100})
  expect(finality.status,finality.error).toBe('confirmed')
  writeFileSync('work/parity-staged-buy-proof.json',JSON.stringify({realSolSpent:false,runtime:'surfpool',mint:mint.publicKey.toBase58(),zeroImmediateBuyers:true,stagedPlanId:plan.id,stagedSignatures:rows.map(row=>row.signature),receiverMappings:rows.map(row=>({payer:row.payer,receiver:row.transferTo,tokenRaw:row.tokenRaw})),originalRecoveryNoResubmission:true,queueStatus:continued.status,queueReservedDebitLamports:continued.reservedDebitLamports,completedSignaturesPreserved:true,signatures},null,2))
 },180000)
})
