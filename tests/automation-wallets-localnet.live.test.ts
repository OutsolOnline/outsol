import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {appendFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename,dirname,join,resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {buildCreateTransaction} from '../src/lib/pumpfun/api'
import {confirmSignatures,sendAndConfirmTransaction,signedTransactionSignature} from '../src/lib/transactions/send'
import {readTokenPosition} from '../src/lib/venues/trade'
import {AutomationStore} from '../src/lib/server/automationWallets/store'
import {AutomationWorker,createAutomationPorts,type AutomationPorts} from '../src/lib/server/automationWallets/worker'
import {createAutomationService} from '../src/lib/server/automationWallets/service'
import type {AutomationPlan} from '../src/lib/automationWallets/model'

const enabled=process.env.RUN_AUTOMATION_WALLETS_LOCALNET==='1'
const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899'
const allowed=new Set<string>(),directories:string[]=[],openStores=new Set<AutomationStore>()
const realFetch=globalThis.fetch
let runtimeVerified=false,connection:Connection,mint:string
const proofFile=process.env.VANITY_AUTOMATION_EVIDENCE_FILE

function localEndpoint(){
 const url=new URL(endpoint)
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool is allowed')
 return url
}
const transport:typeof fetch=async(input,init)=>{
 const url=localEndpoint()
 if(new URL(String(input)).origin!==url.origin)throw new Error('The automation fake-SOL test blocked a nonlocal request')
 const call=JSON.parse(String(init?.body))
 if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared fork mutation is forbidden')
 if(['sendTransaction','sendBundle','requestAirdrop'].includes(call.method)){
  if(!runtimeVerified)throw new Error('A ready Surfpool must be identified before local writes')
  const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((packet:string)=>VersionedTransaction.deserialize(Buffer.from(packet,'base64')).message.staticAccountKeys[0].toBase58())
  if(payers.some((payer:string)=>!allowed.has(payer)))throw new Error('Only freshly generated test wallets may spend simulated SOL')
 }
 return realFetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30_000)})
}
async function rpc(method:string,params:unknown[]=[]){
 const response=await transport(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
 const value=await response.json()
 if(!response.ok||value.error)throw new Error(`Local ${method} failed`)
 return value.result
}
function evidence(value:Record<string,unknown>){
 const record={verifiedAt:new Date().toISOString(),proof:'signed-dedicated-automation-wallet-local-fork',runtime:'surfpool',realSolSpent:false,...value}
 if(proofFile)appendFileSync(proofFile,JSON.stringify(record)+'\n')
 console.log(JSON.stringify(record))
}
async function fund(address:string){
 allowed.add(address)
 const signature=await connection.requestAirdrop(new PublicKey(address),200_000_000)
 expect((await confirmSignatures(connection,[signature],{timeoutMs:10_000,pollIntervalMs:100})).status).toBe('confirmed')
 expect(await connection.getBalance(new PublicKey(address))).toBeGreaterThanOrEqual(200_000_000)
}
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'launchpier-live-automation-'));directories.push(directory)
 const path=join(directory,'wallets.sqlite'),key=randomBytes(32)
 let store=new AutomationStore(path,key);openStores.add(store)
 let now=Date.now(),broadcasts=0,preparedTokenChange='0'
 const native=createAutomationPorts(connection)
 let ports:AutomationPorts={...native,now:()=>now,prepare:async(input,options)=>{const prepared=await native.prepare(input,options);preparedTokenChange=prepared.tokenChangeRaw;return prepared},send:async packet=>{broadcasts++;return native.send(packet)}}
 const service=()=>createAutomationService({store,ports,balance:async address=>String(await connection.getBalance(new PublicKey(address))),enabled:()=>true})
 const restart=()=>{store.close();openStores.delete(store);store=new AutomationStore(path,key);openStores.add(store)}
 const plan=(action:'buy'|'sell',amount='0',maxTrades=1):AutomationPlan=>({version:1,mode:'dca',mint,action,buySol:action==='buy'?'0.01':'0',sellAmountRaw:action==='sell'?amount:'0',intervalSeconds:60,startAt:now+1000,expiresAt:now+600_000,maxTrades,maxDebitPerTradeSol:'0.025',maxTotalDebitSol:maxTrades===2?'0.05':'0.025',minReserveSol:'0.005',slippage:5,priorityFeeSol:0.0001})
 return {get store(){return store},get now(){return now},set now(value:number){now=value},get ports(){return ports},set ports(value:AutomationPorts){ports=value},get broadcasts(){return broadcasts},get preparedTokenChange(){return preparedTokenChange},native,service,restart,plan}
}
async function createBackedFunded(f:ReturnType<typeof fixture>){
 const created=f.service().create(),capability=created.capability,address=created.wallet.address
 expect(created.wallet.backupAcknowledged).toBe(false)
 await expect(f.service().review(capability,f.plan('buy'))).rejects.toThrow(/backup/i)
 const backup=f.service().backup(capability,true).keypair
 try{const restored=Keypair.fromSecretKey(Uint8Array.from(backup));expect(restored.publicKey.toBase58()).toBe(address);restored.secretKey.fill(0)}finally{backup.fill(0)}
 expect(f.store.read(capability).backupAcknowledged).toBe(true)
 await fund(address)
 return {capability,address}
}
async function confirmed(f:ReturnType<typeof fixture>,capability:string){
 const original=f.store.read(capability).history.find(row=>row.status==='pending')
 expect(original).toBeDefined()
 expect((await confirmSignatures(connection,[original!.signature],{timeoutMs:30_000,pollIntervalMs:100})).status).toBe('confirmed')
 await new AutomationWorker(f.store,f.ports).tick()
 expect(f.store.read(capability).history.find(row=>row.signature===original!.signature)?.status).toBe('confirmed')
 return original!
}

