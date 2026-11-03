import {afterEach,describe,expect,it,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount,unpackMint} from '@solana/spl-token'
import bs58 from 'bs58'
import {buildCreateTransaction} from '../src/lib/pumpfun/api'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'
import {confirmSignatures,sendAndConfirmTransaction} from '../src/lib/transactions/send'
import {prepareBuyPlan,executeBuyPlan} from '../src/lib/buyPlans/engine'
import type {BuyPlan} from '../src/lib/buyPlans/model'
import {createConsolidation,readConsolidations,saveConsolidation} from '../src/lib/consolidation/model'
import {prepareConsolidationTransfers,executeConsolidationTransfers,prepareConsolidationSale,executeConsolidationSale,reconcileConsolidation,verifyConfirmedConsolidationTransfer,type ConsolidationControls} from '../src/lib/consolidation/engine'
import {executeRelayTransfer} from '../src/lib/relay/execute'
import {readRelayReceipts} from '../src/lib/relay/history'
import {executeSaleBatch} from '../src/lib/sales/batch'
import {readSaleHistory} from '../src/lib/sales/history'
import {readTradeHistory,readTradePending} from '../src/lib/venues/tradeHistory'
import {readPendingWalletOperation} from '../src/lib/walletOperations/history'
import {preparePumpTrade} from '../src/lib/venues/trade'

afterEach(()=>vi.unstubAllGlobals())

