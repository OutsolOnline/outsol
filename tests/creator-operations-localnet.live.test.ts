import {afterEach,describe,expect,it,vi} from 'vitest'
import {appendFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {OnlinePumpSdk,PUMP_SDK} from '@pump-fun/pump-sdk'
import {TransactionMessage} from '@solana/web3.js'
import {buildCreateTransaction,buildNativeBuyTransaction} from '../src/lib/pumpfun/api'
import {prepareCreatorOperation,submitCreatorOperation} from '../src/lib/creatorOperations/engine'
import {inspectCreatorState} from '../src/lib/creatorOperations/inspect'
import {CreatorLookupRequired} from '../src/lib/creatorOperations/native'
import {simulateCreatorOperation} from '../src/lib/creatorOperations/simulation'
import {readCreatorOperationHistory,readPendingCreatorOperation} from '../src/lib/creatorOperations/history'
import {reconcilePendingCreatorOperation} from '../src/lib/creatorOperations/recovery'
import {sendAndConfirmTransaction,confirmSignatures} from '../src/lib/transactions/send'

const endpoint='http://127.0.0.1:8899',generated=new Set<string>(),realFetch=globalThis.fetch
async function proveRuntime(){const url=new URL(endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Only the isolated loopback runtime is allowed.');const response=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getVersion',params:[]}),redirect:'error',signal:AbortSignal.timeout(10000)}),body=await response.json();if(!response.ok||body.error||body.result?.['surfnet-version']!=='1.6.1')throw new Error('The isolated Surfpool1.6.1 runtime was not proven.')}
const safeFetch:typeof fetch=async(resource,options)=>{
 const url=new URL(typeof resource==='string'||resource instanceof URL?String(resource):resource.url)
 if(url.origin!==endpoint||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Creator acceptance rejects non-loopback requests.')
 const call=JSON.parse(String(options?.body));if(!/^(get[A-Z]|isBlockhashValid$|simulateTransaction$|simulateBundle$|sendTransaction$|requestAirdrop$)/.test(String(call.method)))throw new Error('Creator acceptance rejects runtime control and unknown RPC methods.')
 if(call.method==='requestAirdrop'||call.method==='sendTransaction'){await proveRuntime();const payer=call.method==='requestAirdrop'?call.params[0]:VersionedTransaction.deserialize(Buffer.from(call.params[0],'base64')).message.staticAccountKeys[0].toBase58();if(!generated.has(payer))throw new Error('Only fresh generated test payers may spend simulated SOL.')}
 return realFetch(resource,{...options,redirect:'error',signal:options?.signal??AbortSignal.timeout(20000)})
}
const connection=new Connection(endpoint,{commitment:'confirmed',fetch:safeFetch,disableRetryOnRateLimit:true}),locks={request:async<T>(_name:string,_options:{ifAvailable:true},fn:(lock:object)=>Promise<T>)=>fn({})}
function memory(){const disk=new Map<string,string>();return{getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)},publicSnapshot:()=>Object.fromEntries(disk)}}
function evidence(value:Record<string,unknown>){appendFileSync('work/creator-operations-localnet-proof.jsonl',JSON.stringify({timestamp:new Date().toISOString(),runtime:'Surfpool1.6.1',realSolSpent:false,...value})+'\n')}
async function fund(lamports=10000000000){await proveRuntime();const key=Keypair.generate();generated.add(key.publicKey.toBase58());const signature=await connection.requestAirdrop(key.publicKey,lamports);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:50})).status).toBe('confirmed');return key}
async function send(tx:VersionedTransaction,payer:Keypair){tx.sign([payer]);const receipt=await sendAndConfirmTransaction(connection,tx,{timeoutMs:10000,pollIntervalMs:50});expect(receipt.status,receipt.error).toBe('confirmed');return receipt.signature}
async function create(payer:Keypair){
 const mint=Keypair.generate(),built=await buildCreateTransaction({connection,userPublicKey:payer.publicKey.toBase58(),mintKeypair:mint,metadata:{name:'Disposable creator proof',symbol:'CPROOF',description:'Fake local-fund acceptance'},metadataUri:'https://example.com/local-creator.json',initialBuyAmount:.1,priorityFee:0})
 if(!built.success||!built.transaction||built.requiresAtomicBundle)throw new Error(built.error||'The bounded native test creation did not fit one packet.')
 await send(built.transaction,payer);return mint.publicKey
}
async function buy(mint:PublicKey,payer:Keypair,sol=2){await send(await buildNativeBuyTransaction({connection,userPublicKey:payer.publicKey.toBase58(),mintAddress:mint.toBase58(),maxBuyAmountSol:sol,slippage:5,priorityFee:0}),payer)}
afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_CREATOR_OPERATIONS_LOCALNET!=='1')('native creator operations on proven isolated Surfpool',()=>{
 it('creates, accrues and collects real native fees, then permanently finalizes and distributes supported fee shares',async()=>{
  vi.stubGlobal('fetch',safeFetch);const creator=await fund(),buyer=await fund(),first=await fund(10000000),second=await fund(10000000),mint=await create(creator),storage=memory(),payer=creator.publicKey.toBase58(),guards={readSigner:()=>payer},options={storage,locks},base={version:1 as const,mint:mint.toBase58(),payer,priorityFeeLamports:'0'}
  await buy(mint,buyer)
  const before=await inspectCreatorState(connection,mint.toBase58());expect(BigInt(before.vaultBalanceLamports)).toBeGreaterThan(0n)
  const collect=await prepareCreatorOperation(connection,{...base,kind:'collect'},guards,options)
  expect(collect.intent.scope).toBe('wallet-wide')
  const collected=await submitCreatorOperation(connection,collect,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},options)
  expect(collected.status,collected.error).toBe('confirmed');expect(readPendingCreatorOperation(storage)).toBeNull();expect((await new OnlinePumpSdk(connection).getCreatorVaultBalanceBothPrograms(creator.publicKey)).toString()).toBe('0')
  const shares=[{address:first.publicKey.toBase58(),shareBps:5000},{address:second.publicKey.toBase58(),shareBps:5000}],setup=await prepareCreatorOperation(connection,{...base,kind:'shares',shares},guards,options),configured=await submitCreatorOperation(connection,setup,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},options)
  expect(configured.status,configured.error).toBe('confirmed');expect((await inspectCreatorState(connection,mint.toBase58())).sharing?.shareholders).toEqual(shares)
  await buy(mint,buyer)
  const firstBefore=await connection.getBalance(first.publicKey),secondBefore=await connection.getBalance(second.publicKey),distribution=await prepareCreatorOperation(connection,{...base,kind:'distribute'},guards,options),distributed=await submitCreatorOperation(connection,distribution,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},options)
  expect(distributed.status,distributed.error).toBe('confirmed');expect(await connection.getBalance(first.publicKey)).toBeGreaterThan(firstBefore);expect(await connection.getBalance(second.publicKey)).toBeGreaterThan(secondBefore)
  const changed=[{address:first.publicKey.toBase58(),shareBps:7000},{address:second.publicKey.toBase58(),shareBps:3000}]
  await expect(prepareCreatorOperation(connection,{...base,kind:'shares',shares:changed},guards,options)).rejects.toThrow(/immutable/i)
  expect((await inspectCreatorState(connection,mint.toBase58())).sharing?.adminRevoked).toBe(true);expect(readCreatorOperationHistory(storage)).toHaveLength(3)
  evidence({proof:'native-create-accrue-collect-finalize-distribute',mint:mint.toBase58(),payer,recipients:shares,receipts:readCreatorOperationHistory(storage),browserStorage:storage.publicSnapshot()})
  console.log(JSON.stringify({proof:'signed-local-surfpool-creator-operations',realSolSpent:false,mint:mint.toBase58(),collect:collected.signature,setup:configured.signature,distribute:distributed.signature,checks:['native-Pump-create','actual-fee-accrual','wallet-wide-collection','permanent-share-finalization','native-distribution','later-edit-rejected']}))
 },90000)
 it('preserves a real submitted claim as unknown and recovers its exact original without another broadcast',async()=>{
  vi.stubGlobal('fetch',safeFetch);const creator=await fund(),buyer=await fund(),mint=await create(creator);await buy(mint,buyer)
  const storage=memory(),payer=creator.publicKey.toBase58(),guards={readSigner:()=>payer},base={version:1,kind:'collect',mint:mint.toBase58(),payer,priorityFeeLamports:'0'},review=await prepareCreatorOperation(connection,base,guards,{storage,locks});let sends=0
  const result=await submitCreatorOperation(connection,review,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},{storage,locks,send:async(conn,tx,options)=>{sends++;const receipt=await sendAndConfirmTransaction(conn,tx,{...options,timeoutMs:10000,pollIntervalMs:50});expect(receipt.status,receipt.error).toBe('confirmed');return{...receipt,status:'unknown'}}})
  expect(result.status).toBe('unknown');expect(readPendingCreatorOperation(storage)?.signature).toBe(result.signature)
  await expect(prepareCreatorOperation(connection,base,guards,{storage,locks})).rejects.toThrow(/pending/i)
  expect((await reconcilePendingCreatorOperation(connection,{storage,locks})).status).toBe('confirmed');expect(sends).toBe(1);expect(readPendingCreatorOperation(storage)).toBeNull()
  evidence({proof:'original-claim-recovered-with-one-broadcast',mint:mint.toBase58(),payer,signature:result.signature,broadcasts:sends,receipts:readCreatorOperationHistory(storage),browserStorage:storage.publicSnapshot()})
 },90000)
 it('separately reviews real lookup setup and permanently finalizes all ten exact fee recipients',async()=>{
  vi.stubGlobal('fetch',safeFetch);const creator=await fund(),mint=await create(creator),storage=memory(),payer=creator.publicKey.toBase58(),guards={readSigner:()=>payer},options={storage,locks},base={version:1 as const,mint:mint.toBase58(),payer,priorityFeeLamports:'0'},shares=Array.from({length:10},()=>({address:Keypair.generate().publicKey.toBase58(),shareBps:1000}));let addresses:string[]=[]
  try{const simple=await prepareCreatorOperation(connection,{...base,kind:'shares',shares},guards,options);addresses=simple.transaction.message.staticAccountKeys.filter(key=>key.toBase58()!==payer).slice(0,20).map(key=>key.toBase58())}catch(error){if(!(error instanceof CreatorLookupRequired))throw error;addresses=error.addresses}
  expect(addresses.length).toBeGreaterThan(0)
  const setup=await prepareCreatorOperation(connection,{...base,kind:'lookup',addresses},guards,options),lookup=await submitCreatorOperation(connection,setup,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},options)
  expect(lookup.status,lookup.error).toBe('confirmed')
  const table=(await connection.getAddressLookupTable(new PublicKey(setup.intent.lookupAddress!))).value!;let slot=await connection.getSlot('confirmed'),tries=0
  while(slot<=table.state.lastExtendedSlot&&tries++<100){await new Promise(resolve=>setTimeout(resolve,25));slot=await connection.getSlot('confirmed')}
  const review=await prepareCreatorOperation(connection,{...base,kind:'shares',shares,lookupTable:setup.intent.lookupAddress},guards,options),result=await submitCreatorOperation(connection,review,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},options)
  expect(result.status,result.error).toBe('confirmed');expect((await inspectCreatorState(connection,mint.toBase58())).sharing).toMatchObject({adminRevoked:true,shareholders:shares});expect(readCreatorOperationHistory(storage)).toHaveLength(2)
  evidence({proof:'reviewed-lookup-and-ten-final-recipients',mint:mint.toBase58(),payer,recipients:shares,lookupTable:setup.intent.lookupAddress,receipts:readCreatorOperationHistory(storage),browserStorage:storage.publicSnapshot()})
 },90000)
 it('finalizes an imported existing unrevoked configuration exactly once',async()=>{
  vi.stubGlobal('fetch',safeFetch);const creator=await fund(),mint=await create(creator),storage=memory(),payer=creator.publicKey.toBase58(),guards={readSigner:()=>payer},recipient=Keypair.generate().publicKey.toBase58(),latest=await connection.getLatestBlockhash('confirmed')
  const instruction=await PUMP_SDK.createFeeSharingConfig({creator:creator.publicKey,mint,pool:null}),transaction=new VersionedTransaction(new TransactionMessage({payerKey:creator.publicKey,recentBlockhash:latest.blockhash,instructions:[instruction]}).compileToV0Message());await send(transaction,creator)
  expect((await inspectCreatorState(connection,mint.toBase58())).sharing?.adminRevoked).toBe(false)
  const input={version:1,kind:'shares',mint:mint.toBase58(),payer,priorityFeeLamports:'0',shares:[{address:recipient,shareBps:10000}]},review=await prepareCreatorOperation(connection,input,guards,{storage,locks}),result=await submitCreatorOperation(connection,review,{...guards,approved:true,signTransaction:async tx=>{tx.sign([creator]);return tx}},{storage,locks})
  expect(result.status,result.error).toBe('confirmed');expect((await inspectCreatorState(connection,mint.toBase58())).sharing).toMatchObject({adminRevoked:true,shareholders:input.shares})
  evidence({proof:'existing-unrevoked-configuration-finalized',mint:mint.toBase58(),payer,recipients:input.shares,receipts:readCreatorOperationHistory(storage),browserStorage:storage.publicSnapshot()})
 },90000)
})
