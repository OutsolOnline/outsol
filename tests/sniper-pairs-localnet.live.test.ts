import {afterEach,describe,it,expect,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount} from '@solana/spl-token'
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import bs58 from 'bs58'
import {executeBundleLaunch} from '../src/lib/bundler/api'
import {useBundlerStore} from '../src/stores/bundlerStore'
import {createManagedBundleSource} from '../src/lib/bundler/managedSource'
import {createSniperPairScope,mapSniperPairsToBundle} from '../src/lib/sniperPairs/launch'
import {createSniperPairPolicy} from '../src/lib/sniperPairs/operations'
import {resolveSniperPairs,type SniperPair} from '../src/lib/sniperPairs/catalog'
import {buildSniperSessionBackup,parseSniperSessionBackup} from '../src/lib/sniperPairs/sessionBackup'
import type {BundleControlLibrary} from '../src/lib/bundler/walletControls'
import {confirmSignatures} from '../src/lib/transactions/send'
import {persistBundleCheckpoint,readPendingBundleReceipt} from '../src/lib/bundler/pending'
import {scanRelayWallet} from '../src/lib/relay/scan'
import {prepareSaleBatch,executeSaleBatch,type SaleRequest} from '../src/lib/sales/batch'
import {readTradePending,readTradeHistory} from '../src/lib/venues/tradeHistory'

const enabled=process.env.RUN_SNIPER_PAIRS_LOCALNET==='1'
afterEach(()=>vi.unstubAllGlobals())
async function setup(){
 const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint)
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool may execute this test.')
 const creator=Keypair.generate(),snipers=[Keypair.generate(),Keypair.generate()],receivers=[Keypair.generate(),Keypair.generate()],mint=Keypair.generate(),fresh=[...snipers.flatMap((key,index)=>[key,receivers[index]]),creator],owned=new Set(fresh.map(key=>key.publicKey.toBase58())),realFetch=globalThis.fetch,sent:{signature?:string;payer:string}[]=[]
 let verified=false
 const guarded:typeof fetch=async(resource,init)=>{
  if(new URL(String(resource)).origin!==url.origin)throw new Error('This simulated-funds test refuses every external request.')
  const call=JSON.parse(String(init?.body))
  if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
   if(!verified)throw new Error('Verify the fake runtime before any local mutation.')
   const packets=call.method==='requestAirdrop'?[]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((raw:string)=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')))
   const payers=call.method==='requestAirdrop'?[call.params[0]]:packets.map((packet:VersionedTransaction)=>packet.message.staticAccountKeys[0].toBase58())
   if(payers.some((payer:string)=>!owned.has(payer)))throw new Error('Only freshly generated, fake-funded wallets may spend.')
   if(call.method!=='requestAirdrop')for(const packet of packets)sent.push({payer:packet.message.staticAccountKeys[0].toBase58(),signature:bs58.encode(packet.signatures[0])})
  }
  if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared simulator mutation is forbidden.')
  if(call.method==='simulateBundle'){
   const keys=[...new Set((call.params[0].encodedTransactions as string[]).flatMap(raw=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')).message.staticAccountKeys.map(key=>key.toBase58())))]
   for(let index=0;index<keys.length;index+=100){const warm=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[keys.slice(index,index+100),{encoding:'base64',commitment:'confirmed'}]}),redirect:'error',signal:AbortSignal.timeout(30000)});if((await warm.json()).error)throw new Error('Local protocol-account hydration failed.')}
  }
  return realFetch(resource,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30000)})
 }
 vi.stubGlobal('fetch',guarded)
 const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guarded,disableRetryOnRateLimit:true}),version=await connection.getVersion() as unknown as Record<string,unknown>
 expect(version['surfnet-version']).toBe('1.6.1');expect(await connection.getGenesisHash()).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
 const startup=await guarded(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'surfnet_getSurfnetInfo',params:[]})});expect((await startup.json()).result.value.startup.phase).toBe('ready');verified=true
 const data=new Map<string,string>(),storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}
 vi.stubGlobal('localStorage',storage)
 for(const key of fresh){const signature=await connection.requestAirdrop(key.publicKey,1_000_000_000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:100})).status).toBe('confirmed')}
 return{connection,endpoint,creator,snipers,receivers,mint,fresh,storage,data,sent}
}
async function tokenBalance(connection:Connection,mint:PublicKey,owner:PublicKey){const address=getAssociatedTokenAddressSync(mint,owner,false,TOKEN_2022_PROGRAM_ID),info=await connection.getAccountInfo(address,'confirmed');return info?unpackAccount(address,info,TOKEN_2022_PROGRAM_ID).amount:0n}

