import {afterEach,describe,it,expect,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount} from '@solana/spl-token'
import bs58 from 'bs58'
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import {prepareLaunchBundle} from '../src/lib/launchBundle/prepare'
import {executePreparedLaunchBundle} from '../src/lib/launchBundle/execute'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
import {executeBundleLaunch} from '../src/lib/bundler/api'
import {useBundlerStore} from '../src/stores/bundlerStore'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'
import {confirmSignatures} from '../src/lib/transactions/send'
import {savePending,saveConfirmed,clearPendingIfMatching} from '../src/lib/launchHistory'
import {persistBundleCheckpoint,readPendingBundleReceipt,readSavedBundleReceipt} from '../src/lib/bundler/pending'
import {createBundleWalletControlScope,type BundleControlConfig,type BundleControlLibrary} from '../src/lib/bundler/walletControls'
import {scanRelayWallet} from '../src/lib/relay/scan'
import {prepareSaleBatch,executeSaleBatch,type SaleRequest} from '../src/lib/sales/batch'
import {readSaleHistory} from '../src/lib/sales/history'
import {readTradePending,readTradeHistory} from '../src/lib/venues/tradeHistory'

const enabled=process.env.RUN_BUNDLE_RELAY_LOCALNET==='1',proofs:unknown[]=[]
afterEach(()=>vi.unstubAllGlobals())
async function setup(){
 const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint),creator=Keypair.generate(),buyers=[Keypair.generate(),Keypair.generate()],recipient=Keypair.generate(),mint=Keypair.generate(),owned=new Set([creator,...buyers,recipient].map(key=>key.publicKey.toBase58())),realFetch=globalThis.fetch
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool may execute these tests.')
 let verified=false,sends=0
 const guarded:typeof fetch=async(resource,init)=>{
  if(new URL(String(resource)).origin!==url.origin)throw new Error('This fake-SOL test rejects every external request.')
  const call=JSON.parse(String(init?.body))
  if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
   if(!verified)throw new Error('Verify the fake runtime before any local mutation.')
   const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((raw:string)=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')).message.staticAccountKeys[0].toBase58())
   if(payers.some((payer:string)=>!owned.has(payer)))throw new Error('Only freshly generated fake-funded wallets may spend.')
   if(call.method!=='requestAirdrop')sends++
  }
  if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared simulator mutation is forbidden.')
  // Surfpool lazily fetches protocol accounts. Read every public packet account
  // before its bank snapshot, just as the existing inline acceptance harness does.
  if(call.method==='simulateBundle'){
   const keys=[...new Set((call.params[0].encodedTransactions as string[]).flatMap(raw=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')).message.staticAccountKeys.map(key=>key.toBase58())))]
   for(let index=0;index<keys.length;index+=100){const warm=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[keys.slice(index,index+100),{encoding:'base64',commitment:'confirmed'}]}),redirect:'error',signal:AbortSignal.timeout(30000)});const value=await warm.json();if(value.error)throw new Error('Local protocol account hydration failed.')}
  }
  const response=await realFetch(resource,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30000)})
  if(call.method==='simulateBundle'&&process.env.VANITY_BUNDLE_RELAY_DEBUG==='1'){
   const value=await response.clone().json()
   if(value.error||value.result?.value?.summary!=='succeeded')console.info('Local simulation diagnostic',JSON.stringify({error:value.error,summary:value.result?.value?.summary,transactions:value.result?.value?.transactionResults?.map((result:{err:unknown;logs?:string[]})=>({err:result.err,logs:result.logs?.slice(-8)}))}))
  }
  return response
 }
 vi.stubGlobal('fetch',guarded)
 const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guarded,disableRetryOnRateLimit:true}),version=await connection.getVersion() as unknown as Record<string,unknown>
 expect(version['surfnet-version']).toBe('1.6.1');expect(await connection.getGenesisHash()).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
 const startup=await guarded(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'surfnet_getSurfnetInfo',params:[]})});expect((await startup.json()).result.value.startup.phase).toBe('ready');verified=true
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
 vi.stubGlobal('localStorage',storage)
 for(const key of [creator,...buyers]){const signature=await connection.requestAirdrop(key.publicKey,1_000_000_000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:100})).status).toBe('confirmed')}
 return{connection,endpoint,creator,buyers,recipient,mint,storage,values,sends:()=>sends}
}
async function balance(connection:Connection,mint:PublicKey,owner:PublicKey){const address=getAssociatedTokenAddressSync(mint,owner,false,TOKEN_2022_PROGRAM_ID),info=await connection.getAccountInfo(address,'confirmed');return info?unpackAccount(address,info,TOKEN_2022_PROGRAM_ID).amount:0n}
async function verifyScopedWalletSales(h:Awaited<ReturnType<typeof setup>>){
 const entries=[['creator',h.creator],['buyer-0',h.buyers[0]],['buyer-1',h.buyers[1]],['recipient',h.recipient]] as const,keys=new Map<string,Keypair>(entries)
 const library:BundleControlLibrary={revision:1,storageUnavailable:false,wallets:entries.map(([id,key])=>({id,name:id,publicKey:key.publicKey.toBase58(),createdAt:new Date().toISOString()})),groups:[{id:'qa-group',walletIds:['creator','buyer-0','buyer-1']}],unlockedIds:entries.map(([id])=>id),getKeypair:id=>keys.get(id)??null}
 const config:BundleControlConfig={creatorPublicKey:h.creator.publicKey.toBase58(),creatorPrivateKey:'',managedGroupId:'qa-group',managedCreatorWalletId:'creator',bundleWallets:h.buyers.map((key,index)=>({id:index,libraryWalletId:`buyer-${index}`,publicKey:key.publicKey.toBase58(),privateKey:'',isValid:true,buyAmount:.01,transferTo:index===0?h.buyers[1].publicKey.toBase58():h.recipient.publicKey.toBase58()}))}
 const current=createBundleWalletControlScope(()=>config,()=>library)
 expect(current.wallets.map(wallet=>wallet.id)).toEqual(['creator','buyer-0','buyer-1','recipient']);expect(current.readOnlyIds).toEqual([])
 // Model a refresh: session config is gone; only the public receipt and exact
 // imported library actors can restore signing controls.
 const cold:BundleControlConfig={creatorPublicKey:null,creatorPrivateKey:'',bundleWallets:[],result:readSavedBundleReceipt(h.storage)},scope=createBundleWalletControlScope(()=>cold,()=>library)
 expect(scope.wallets.map(wallet=>wallet.id)).toEqual(['creator','buyer-0','buyer-1','recipient']);expect(scope.readOnlyIds).toEqual([])
 for(const wallet of scope.wallets)expect(scope.getKeypair(wallet.id)).toBe(keys.get(wallet.id))
 const funding=await h.connection.requestAirdrop(h.recipient.publicKey,20_000_000);expect((await confirmSignatures(h.connection,[funding],{timeoutMs:10000,pollIntervalMs:100})).status).toBe('confirmed')
 let lockHeld=false
 const locks={request:async<T,>(name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>{expect(name).toBe('vanity-launch-submission');expect(lockHeld).toBe(false);lockHeld=true;try{return await callback({})}finally{lockHeld=false}}}
 const requests=async(ids:string[])=>{const rows:SaleRequest[]=[];for(const id of ids){const wallet=scope.resolveWallet(id);expect(wallet).not.toBeNull();const scan=await scanRelayWallet(h.connection,wallet!.publicKey);for(const asset of scan.assets.filter(asset=>asset.saleEligible&&BigInt(asset.amountRaw)>0n))rows.push({walletId:id,walletName:wallet!.name,payer:wallet!.publicKey,mint:asset.mint,tokenProgram:asset.tokenProgram,amountRaw:asset.amountRaw,decimals:asset.decimals})}return rows}
 const execute=async(ids:string[],expectedRows:number)=>{
  const rows=await requests(ids);expect(rows).toHaveLength(expectedRows)
  const before=new Map(await Promise.all(rows.map(async row=>[row.walletId,await h.connection.getBalance(new PublicKey(row.payer))] as const)))
  const review=await prepareSaleBatch(h.connection,rows,{slippageBps:500,priorityFeeLamports:'100000'},{storage:h.storage,locks,assertAvailable:()=>scope.assertCurrent()});expect(review.rows.every(row=>row.status==='ready'),JSON.stringify(review.rows.map(row=>row.error))).toBe(true)
  const signedMinima=new Map<string,string>()
  const result=await executeSaleBatch(h.connection,review,{approved:true,readSigner:id=>scope.getKeypair(id)?.publicKey.toBase58(),assertAvailable:()=>scope.assertCurrent(),sign:async(id,transaction)=>{expect(lockHeld).toBe(true);const key=scope.getKeypair(id);expect(key).not.toBeNull();const sale=transaction.message.compiledInstructions.find(ix=>transaction.message.staticAccountKeys[ix.programIdIndex].equals(PUMP_PROGRAM_ID)&&Buffer.from(ix.data).subarray(0,8).equals(Buffer.from([51,230,133,164,1,127,131,173])))!;const minimum=Buffer.from(sale.data).readBigUInt64LE(16);expect(minimum).toBeGreaterThanOrEqual(BigInt(review.rows.find(row=>row.walletId===id)!.minimumSolOut!));signedMinima.set(id,minimum.toString());transaction.sign([key!]);return transaction}},{storage:h.storage,locks,assertAvailable:()=>scope.assertCurrent()})
  expect(result.status,result.error).toBe('completed');expect(result.rows.every(row=>row.status==='confirmed')).toBe(true)
  const evidence=[]
  for(const row of result.rows){expect(await balance(h.connection,new PublicKey(row.mint),new PublicKey(row.payer))).toBe(0n);const after=await h.connection.getBalance(new PublicKey(row.payer));expect(after).toBeGreaterThan(before.get(row.walletId)!);expect(readTradeHistory(h.storage).some(receipt=>receipt.signature===row.signature&&receipt.maxSellRaw===row.amountRaw&&receipt.status==='confirmed')).toBe(true);evidence.push({walletId:row.walletId,payer:row.payer,amountRaw:row.amountRaw,signature:row.signature,reviewedMinimumSolOut:row.minimumSolOut,signedMinimumSolOut:signedMinima.get(row.walletId),netSolProceedsLamports:String(after-before.get(row.walletId)!)})}
  expect(readTradePending(h.storage)).toBeNull();expect(readSaleHistory(h.storage).find(receipt=>receipt.id===result.id)).toEqual(result)
  return {status:result.status,rows:evidence}
 }
 const perWallet=await execute(['buyer-1'],1),allRemaining=await execute(scope.wallets.map(wallet=>wallet.id),2)
 for(const wallet of scope.wallets)expect(await balance(h.connection,h.mint.publicKey,new PublicKey(wallet.publicKey))).toBe(0n)
 expect(JSON.stringify([...h.values.values()])).not.toMatch(/privateKey|secretKey|encodedTransactions/)
 return {perWallet,allRemaining}
}
describe.skipIf(!enabled)('bundle buyer Relay with guarded fake SOL',()=>{
 for(const surface of ['inline','standalone'] as const)for(const mode of ['block0','manual','organic'] as const){
  it(`${surface} ${mode}: exact purchases reach recipients while incoming holdings remain in the second buyer`,async()=>{
   const h=await setup(),payer=h.creator.publicKey.toBase58(),addresses=[h.creator,...h.buyers,h.recipient],before=await Promise.all(addresses.map(key=>h.connection.getBalance(key.publicKey,'confirmed')))
   const rows=h.buyers.map((key,index)=>({walletId:`buyer-${index}`,publicKey:key.publicKey.toBase58(),name:`Buyer ${index+1}`,buySol:.01,delaySeconds:0,transferTo:index===0?h.buyers[1].publicKey.toBase58():h.recipient.publicKey.toBase58()}))
   let result:Awaited<ReturnType<typeof executeBundleLaunch>>
   if(surface==='inline'){
    const keys=new Map(rows.map((row,index)=>[row.walletId,h.buyers[index]])),guards={readSigner:()=>payer,readBuyer:(id:string)=>keys.get(id)??null}
    const prepared=await prepareLaunchBundle(h.connection,{payer,mintKeypair:h.mint,metadata:{name:'OutSol Bundle Relay',symbol:'OBR',uri:'https://example.com/outsol-bundle-relay.json'},devBuySol:.01,slippage:5,priorityFeeSol:.0001,jitoTipSol:.00001,settings:{...DEFAULT_LAUNCH_BUNDLE_SETTINGS,groupId:'qa-group',mode,wallets:rows,intervalMinSeconds:0,intervalMaxSeconds:0}},guards,{simulate:async(connection,packets,options)=>{const accounts=[...new Map(packets.flatMap(packet=>packet.message.staticAccountKeys).map(key=>[key.toBase58(),key])).values()];for(let index=0;index<accounts.length;index+=100)await connection.getMultipleAccountsInfo(accounts.slice(index,index+100));return simulateAtomicBundle(connection,packets,options)},sendBundle:(connection,packets,options)=>submitAtomicBundle(connection,packets,{...options,endpoint:h.endpoint})})
    result=await executePreparedLaunchBundle(prepared,{...guards,approved:true,signCreator:async packets=>{packets.forEach(packet=>packet.sign([h.creator]));return packets},onInitialBroadcast:savePending,onInitialConfirmed:pending=>{saveConfirmed(pending)},onInitialNotSubmitted:clearPendingIfMatching,onReceipt:receipt=>persistBundleCheckpoint(receipt)})
   }else{
    const state=useBundlerStore.getState(),config={...state,tokenName:'OutSol Bundle Relay',tokenSymbol:'OBR',tokenImage:new Blob(['local QA']) as File,creatorPrivateKey:bs58.encode(h.creator.secretKey),creatorPublicKey:payer,devBuyAmount:.01,creatorFeeSelection:{kind:'deployer' as const},mintMode:'import' as const,importedMintKey:bs58.encode(h.mint.secretKey),sniperMode:mode==='block0'?'block0' as const:'after_confirm' as const,bundleMode:mode==='organic'?'natural' as const:'sniper' as const,naturalDelayMin:0,naturalDelayMax:0,jitoTip:.00001,autoSellEnabled:false,bundleWallets:rows.map((row,index)=>({...state.bundleWallets[index],privateKey:bs58.encode(h.buyers[index].secretKey),publicKey:row.publicKey,buyAmount:.01,mode:'sniper' as const,delaySeconds:0,sellEnabled:false,transferTo:row.transferTo}))}
    result=await executeBundleLaunch(config,()=>{},{connection:h.connection,metadataUri:'https://example.com/outsol-bundle-relay.json',bundleEndpoint:h.endpoint,onReceipt:receipt=>persistBundleCheckpoint(receipt)})
   }
   expect(result.success,result.error).toBe(true);expect(result.status,result.error).toBe('confirmed');expect(result.tokenTransfers).toHaveLength(2);expect(readPendingBundleReceipt(h.storage)).toBeNull();expect(readSavedBundleReceipt(h.storage)?.tokenTransfers).toEqual(result.tokenTransfers)
   const amounts=await Promise.all(addresses.map(key=>balance(h.connection,h.mint.publicKey,key.publicKey))),after=await Promise.all(addresses.map(key=>h.connection.getBalance(key.publicKey,'confirmed'))),transfers=result.tokenTransfers!
   expect(amounts[0]).toBeGreaterThan(0n);expect(amounts[1]).toBe(0n);expect(amounts[2]).toBe(BigInt(transfers[0].rawAmount));expect(amounts[3]).toBe(BigInt(transfers[1].rawAmount));expect(after[3]).toBe(before[3]);expect(after[3]).toBe(0)
   const statuses=await h.connection.getSignatureStatuses(result.submittedSignatures!,{searchTransactionHistory:true});expect(statuses.value.every(status=>status&&!status.err&&['confirmed','finalized'].includes(status.confirmationStatus!))).toBe(true)
   expect(result.submissions).toHaveLength(result.submittedSignatures!.length)
   for(const submission of result.submissions!){const packet=await h.connection.getTransaction(submission.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});expect(packet?.transaction.message.staticAccountKeys[0].toBase58()).toBe(submission.payer);expect(packet?.transaction.message.recentBlockhash).toBe(submission.blockhash);expect(submission.expiresAfterBlockHeight).toBeGreaterThan(0)}
   expect(JSON.stringify([...h.values.values()])).not.toMatch(/privateKey|secretKey|encodedTransactions/)
   const sales=surface==='standalone'&&mode==='block0'?await verifyScopedWalletSales(h):undefined
   proofs.push({surface,mode,mint:h.mint.publicKey.toBase58(),signatures:result.submittedSignatures,transfers,balancesRaw:amounts.map(String),sourceSolDebitsLamports:before.map((value,index)=>String(BigInt(value)-BigInt(after[index]))),sales,sends:h.sends(),realSolSpent:false})
   if(process.env.VANITY_BUNDLE_RELAY_PROOF_FILE)writeFileSync(process.env.VANITY_BUNDLE_RELAY_PROOF_FILE,JSON.stringify(proofs,null,2))
  },120000)
 }
})
