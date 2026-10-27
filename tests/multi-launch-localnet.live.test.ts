import {afterEach,describe,expect,it,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID,unpackAccount,unpackMint} from '@solana/spl-token'
import {OnlinePumpSdk,bondingCurvePda,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {resolveGitHubIndividual} from '../src/lib/server/githubRecipient'
import type {CreatorFeeSelection} from '../src/lib/creatorFeeRouting'
import {prepareMultiLaunch} from '../src/lib/multiLaunch/session'
import {readBatchJournal} from '../src/lib/multiLaunch/history'
import {readPending} from '../src/lib/launchHistory'
import {confirmSignatures} from '../src/lib/transactions/send'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'

afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_MULTI_LAUNCH_LOCALNET!=='1')('multi-launch with signed fake-SOL Surfpool execution',()=>{
 it.each<CreatorFeeSelection>([{kind:'deployer'},{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards'},{kind:'github',username:'octocat'}])('creates two reviewed tokens with route %s and matches both debits and original receipts',async creatorFeeSelection=>{
  const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint)
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool is allowed')
  const fresh=Keypair.generate(),payer=fresh.publicKey.toBase58(),realFetch=globalThis.fetch
  let runtimeVerified=false
  const localFetch:typeof fetch=async(input,init)=>{
   const requested=new URL(String(input))
   if(requested.origin==='https://api.github.com'&&init?.method==='GET'&&requested.pathname.startsWith('/users/'))return realFetch(input,init)
   if(requested.origin!==url.origin)throw new Error('The fake-SOL test blocked an external request')
   const call=JSON.parse(String(init?.body))
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
    if(!runtimeVerified)throw new Error('Surfpool must be identified before using fake SOL')
    const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((encoded:string)=>VersionedTransaction.deserialize(Buffer.from(encoded,'base64')).message.staticAccountKeys[0].toBase58())
    if(payers.some((address:string)=>address!==payer))throw new Error('Only the fresh in-memory fake-SOL payer may submit')
   }
   return realFetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30_000)})
  }
  vi.stubGlobal('fetch',localFetch)
  const rpc=async(method:string,params:unknown[]=[])=>{const response=await localFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const result=await response.json();if(result.error)throw new Error(result.error.message);return result.result}
  const version=await rpc('getVersion'),info=await rpc('surfnet_getSurfnetInfo')
  if(version['surfnet-version']!=='1.6.1'||info.value?.startup?.phase!=='ready')throw new Error('The loopback endpoint is not a ready Surfpool runtime')
  await rpc('surfnet_getLocalSignatures',[0]);runtimeVerified=true
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:localFetch,disableRetryOnRateLimit:true}),storage=new Map<string,string>()
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value)},removeItem:(key:string)=>{storage.delete(key)}})
  const airdrop=await connection.requestAirdrop(fresh.publicKey,2_000_000_000)
  expect((await confirmSignatures(connection,[airdrop],{timeoutMs:10_000,pollIntervalMs:100})).status).toBe('confirmed')
  const global=await new OnlinePumpSdk(connection).fetchGlobal(),accounts=Object.values(global).flat().filter((value):value is PublicKey=>value instanceof PublicKey)
  await connection.getMultipleAccountsInfo([...new Map(accounts.map(account=>[account.toBase58(),account])).values()])
  const simulationEvidence:{signed:boolean;debit?:string;error?:string}[]=[]
  const before=await connection.getBalance(fresh.publicKey),session=await prepareMultiLaunch(connection,{payer,creatorFeeSelection,rows:[{name:'OutSol Multi Alpha',symbol:'OSMALPHA',buySol:'0.01'},{name:'OutSol Multi Beta',symbol:'OSMBETA',buySol:'0.02'}],shared:{description:'Local simulator test only',image:new Blob(['local test artwork'],{type:'image/png'})},slippage:5,priorityFeeSol:0.0001,jitoTipSol:0.00001},{readSigner:()=>payer},{
   resolveGitHub:resolveGitHubIndividual,
   upload:async metadata=>({success:true,metadataUri:`https://example.com/${metadata.symbol}.json`}),
   locks:{request:async(_name,_options,callback)=>callback({})},
   simulate:async(conn,packets,options)=>{const keys=[...new Map(packets.flatMap(packet=>packet.message.staticAccountKeys).map(key=>[key.toBase58(),key])).values()];for(let index=0;index<keys.length;index+=100)await conn.getMultipleAccountsInfo(keys.slice(index,index+100));const result=await simulateAtomicBundle(conn,packets,options);simulationEvidence.push({signed:!!options?.verifySignatures,debit:result.payerDebitLamports,error:result.error});return result},
   sendBundle:(conn,packets,options)=>submitAtomicBundle(conn,packets,{...options,endpoint}),
  })
  const review=session.review()
  expect(new Set(review.rows.map(row=>row.mint)).size).toBe(2)
  const result=await session.run({approved:true,readSigner:()=>payer,sign:async packets=>{packets.forEach(packet=>packet.sign([fresh]));return packets}})
  expect(result.status,`${result.error??''}; public simulations: ${JSON.stringify(simulationEvidence)}`).toBe('confirmed')
  expect(result.rows.map(row=>row.status)).toEqual(['confirmed','confirmed'])
  expect((BigInt(before)-BigInt(await connection.getBalance(fresh.publicKey))).toString()).toBe(review.totalDebitLamports)
  for(const row of result.rows){
   const mint=new PublicKey(row.mint),mintInfo=await connection.getAccountInfo(mint),curve=await connection.getAccountInfo(bondingCurvePda(mint))
   expect(mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);expect(curve?.owner.equals(PUMP_PROGRAM_ID)).toBe(true)
   expect(unpackMint(mint,mintInfo!,TOKEN_2022_PROGRAM_ID).isInitialized).toBe(true)
   const observed=PUMP_SDK.decodeBondingCurve(curve!)
   expect(row.creatorFeeRouting?.selection).toEqual(creatorFeeSelection)
   expect(observed.creator.toBase58()).toBe(row.creatorFeeRouting?.effectiveCreator)
   expect(observed.isHolderReward).toBe(creatorFeeSelection.kind==='holder-rewards')
   expect(observed.isCashbackCoin).toBe(false)
   const ata=getAssociatedTokenAddressSync(mint,fresh.publicKey,false,TOKEN_2022_PROGRAM_ID),token=await connection.getAccountInfo(ata)
   expect(unpackAccount(ata,token!,TOKEN_2022_PROGRAM_ID).amount).toBeGreaterThan(0n)
   const statuses=await connection.getSignatureStatuses(row.signatures,{searchTransactionHistory:true})
   expect(statuses.value.every(value=>value&&!value.err&&['confirmed','finalized'].includes(value.confirmationStatus!))).toBe(true)
  }
  expect(readPending()).toBeNull();expect(readBatchJournal()?.status).toBe('confirmed')
  expect(JSON.stringify([...storage.values()])).not.toMatch(/secretKey|encodedTransactions|signedBytes/)
  const actualDebitLamports=(BigInt(before)-BigInt(await connection.getBalance(fresh.publicKey))).toString()
  const proof={proof:'signed-local-multi-launch',creatorFeeSelection,timestamp:new Date().toISOString(),engine:'surfpool',runtime:version['surfnet-version'],count:result.rows.length,costMatching:actualDebitLamports===review.totalDebitLamports,realSolSpent:false,reviewedDebitLamports:review.totalDebitLamports,actualDebitLamports,checks:['two-distinct-mints','reviewed-messages-signed','complete-debit-matched','confirmed-token-balances','original-public-receipts','engine-owned-lock','explicit-batch-approval']}
  if(process.env.VANITY_MULTI_LAUNCH_EVIDENCE_FILE)writeFileSync(process.env.VANITY_MULTI_LAUNCH_EVIDENCE_FILE,JSON.stringify(proof,null,2)+'\n')
  console.log(JSON.stringify(proof))
 },120_000)
})