// A wrong receiver, total-holdings sale, repeated original, or nonfinalized
// transfer acceptance must fail against actual native instructions and balances.
describe.skipIf(process.env.RUN_CONSOLIDATION_LOCALNET!=='1')('consolidation with guarded fake-SOL native execution',()=>{
 it('recovers original transfers and sale, selling only two finalized source receipts while preserving receiver holdings',async()=>{
  const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint)
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Only an unauthenticated loopback Surfpool runtime may execute this fake-SOL test.')
  const creator=Keypair.generate(),sources=[Keypair.generate(),Keypair.generate()],receiver=Keypair.generate(),mint=Keypair.generate(),realFetch=globalThis.fetch
  const owned=new Set([creator,...sources,receiver].map(key=>key.publicKey.toBase58())),broadcasts=new Map<string,number>(),finalizedLookups=new Set<string>()
  let verified=false,hideNextPayer:string|null=null,hiddenSignature:string|null=null
  const guarded:typeof fetch=async(resource,init)=>{
   if(new URL(String(resource)).origin!==url.origin)throw new Error('This fake-SOL test refuses every external request.')
   const call=JSON.parse(String(init?.body))
   if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared simulator mutation is forbidden.')
   let concealAfterSend:string|null=null
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
    if(!verified)throw new Error('Identify the fake runtime before any funding or submission.')
    const packets=call.method==='requestAirdrop'?[]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((raw:string)=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')))
    const payers=call.method==='requestAirdrop'?[call.params[0]]:packets.map((tx:VersionedTransaction)=>tx.message.staticAccountKeys[0].toBase58())
    if(payers.some((payer:string)=>!owned.has(payer)))throw new Error('Only freshly generated test wallets may spend fake SOL.')
    for(const tx of packets){const signature=bs58.encode(tx.signatures[0]);broadcasts.set(signature,(broadcasts.get(signature)??0)+1);if(tx.message.staticAccountKeys[0].toBase58()===hideNextPayer)concealAfterSend=signature}
   }
   // Read-only hydration precedes Surfpool's simulation bank snapshot.
   if(call.method==='simulateBundle'){
    const keys=[...new Set((call.params[0].encodedTransactions as string[]).flatMap(raw=>VersionedTransaction.deserialize(Buffer.from(raw,'base64')).message.staticAccountKeys.map(key=>key.toBase58())))]
    for(let offset=0;offset<keys.length;offset+=100){const response=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[keys.slice(offset,offset+100),{encoding:'base64',commitment:'confirmed'}]}),redirect:'error',signal:AbortSignal.timeout(30000)});if((await response.json()).error)throw new Error('Read-only local protocol hydration failed.')}
   }
   if(call.method==='getTransaction'&&call.params[1]?.commitment==='finalized')finalizedLookups.add(call.params[0])
   const response=await realFetch(resource,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30000)})
   if(concealAfterSend){hiddenSignature=concealAfterSend;hideNextPayer=null}
   if(hiddenSignature&&call.method==='getSignatureStatuses'&&call.params[0].includes(hiddenSignature)){
    const body=await response.json();body.result.value=body.result.value.map((value:unknown,index:number)=>call.params[0][index]===hiddenSignature?null:value)
    return Response.json(body)
   }
   if(hiddenSignature&&call.method==='getTransaction'&&call.params[0]===hiddenSignature){const body=await response.json();body.result=null;return Response.json(body)}
   return response
  }
  vi.stubGlobal('fetch',guarded)
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guarded,disableRetryOnRateLimit:true}),version=await connection.getVersion() as unknown as Record<string,unknown>
  expect(typeof version['surfnet-version']).toBe('string')
  const info=await guarded(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'surfnet_getSurfnetInfo',params:[]})});expect((await info.json()).result.value.startup.phase).toBe('ready')
  expect(await connection.getGenesisHash()).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');verified=true
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const held=new Set<string>(),locks={request:async<T,>(name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({})}finally{held.delete(name)}}}
  vi.stubGlobal('localStorage',storage);vi.stubGlobal('navigator',{locks})
  const wallets=new Map<string,Keypair>([['creator',creator],['source-0',sources[0]],['source-1',sources[1]],['receiver',receiver]])
  for(const key of wallets.values()){const signature=await connection.requestAirdrop(key.publicKey,1_000_000_000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:100})).status).toBe('confirmed')}
  const built=await buildCreateTransaction({connection,userPublicKey:creator.publicKey.toBase58(),mintKeypair:mint,metadata:{name:'Consolidation QA',symbol:'CNSLD',description:''},metadataUri:'https://example.com/consolidation-qa.json',initialBuyAmount:0,slippage:5,priorityFee:0.0001,jitoTipLamports:10000})
  expect(built.success,built.error).toBe(true)
  const packets=built.transactions??[built.transaction!];packets.forEach(packet=>packet.sign([creator]))
  const simulation=await simulateAtomicBundle(connection,packets,{verifySignatures:true,payer:creator.publicKey.toBase58(),accounts:[creator.publicKey.toBase58()]});expect(simulation.success,simulation.error).toBe(true)
  const launch=packets.length===1?await sendAndConfirmTransaction(connection,packets[0],{timeoutMs:10000,pollIntervalMs:100}):await submitAtomicBundle(connection,packets,{endpoint,timeoutMs:10000,pollIntervalMs:100})
  expect(launch.status,launch.error).toBe('confirmed')
  const mintInfo=await connection.getAccountInfo(mint.publicKey,'confirmed');expect(mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true)
  const decimals=unpackMint(mint.publicKey,mintInfo!,TOKEN_2022_PROGRAM_ID).decimals
  const tokenBalance=async(owner:PublicKey)=>{const address=getAssociatedTokenAddressSync(mint.publicKey,owner,false,TOKEN_2022_PROGRAM_ID),account=await connection.getAccountInfo(address,'confirmed');return account?unpackAccount(address,account,TOKEN_2022_PROGRAM_ID).amount:0n}
  const finalizedTransaction=async(signature:string)=>{
   const deadline=Date.now()+10000
   do{const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});if(tx?.meta?.err)throw new Error('The original transaction failed on the finalized chain.');if(tx?.meta&&Number.isSafeInteger(tx.blockTime))return tx;await new Promise(resolve=>setTimeout(resolve,100))}while(Date.now()<deadline)
   throw new Error('Complete finalized transaction metadata was not indexed within ten seconds; no evidence was fabricated.')
  }
  const now=Date.now(),plan:BuyPlan={version:1,id:crypto.randomUUID(),name:'Fresh consolidation positions',mint:mint.publicKey.toBase58(),createdAt:now,updatedAt:now,mode:'sequence',order:'listed',intervalSeconds:0,slippage:5,priorityFeeSol:'0.0001',maxTotalDebitSol:'0.15',rows:[['receiver',receiver,'0.004'],['source-0',sources[0],'0.01'],['source-1',sources[1],'0.012']].map(([id,key,amount])=>({id:id as string,walletId:id as string,publicKey:(key as Keypair).publicKey.toBase58(),name:id as string,buySol:amount as string,maxDebitSol:'0.05',delaySeconds:0}))}
  const buyOptions={approved:true as const,storage,locks,readKeypair:(id:string)=>wallets.get(id)??null,assertCurrent:()=>{}}
  const buyReview=await prepareBuyPlan(connection,plan,plan.rows.map(row=>row.id),buyOptions),bought=await executeBuyPlan(buyReview,buyOptions)
  expect(bought.status,bought.error).toBe('completed')
  const baseline=await tokenBalance(receiver.publicKey),sourceAmounts=await Promise.all(sources.map(key=>tokenBalance(key.publicKey))),total=sourceAmounts[0]+sourceAmounts[1]
  expect(baseline).toBeGreaterThan(0n);expect(sourceAmounts.every(amount=>amount>0n)).toBe(true)
  const journal=createConsolidation({mint:mint.publicKey.toBase58(),receiver:{walletId:'receiver',address:receiver.publicKey.toBase58()},group:{id:'fresh-test-sources',memberIds:['source-0','source-1']},rows:sources.map((key,index)=>({walletId:`source-${index}`,input:{source:key.publicKey.toBase58(),destination:receiver.publicKey.toBase58(),mint:mint.publicKey.toBase58(),sourceAccount:getAssociatedTokenAddressSync(mint.publicKey,key.publicKey,false,TOKEN_2022_PROGRAM_ID).toBase58(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),amountRaw:sourceAmounts[index].toString(),decimals,priorityFeeLamports:'100000'}}))})
  saveConsolidation(journal,undefined,storage)
  const controls:ConsolidationControls={readWallet:id=>wallets.get(id)?.publicKey.toBase58(),readGroup:()=>['source-0','source-1'],readSigner:id=>wallets.get(id)?.publicKey.toBase58(),sign:async(id,tx)=>{expect(held.has('vanity-launch-submission')).toBe(true);const key=wallets.get(id);expect(key).toBeDefined();tx.sign([key!]);return tx}}
  const ports={storage,executeTransfer:(c:Connection,p:Parameters<typeof executeRelayTransfer>[1],o:Parameters<typeof executeRelayTransfer>[2])=>executeRelayTransfer(c,p,{...o,timeoutMs:200,pollIntervalMs:25}),executeSale:(c:Connection,r:Parameters<typeof executeSaleBatch>[1],s:Parameters<typeof executeSaleBatch>[2])=>executeSaleBatch(c,r,s,{storage,locks,send:(chain,tx,options)=>sendAndConfirmTransaction(chain,tx,{...options,timeoutMs:200,pollIntervalMs:25})})}
  const transferReview=await prepareConsolidationTransfers(connection,journal.id,controls,ports)
  expect(transferReview.totalRaw).toBe(total.toString());expect(transferReview.transfers).toHaveLength(2)
  for(const row of transferReview.transfers){expect(row.preview.destinationBeforeRaw).toBe(baseline.toString());expect(row.preview.destinationAfterRaw).toBe((baseline+BigInt(row.input.amountRaw)).toString())}
  const beforeTransfers=broadcasts.size;hideNextPayer=sources[0].publicKey.toBase58()
  const uncertain=await executeConsolidationTransfers(connection,transferReview,controls,ports)
  expect(uncertain.rows.map(row=>row.status)).toEqual(['unknown','planned']);expect(broadcasts.size-beforeTransfers).toBe(1)
  const originalTransfer=uncertain.rows[0].signature!;expect(originalTransfer).toBe(hiddenSignature)
  expect(readPendingWalletOperation(storage)?.signature).toBe(originalTransfer)
  expect(await tokenBalance(sources[0].publicKey)).toBe(0n);expect(await tokenBalance(receiver.publicKey)).toBe(baseline+sourceAmounts[0])
  await expect(prepareConsolidationTransfers(connection,journal.id,controls,ports)).rejects.toThrow(/uncertain/i)
  await expect(prepareConsolidationSale(connection,journal.id,controls,{slippageBps:500,priorityFeeLamports:'100000'},ports)).rejects.toThrow(/confirmation/i)
  hiddenSignature=null
  const recovered=await reconcileConsolidation(connection,journal.id,controls,ports)
  expect(recovered.rows[0]).toMatchObject({status:'confirmed',signature:originalTransfer});expect(readPendingWalletOperation(storage)).toBeNull();expect(broadcasts.size-beforeTransfers).toBe(1)
  const remainder=await prepareConsolidationTransfers(connection,journal.id,controls,ports);expect(remainder.transfers).toHaveLength(1);expect(remainder.transfers[0].input.source).toBe(sources[1].publicKey.toBase58())
  const transferred=await executeConsolidationTransfers(connection,remainder,controls,ports)
  expect(transferred.rows.map(row=>row.status)).toEqual(['confirmed','confirmed']);expect(broadcasts.size-beforeTransfers).toBe(2)
  for(const source of sources)expect(await tokenBalance(source.publicKey)).toBe(0n)
  expect(await tokenBalance(receiver.publicKey)).toBe(baseline+total)
  const transferEvidence=await Promise.all(readRelayReceipts(storage).map(async receipt=>{const tx=await finalizedTransaction(receipt.signature);return {receipt,slot:tx.slot,blockTime:tx.blockTime,keys:tx.transaction.message.staticAccountKeys.map(key=>key.toBase58()),signatures:tx.transaction.signatures,err:tx.meta?.err,fee:tx.meta?.fee,preBalances:tx.meta?.preBalances,postBalances:tx.meta?.postBalances,preTokenBalances:tx.meta?.preTokenBalances,postTokenBalances:tx.meta?.postTokenBalances,loadedAddresses:tx.meta?.loadedAddresses}}))
  writeFileSync('work/parity-consolidation-delta-diagnostic.json',JSON.stringify(transferEvidence,null,2))
  for(const receipt of readRelayReceipts(storage)){await verifyConfirmedConsolidationTransfer(connection,receipt);expect(finalizedLookups.has(receipt.signature)).toBe(true)}
  const saleReview=await prepareConsolidationSale(connection,journal.id,controls,{slippageBps:500,priorityFeeLamports:'100000'},ports)
  expect(saleReview.amountRaw).toBe(total.toString());expect(saleReview.sale.rows).toHaveLength(1)
  expect(saleReview.sale.rows[0]).toMatchObject({payer:receiver.publicKey.toBase58(),mint:mint.publicKey.toBase58(),amountRaw:total.toString(),route:'pump',status:'ready'})
  const receiverSolBefore=await connection.getBalance(receiver.publicKey,'confirmed');hideNextPayer=receiver.publicKey.toBase58()
  const unknownSale=await executeConsolidationSale(connection,saleReview,controls,ports)
  expect(unknownSale.sale).toMatchObject({attempted:true,status:'unknown'});expect(broadcasts.size-beforeTransfers).toBe(3)
  const originalSale=unknownSale.sale.signature!;expect(originalSale).toBe(hiddenSignature);expect(readTradePending(storage)?.signature).toBe(originalSale)
  expect(await tokenBalance(receiver.publicKey)).toBe(baseline)
  await expect(prepareConsolidationSale(connection,journal.id,controls,{slippageBps:500,priorityFeeLamports:'100000'},ports)).rejects.toThrow(/already attempted/i)
  await expect(executeConsolidationSale(connection,saleReview,controls,ports)).rejects.toThrow()
  hiddenSignature=null
  const completed=await reconcileConsolidation(connection,journal.id,controls,ports)
  expect(completed.sale).toMatchObject({status:'confirmed',signature:originalSale});expect(readTradePending(storage)).toBeNull();expect(broadcasts.size-beforeTransfers).toBe(3)
  expect(readConsolidations(storage)[0]).toEqual(completed)
  expect(readSaleHistory(storage)[0].rows[0]).toMatchObject({status:'confirmed',signature:originalSale,amountRaw:total.toString()})
  expect(readTradeHistory(storage).find(row=>row.signature===originalSale)).toMatchObject({status:'confirmed',maxSellRaw:total.toString()})
  const receiverSolAfter=await connection.getBalance(receiver.publicKey,'confirmed');expect(receiverSolAfter).toBeGreaterThan(receiverSolBefore)
  const signatures=[...completed.rows.map(row=>row.signature!),originalSale]
  expect(new Set(signatures).size).toBe(3);for(const signature of signatures)expect(broadcasts.get(signature)).toBe(1)
  expect((await confirmSignatures(connection,signatures,{timeoutMs:10000,pollIntervalMs:100})).status).toBe('confirmed')
  const saleTx=await finalizedTransaction(originalSale);expect(saleTx.meta?.err).toBeNull()
  const saleOwner=(rows:NonNullable<NonNullable<typeof saleTx>['meta']>['preTokenBalances'])=>rows?.find(row=>row.owner===receiver.publicKey.toBase58()&&row.mint===mint.publicKey.toBase58())?.uiTokenAmount.amount
  expect(saleOwner(saleTx!.meta!.preTokenBalances)).toBe((baseline+total).toString());expect(saleOwner(saleTx!.meta!.postTokenBalances)).toBe(baseline.toString())
  const defaultSaleInput={action:'sell' as const,mint:mint.publicKey.toBase58(),payer:receiver.publicKey.toBase58(),buySol:'0',slippage:5,priorityFeeSol:0.0001}
  const defaultFullPreview=await preparePumpTrade(connection,{...defaultSaleInput,sellPercent:100}),defaultPartialPreview=await preparePumpTrade(connection,{...defaultSaleInput,sellPercent:25})
  expect(defaultFullPreview.maxSellRaw).toBe(baseline.toString());expect(defaultPartialPreview.maxSellRaw).toBe((baseline*25n/100n).toString())
  expect(await tokenBalance(receiver.publicKey)).toBe(baseline);expect(broadcasts.size-beforeTransfers).toBe(3)
  expect(JSON.stringify([...values.values()])).not.toMatch(/secretKey|privateKey|encodedTransactions|signedBytes/)
  writeFileSync('work/parity-consolidation-proof.json',JSON.stringify({realSolSpent:false,runtime:'surfpool',runtimeVersion:version['surfnet-version'],mint:mint.publicKey.toBase58(),journalId:journal.id,sources:completed.rows.map((row,index)=>({address:row.input.source,tokenAccount:row.input.sourceAccount,initialTokenRaw:sourceAmounts[index].toString(),transferredRaw:row.input.amountRaw,finalTokenRaw:'0',signature:row.signature,status:row.status,finalizedDeltaVerified:finalizedLookups.has(row.signature!),broadcasts:broadcasts.get(row.signature!)})),receiver:{address:receiver.publicKey.toBase58(),preexistingTokenRaw:baseline.toString(),receivedRaw:total.toString(),beforeSaleRaw:(baseline+total).toString(),soldRaw:total.toString(),afterSaleRaw:baseline.toString(),netSolProceedsLamports:String(receiverSolAfter-receiverSolBefore)},sale:{...completed.sale,route:saleReview.sale.rows[0].route,reviewedMinimumSolOut:saleReview.sale.rows[0].minimumSolOut,finalizedTokenDeltaRaw:(-total).toString(),broadcasts:broadcasts.get(originalSale)},legacyPercentageUnsignedPreviews:{fullBalanceRaw:defaultFullPreview.maxSellRaw,quarterBalanceRaw:defaultPartialPreview.maxSellRaw,additionalBroadcasts:0},unknownOriginalTransferRecovered:true,unknownOriginalSaleRecovered:true,noResubmission:true,signatures},null,2))
 },180000)
})