describe.skipIf(!enabled)('reusable sniper pairs with guarded simulated SOL',()=>{
 it('restores all session roles, forwards independent buys, then sells one and all remaining receivers without spending from snipers or deployer',async()=>{
  const h=await setup(),now=new Date().toISOString(),names=['A Sniper','A Token Receiver','B Sniper','B Token Receiver','Separate deployer'],originalWallets=h.fresh.map((key,index)=>({id:`original-${index}`,name:names[index],publicKey:key.publicKey.toBase58(),createdAt:now})),records:SniperPair[]=[0,1].map(index=>({id:`pair-${index}`,name:index===0?'A':'B',sniperWalletId:originalWallets[index*2].id,sniperAddress:originalWallets[index*2].publicKey,receiverWalletId:originalWallets[index*2+1].id,receiverAddress:originalWallets[index*2+1].publicKey,createdAt:now}))
  const originalKeys=new Map(originalWallets.map((wallet,index)=>[wallet.id,h.fresh[index]])),backup=buildSniperSessionBackup({name:'Independent pairs QA',pairs:resolveSniperPairs(records,originalWallets),deployer:originalWallets[4],readKeypair:id=>originalKeys.get(id)??null}),restored=parseSniperSessionBackup(backup.content)
  expect(restored.pairs).toHaveLength(2);expect(restored.wallets).toHaveLength(5)
  const keys=new Map<string,Keypair>(),wallets=restored.wallets.map((wallet,index)=>{const id=`restored-${index}`,key=Keypair.fromSecretKey(bs58.decode(wallet.privateKey));keys.set(id,key);return{id,name:wallet.name,publicKey:wallet.publicKey,createdAt:now}}),deployer=wallets.find(wallet=>wallet.publicKey===restored.deployerAddress)!,pairs=resolveSniperPairs(records,wallets)
  expect(pairs.every(pair=>pair.sniper.id!==pair.sniperWalletId&&pair.receiver.id!==pair.receiverWalletId)).toBe(true)
  const group={id:'pair-sources',name:'Pair sources',createdAt:now,updatedAt:now,walletIds:[deployer.id,...pairs.map(pair=>pair.sniper.id)]},library:BundleControlLibrary&{groups:(typeof group)[]}={revision:1,storageUnavailable:false,wallets,groups:[group],unlockedIds:wallets.map(wallet=>wallet.id),getKeypair:id=>keys.get(id)??null},scope=createSniperPairScope(()=>records,()=>library),policy=createSniperPairPolicy(pairs,scope)
  expect(scope.wallets.some(wallet=>wallet.publicKey===deployer.publicKey)).toBe(false)
  expect(policy.receivers().map(wallet=>wallet.publicKey)).toEqual(h.receivers.map(key=>key.publicKey.toBase58()))
  expect(()=>policy.assertSaleRows([{walletId:pairs[0].sniper.id,payer:pairs[0].sniper.publicKey}])).toThrow(/receiver/i)
  const state=useBundlerStore.getState(),mapped=mapSniperPairsToBundle(state.bundleWallets,pairs,deployer).map(row=>row.libraryWalletId?{...row,buyAmount:.01,mode:'sniper' as const,delaySeconds:0}:row),creatorKey=keys.get(deployer.id)!,signers=createManagedBundleSource(()=>library,group.id,deployer.id,mapped.filter(row=>row.buyAmount>0).map(row=>({id:row.id,libraryWalletId:row.libraryWalletId!,publicKey:row.publicKey}))),before=await Promise.all(h.fresh.map(key=>h.connection.getBalance(key.publicKey)))
  const config={...state,tokenName:'OutSol Independent Pairs',tokenSymbol:'PAIR',tokenImage:new Blob(['local pair QA']) as File,creatorPrivateKey:'',creatorPublicKey:deployer.publicKey,managedGroupId:group.id,managedCreatorWalletId:deployer.id,devBuyAmount:.01,creatorFeeSelection:{kind:'deployer' as const},mintMode:'import' as const,importedMintKey:bs58.encode(h.mint.secretKey),sniperMode:'after_confirm' as const,bundleMode:'sniper' as const,slippage:5,jitoTip:.00001,autoSellEnabled:false,bundleWallets:mapped}
  const launched=await executeBundleLaunch(config,()=>{},{connection:h.connection,metadataUri:'https://example.com/outsol-independent-pairs.json',bundleEndpoint:h.endpoint,resolveSigners:signers,onReceipt:receipt=>persistBundleCheckpoint(receipt)})
  expect(launched.success,launched.error).toBe(true);expect(launched.status,launched.error).toBe('confirmed');expect(launched.tokenTransfers).toHaveLength(2);expect(readPendingBundleReceipt(h.storage)).toBeNull()
  const launchTokenBalances=await Promise.all(h.fresh.map(key=>tokenBalance(h.connection,h.mint.publicKey,key.publicKey))),launchSolBalances=await Promise.all(h.fresh.map(key=>h.connection.getBalance(key.publicKey)))
  expect(launchTokenBalances[0]).toBe(0n);expect(launchTokenBalances[2]).toBe(0n);expect(launchTokenBalances[4]).toBeGreaterThan(0n)
  for(const [index,pair] of pairs.entries()){const transfer=launched.tokenTransfers!.find(row=>row.payer===pair.sniper.publicKey)!;expect(transfer.recipient).toBe(pair.receiver.publicKey);expect(launchTokenBalances[index*2+1]).toBe(BigInt(transfer.rawAmount));expect(launchSolBalances[index*2+1]).toBe(before[index*2+1]);expect(before[index*2]-launchSolBalances[index*2]).toBeGreaterThan(0);expect(before[index*2]-launchSolBalances[index*2]).toBeLessThanOrEqual(15_000_000)}
  const transactionDebits=new Map<string,bigint>()
  for(const signature of launched.submittedSignatures!){const value=await h.connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});expect(value?.meta?.err).toBeNull();const payer=value!.transaction.message.staticAccountKeys[0].toBase58();expect([deployer.publicKey,...pairs.map(pair=>pair.sniper.publicKey)]).toContain(payer);transactionDebits.set(payer,(transactionDebits.get(payer)??0n)+BigInt(value!.meta!.preBalances[0])-BigInt(value!.meta!.postBalances[0]))}
  for(const [index,key] of h.fresh.entries())if(transactionDebits.has(key.publicKey.toBase58()))expect(BigInt(before[index])-BigInt(launchSolBalances[index])).toBe(transactionDebits.get(key.publicKey.toBase58()))
  const sentBeforeSales=h.sent.length,proofSales:unknown[]=[]
  let lockHeld=false
  const locks={request:async<T,>(name:string,_options:{ifAvailable:true},fn:(lock:object|null)=>Promise<T>)=>{expect(name).toBe('vanity-launch-submission');expect(lockHeld).toBe(false);lockHeld=true;try{return await fn({})}finally{lockHeld=false}}}
  const sell=async(pairIds:readonly string[]|undefined,expectedRows:number)=>{
   const selected=policy.receivers(pairIds),requests:SaleRequest[]=[]
   for(const wallet of selected){const scan=await scanRelayWallet(h.connection,wallet.publicKey);scope.assertCurrent();for(const asset of scan.assets.filter(asset=>asset.saleEligible&&BigInt(asset.amountRaw)>0n))requests.push({walletId:wallet.id,walletName:wallet.name,payer:wallet.publicKey,mint:asset.mint,tokenProgram:asset.tokenProgram,amountRaw:asset.amountRaw,decimals:asset.decimals})}
   expect(requests).toHaveLength(expectedRows);policy.assertSaleRows(requests)
   const beforeSales=new Map(await Promise.all(requests.map(async row=>[row.payer,await h.connection.getBalance(new PublicKey(row.payer))] as const))),review=await prepareSaleBatch(h.connection,requests,{slippageBps:500,priorityFeeLamports:'100000'},{storage:h.storage,locks,assertAvailable:()=>policy.assertSaleRows(requests)})
   expect(review.rows.every(row=>row.status==='ready'),JSON.stringify(review.rows.map(row=>row.error))).toBe(true)
   const signedMinima=new Map<string,string>(),assertAllowed=()=>policy.assertSaleRows(review.rows),result=await executeSaleBatch(h.connection,review,{approved:true,readSigner:id=>{const wallet=scope.resolveWallet(id)!;policy.assertSaleRows([{walletId:id,payer:wallet.publicKey}]);return scope.getKeypair(id)?.publicKey.toBase58()},assertAvailable:assertAllowed,sign:async(id,transaction)=>{
    expect(lockHeld).toBe(true);assertAllowed();const key=scope.getKeypair(id)!;policy.assertSaleRows([{walletId:id,payer:key.publicKey.toBase58()}]);expect(transaction.message.staticAccountKeys[0].toBase58()).toBe(key.publicKey.toBase58())
    const sale=transaction.message.compiledInstructions.find(ix=>transaction.message.staticAccountKeys[ix.programIdIndex].equals(PUMP_PROGRAM_ID)&&Buffer.from(ix.data).subarray(0,8).equals(Buffer.from([51,230,133,164,1,127,131,173])))!,minimum=Buffer.from(sale.data).readBigUInt64LE(16)
    expect(minimum).toBeGreaterThanOrEqual(BigInt(review.rows.find(row=>row.walletId===id)!.minimumSolOut!));signedMinima.set(id,minimum.toString());transaction.sign([key]);return transaction
   }},{storage:h.storage,locks,assertAvailable:assertAllowed})
   expect(result.status,result.error).toBe('completed');expect(result.rows.every(row=>row.status==='confirmed')).toBe(true);expect(readTradePending(h.storage)).toBeNull()
   const rows=[]
   for(const row of result.rows){expect(await tokenBalance(h.connection,h.mint.publicKey,new PublicKey(row.payer))).toBe(0n);const after=await h.connection.getBalance(new PublicKey(row.payer));expect(after).toBeGreaterThan(beforeSales.get(row.payer)!);expect(readTradeHistory(h.storage).some(receipt=>receipt.signature===row.signature&&receipt.payer===row.payer&&receipt.status==='confirmed')).toBe(true);rows.push({walletId:row.walletId,payer:row.payer,signature:row.signature,amountRaw:row.amountRaw,reviewedMinimumSolOut:row.minimumSolOut,signedMinimumSolOut:signedMinima.get(row.walletId),netSolProceedsLamports:String(after-beforeSales.get(row.payer)!)})}
   proofSales.push({selectedPairIds:pairIds??'all-pairs',status:result.status,rows})
  }
  await sell([pairs[0].id],1);expect(await tokenBalance(h.connection,h.mint.publicKey,h.receivers[1].publicKey)).toBeGreaterThan(0n);await sell(undefined,1)
  const receiverAddresses=new Set(pairs.map(pair=>pair.receiver.publicKey)),salesSent=h.sent.slice(sentBeforeSales)
  expect(salesSent).toHaveLength(2);expect(salesSent.every(row=>receiverAddresses.has(row.payer))).toBe(true)
  for(const [index,key] of h.fresh.entries()){const amount=await tokenBalance(h.connection,h.mint.publicKey,key.publicKey),sol=await h.connection.getBalance(key.publicKey);if(receiverAddresses.has(key.publicKey.toBase58()))expect(amount).toBe(0n);else{expect(amount).toBe(launchTokenBalances[index]);expect(sol).toBe(launchSolBalances[index])}}
  expect(JSON.stringify([...h.data.values()])).not.toMatch(/privateKey|secretKey|encodedTransactions/)
  const proof={scenario:'two independent reusable sniper pairs',mode:'manual',mint:h.mint.publicKey.toBase58(),sessionBackup:{walletCount:restored.wallets.length,pairCount:restored.pairs.length,allLocalIdsRebound:true},deployer:creatorKey.publicKey.toBase58(),pairs:pairs.map(pair=>({name:pair.name,sniper:pair.sniper.publicKey,receiver:pair.receiver.publicKey})),launchSignatures:launched.submittedSignatures,transfers:launched.tokenTransfers,launchTokenBalancesRaw:launchTokenBalances.map(String),launchSourceSolDebitsLamports:pairs.map((_,index)=>String(before[index*2]-launchSolBalances[index*2])),sales:proofSales,saleBroadcasts:salesSent,sourceAndDeployerUnchangedAfterSales:true,receiverFinalTokenBalancesRaw:['0','0'],realSolSpent:false}
  if(process.env.VANITY_SNIPER_PAIRS_PROOF_FILE)writeFileSync(process.env.VANITY_SNIPER_PAIRS_PROOF_FILE,JSON.stringify(proof,null,2))
 },120000)
})