describe.skipIf(!enabled)('dedicated unattended wallet signed execution with simulated SOL',()=>{
 beforeAll(async()=>{
  localEndpoint();vi.stubGlobal('fetch',transport)
  const version=await rpc('getVersion'),info=await rpc('surfnet_getSurfnetInfo')
  expect(version['surfnet-version']).toBe('1.6.1');expect(info.value.startup.phase).toBe('ready')
  await rpc('surfnet_getLocalSignatures',[0]);runtimeVerified=true
  connection=new Connection(endpoint,{commitment:'confirmed',fetch:transport,disableRetryOnRateLimit:true})
  const creator=Keypair.generate(),freshMint=Keypair.generate();await fund(creator.publicKey.toBase58())
  const built=await buildCreateTransaction({connection,userPublicKey:creator.publicKey.toBase58(),mintKeypair:freshMint,metadata:{name:'Automation Local Proof',symbol:'AUTOPRF',description:'Simulated SOL only'},metadataUri:'https://example.com/automation-local-proof.json',initialBuyAmount:0})
  expect(built.success,built.error).toBe(true);expect(built.transaction).toBeDefined()
  built.transaction!.sign([creator]);const signature=signedTransactionSignature(built.transaction!)
  expect((await sendAndConfirmTransaction(connection,built.transaction!,{timeoutMs:30_000,pollIntervalMs:100})).status).toBe('confirmed')
  mint=freshMint.publicKey.toBase58();creator.secretKey.fill(0)
  expect((await readTokenPosition(connection,mint,freshMint.publicKey.toBase58())).status).toBe('active')
  evidence({route:'native-pump-fixture-create',mint,signature,checks:['fresh-in-memory-creator','actual-signed-program-creation','no-live-funds']})
 },120_000)
 afterAll(()=>{
  for(const store of openStores)store.close();openStores.clear()
  for(const directory of directories){
   const target=resolve(directory)
   if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('launchpier-live-automation-'))throw new Error('Refusing to remove a directory outside this test fixture')
   rmSync(target,{recursive:true,force:true})
  }
  vi.unstubAllGlobals()
 })

 it('creates, backs up, funds, previews and arms a durable wallet, then buys twice and sells the exact tokens across restarts',async()=>{
  const f=fixture(),{capability,address}=await createBackedFunded(f),initialBalance=await connection.getBalance(new PublicKey(address))
  const plan=f.plan('buy','0',2),review=await f.service().review(capability,plan)
  expect(BigInt(review.preview.tokenAmountRaw)).toBeGreaterThan(0n);expect(BigInt(review.preview.simulatedDebitLamports)).toBeGreaterThan(10_000_000n)
  await f.service().arm(capability,review.hash,true);f.now=plan.startAt
  await new AutomationWorker(f.store,f.ports).tick();const firstExpected=BigInt(f.preparedTokenChange),first=await confirmed(f,capability)
  expect((await readTokenPosition(connection,mint,address)).tokenRaw).toBe(firstExpected.toString())
  expect(BigInt(initialBalance)-BigInt(await connection.getBalance(new PublicKey(address)))).toBe(BigInt(first.simulatedDebitLamports))
  f.restart();f.now=plan.startAt+60_001
  await new AutomationWorker(f.store,f.ports).tick();const secondExpected=BigInt(f.preparedTokenChange),second=await confirmed(f,capability)
  const holding=await readTokenPosition(connection,mint,address)
  expect(holding.tokenRaw).toBe((firstExpected+secondExpected).toString());expect(f.broadcasts).toBe(2)
  expect(f.store.read(capability).policy).toMatchObject({status:'completed',attempts:2,reservedDebitLamports:'50000000'})
  const salePlan=f.plan('sell',holding.tokenRaw),saleReview=await f.service().review(capability,salePlan)
  expect(BigInt(saleReview.preview.minimumSolOut)).toBeGreaterThan(0n)
  await f.service().arm(capability,saleReview.hash,true);f.restart();f.now=salePlan.startAt
  const beforeSale=await connection.getBalance(new PublicKey(address));await new AutomationWorker(f.store,f.ports).tick();const sale=await confirmed(f,capability)
  expect((await readTokenPosition(connection,mint,address)).tokenRaw).toBe('0');expect(await connection.getBalance(new PublicKey(address))).toBeGreaterThan(beforeSale)
  expect(f.broadcasts).toBe(3);expect(f.store.read(capability).history).toHaveLength(3)
  expect(f.store.read(capability).history.every(row=>row.status==='confirmed')).toBe(true)
  evidence({route:'durable-scheduled-native-buy-and-sell',mint,address,signatures:[first.signature,second.signature,sale.signature],exactBoughtAndSoldRaw:holding.tokenRaw,originalBroadcasts:f.broadcasts,checks:['server-created-dedicated-wallet','backup-restores-exact-address','fake-funding','actual-native-review-preview','exact-review-hash-arm','two-scheduled-native-buys','sqlite-close-and-reopen-between-trades','exact-native-sell-after-restart','signed-preview-matches-actual-buy-debit','zero-final-token-balance','confirmed-public-signature-history']})
 },180_000)

 it('recovers a lost send response after restart using the original signature and cancels all later scheduling without a second broadcast',async()=>{
  const f=fixture(),{capability,address}=await createBackedFunded(f),review=await f.service().review(capability,f.plan('buy','0',2))
  await f.service().arm(capability,review.hash,true);f.now=review.policy.plan.startAt
  let originalBroadcasts=0
  f.ports={...f.ports,send:async packet=>{originalBroadcasts++;await f.native.send(packet);throw new Error('Deliberately lost local send response')},status:async()=> 'unknown'}
  await new AutomationWorker(f.store,f.ports).tick()
  const original=f.store.read(capability).history[0];expect(original.status).toBe('pending');expect(originalBroadcasts).toBe(1)
  expect((await confirmSignatures(connection,[original.signature],{timeoutMs:30_000,pollIntervalMs:100})).status).toBe('confirmed')
  const purchased=(await readTokenPosition(connection,mint,address)).tokenRaw;expect(BigInt(purchased)).toBeGreaterThan(0n)
  f.service().cancel(capability);f.restart();f.now+=120_000
  f.ports={...f.ports,status:f.native.status}
  await new AutomationWorker(f.store,f.ports).tick();await new AutomationWorker(f.store,f.ports).tick()
  expect(f.store.read(capability).policy).toMatchObject({status:'cancelled',attempts:1})
  expect(f.store.read(capability).history).toEqual([expect.objectContaining({signature:original.signature,status:'confirmed'})])
  expect((await readTokenPosition(connection,mint,address)).tokenRaw).toBe(purchased);expect(originalBroadcasts).toBe(1)
  evidence({route:'durable-original-signature-recovery-and-cancel',mint,address,signature:original.signature,originalBroadcasts,checks:['actual-native-buy-before-lost-response','durable-pending-record','cancelled-before-next-interval','sqlite-restart','original-confirmed-signature-reconciled','no-second-broadcast','no-later-scheduled-buy']})
 },120_000)

 it('cancels during a real signed native simulation and fences the durable send before any submission',async()=>{
  const f=fixture(),{capability,address}=await createBackedFunded(f),review=await f.service().review(capability,f.plan('buy'))
  await f.service().arm(capability,review.hash,true);f.now=review.policy.plan.startAt
  const before=await connection.getBalance(new PublicKey(address));let actualSignedSimulations=0
  f.ports={...f.ports,simulate:async(tx,prepared,guard)=>{const preview=await f.native.simulate(tx,prepared,guard);actualSignedSimulations++;f.service().cancel(capability);return preview}}
  await new AutomationWorker(f.store,f.ports).tick()
  expect(actualSignedSimulations).toBe(1);expect(f.broadcasts).toBe(0);expect(f.store.pending()).toHaveLength(0)
  expect(f.store.read(capability).policy).toMatchObject({status:'cancelled',attempts:0});expect(f.store.read(capability).history).toHaveLength(0)
  expect((await readTokenPosition(connection,mint,address)).tokenRaw).toBe('0');expect(await connection.getBalance(new PublicKey(address))).toBe(before)
  evidence({route:'cancel-during-signed-native-preview',mint,address,actualSignedSimulations,broadcasts:f.broadcasts,checks:['actual-signed-same-bank-native-preview','cancel-before-durable-attempt','guard-fences-send','no-signature-record','no-token-purchase','wallet-balance-unchanged']})
 },120_000)
})
