import {afterEach,describe,expect,it,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {ExtensionType,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,getExtensionData,unpackAccount,unpackMint} from '@solana/spl-token'
import {unpack} from '@solana/spl-token-metadata'
import {PUMP_PROGRAM_ID,PUMP_SDK,bondingCurvePda,PUMP_FEE_PROGRAM_ID,creatorVaultPda} from '@pump-fun/pump-sdk'
import {prepareLaunchBundle} from '../src/lib/launchBundle/prepare'
import {executePreparedLaunchBundle} from '../src/lib/launchBundle/execute'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
import {simulateAtomicBundle,submitAtomicBundle} from '../src/lib/bundler/jito'
import {confirmSignatures} from '../src/lib/transactions/send'
import {clearPendingIfMatching,readPending,saveConfirmed,savePending} from '../src/lib/launchHistory'
import {persistBundleCheckpoint,readPendingBundleReceipt} from '../src/lib/bundler/pending'
import {resolveGitHubIndividual} from '../src/lib/server/githubRecipient'
import type {CreatorFeeSelection} from '../src/lib/creatorFeeRouting'

const proofs:Record<string,unknown>[]=[]
afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_LAUNCH_BUNDLE_LOCALNET!=='1')('production inline bundle engine on disposable local Surfpool',()=>{
 async function setup(){
  const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899',url=new URL(endpoint),realFetch=globalThis.fetch
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Only unauthenticated loopback Surfpool is allowed')
  let verified=false
  const generated=new Set<string>(),storage=new Map<string,string>()
  const guardedFetch:typeof fetch=async(resource,init)=>{
   if(new URL(String(resource)).origin!==url.origin)throw new Error('The fake-SOL test rejected an external request')
   const call=JSON.parse(String(init?.body))
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
    if(!verified)throw new Error('A ready Surfpool runtime must be verified before local mutation')
    const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((packet:string)=>VersionedTransaction.deserialize(Buffer.from(packet,'base64')).message.staticAccountKeys[0].toBase58())
    if(payers.some((payer:string)=>!generated.has(payer)))throw new Error('Only newly generated fake-funded payers may submit')
   }
   return realFetch(resource,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(30_000)})
  }
  vi.stubGlobal('fetch',guardedFetch)
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value)},removeItem:(key:string)=>{storage.delete(key)}})
  const rpc=async(method:string,params:unknown[]=[])=>{const response=await guardedFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const value=await response.json();if(value.error)throw new Error(`Local ${method} failed: ${value.error.message}`);return value.result}
  const version=await rpc('getVersion'),info=await rpc('surfnet_getSurfnetInfo')
  if(version['surfnet-version']!=='1.6.1'||info.value?.startup?.phase!=='ready')throw new Error('The loopback endpoint is not the verified ready Surfpool runtime')
  await rpc('surfnet_getLocalSignatures',[0]);verified=true
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guardedFetch,disableRetryOnRateLimit:true})
  const fresh=async()=>{const key=Keypair.generate();generated.add(key.publicKey.toBase58());const signature=await connection.requestAirdrop(key.publicKey,2_000_000_000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10_000,pollIntervalMs:100})).status).toBe('confirmed');return key}
  const creator=await fresh(),buyers=[await fresh(),await fresh(),await fresh()],mint=Keypair.generate()
  return {connection,endpoint,creator,buyers,mint,storage,rpc}
 }
 async function tokenAmount(connection:Connection,mint:PublicKey,owner:PublicKey){const ata=getAssociatedTokenAddressSync(mint,owner,false,TOKEN_2022_PROGRAM_ID),info=await connection.getAccountInfo(ata,'confirmed');return info?unpackAccount(ata,info,TOKEN_2022_PROGRAM_ID).amount:0n}
 for(const example of [{mode:'block0' as const,long:false,kind:'deployer' as const},{mode:'block0' as const,long:true,kind:'deployer' as const},{mode:'block0' as const,long:true,kind:'wallet' as const},{mode:'block0' as const,long:true,kind:'holder-rewards' as const},{mode:'block0' as const,long:true,kind:'github' as const},{mode:'manual' as const,long:false,kind:'deployer' as const},{mode:'organic' as const,long:false,kind:'deployer' as const},{mode:'manual' as const,long:false,kind:'holder-rewards' as const},{mode:'organic' as const,long:false,kind:'github' as const}]){
  it(`executes ${example.kind} ${example.mode}, ${example.long?'maximum':'normal'} metadata through the new prepare/execute engine`,async()=>{
   const githubRecipient=example.kind==='github'?await resolveGitHubIndividual('octocat'):undefined
   const h=await setup(),payer=h.creator.publicKey.toBase58(),selected=h.buyers.slice(0,2),keys=new Map(selected.map((key,index)=>[`buyer-${index}`,key])),metadata=example.long?{name:'N'.repeat(32),symbol:'S'.repeat(10),uri:'https://example.com/'.padEnd(200,'m')}:{name:`Inline ${example.mode}`,symbol:'INLINE',uri:'https://example.com/inline.json'}
   const creatorFeeSelection:CreatorFeeSelection=example.kind==='wallet'?{kind:'wallet',address:Keypair.generate().publicKey.toBase58()}:example.kind==='github'?{kind:'github',username:githubRecipient!.username}:{kind:example.kind}
   const settings={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:example.mode,groupId:'disposable-local-group',wallets:selected.map((key,index)=>({walletId:`buyer-${index}`,publicKey:key.publicKey.toBase58(),name:`Disposable buyer ${index+1}`,buySol:0.01+index*0.005,delaySeconds:0})),intervalMinSeconds:0.001,intervalMaxSeconds:0.002}
   const addresses=[h.creator,...selected,h.buyers[2]],before=await Promise.all(addresses.map(key=>h.connection.getBalance(key.publicKey))),simulations:{signed:boolean;debits?:Record<string,string>}[]=[]
   const guards={readSigner:()=>payer,readBuyer:(id:string)=>keys.get(id)??null}
   const prepared=await prepareLaunchBundle(h.connection,{payer,mintKeypair:h.mint,metadata,devBuySol:0.01,slippage:5,priorityFeeSol:0.00002,jitoTipSol:0.00001,settings,creatorFeeSelection,githubRecipient},guards,{
    simulate:async(connection,packets,options)=>{const accounts=[...new Map(packets.flatMap(packet=>packet.message.staticAccountKeys).map(key=>[key.toBase58(),key])).values()];for(let index=0;index<accounts.length;index+=100)await connection.getMultipleAccountsInfo(accounts.slice(index,index+100));const result=await simulateAtomicBundle(connection,packets,options);simulations.push({signed:!!options?.verifySignatures,debits:result.walletDebitsLamports});return result},
    sendBundle:(connection,packets,options)=>submitAtomicBundle(connection,packets,{...options,endpoint:h.endpoint}),
   })
   expect(prepared.review.mint).toBe(h.mint.publicKey.toBase58());expect(prepared.transactions.every(tx=>tx.serialize().length<=1232)).toBe(true)
   if(example.mode==='block0'&&example.long)expect(prepared.transactions).toHaveLength(5)
   const originals:string[][]=[]
   const result=await executePreparedLaunchBundle(prepared,{approved:true,...guards,signCreator:async packets=>{packets.forEach(packet=>packet.sign([h.creator]));return packets},onInitialBroadcast:pending=>{originals.push([...pending.signatures]);savePending(pending)},onInitialConfirmed:pending=>{saveConfirmed(pending)},onInitialNotSubmitted:clearPendingIfMatching,onReceipt:receipt=>{if(receipt.status==='unknown'){expect(receipt.submissions?.map(item=>item.signature)).toEqual(receipt.submittedSignatures);expect(receipt.submissions?.every(item=>item.blockhash&&item.expiresAfterBlockHeight>0&&Number.isFinite(Date.parse(item.submittedAt)))).toBe(true)}persistBundleCheckpoint(receipt)}})
   expect(result.status,`${result.error??''}; ${JSON.stringify(simulations)}`).toBe('confirmed');expect(result.success).toBe(true)
   expect(result.mintAddress).toBe(h.mint.publicKey.toBase58());expect(originals[0][0]).toBe(result.createSignature);expect(originals[0].every(signature=>result.submittedSignatures?.includes(signature))).toBe(true)
   expect(result.submissions?.map(item=>item.signature)).toEqual(result.submittedSignatures);expect(result.submissions?.filter(item=>item.payer!==payer).length).toBe(2)
   expect(result.buySignatures).toHaveLength(2);expect(readPending()).toBeNull();expect(readPendingBundleReceipt()).toBeNull()
   const mintInfo=await h.connection.getAccountInfo(h.mint.publicKey,'confirmed'),curveInfo=await h.connection.getAccountInfo(bondingCurvePda(h.mint.publicKey),'confirmed')
   expect(mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);expect(curveInfo?.owner.equals(PUMP_PROGRAM_ID)).toBe(true)
   const mint=unpackMint(h.mint.publicKey,mintInfo!,TOKEN_2022_PROGRAM_ID),stored=unpack(getExtensionData(ExtensionType.TokenMetadata,mint.tlvData)!)
   expect(stored.name).toBe(metadata.name);expect(stored.symbol).toBe(metadata.symbol);expect(stored.uri).toBe(metadata.uri);expect(mint.mintAuthority).toBeNull();expect(mint.freezeAuthority).toBeNull()
   const routing=prepared.review.creatorFeeRouting,curve=PUMP_SDK.decodeBondingCurve(curveInfo!)
   expect(curve.creator.toBase58()).toBe(routing.effectiveCreator);expect(curve.isHolderReward).toBe(example.kind==='holder-rewards');expect(curve.isCashbackCoin).toBe(false);expect(result.creatorFeeRouting).toEqual(routing)
   expect(await h.connection.getBalance(creatorVaultPda(new PublicKey(routing.effectiveCreator)))).toBeGreaterThan(0)
   if(example.kind==='github'){
    const sharingInfo=await h.connection.getAccountInfo(new PublicKey(routing.sharingConfig!)),socialInfo=await h.connection.getAccountInfo(new PublicKey(routing.socialRecipient!))
    expect(sharingInfo?.owner.equals(PUMP_FEE_PROGRAM_ID)).toBe(true);expect(socialInfo?.owner.equals(PUMP_FEE_PROGRAM_ID)).toBe(true)
    const sharing=PUMP_SDK.decodeSharingConfig(sharingInfo!),social=PUMP_SDK.decodeSocialFeePda(socialInfo!)
    expect(sharing.adminRevoked).toBe(true);expect(sharing.shareholders.map(share=>({address:share.address.toBase58(),shareBps:share.shareBps}))).toEqual([{address:routing.socialRecipient,shareBps:10000}]);expect(social.userId).toBe(githubRecipient!.userId);expect(social.platform).toBe(2)
   }
   const balances=await Promise.all(addresses.map(key=>tokenAmount(h.connection,h.mint.publicKey,key.publicKey))),after=await Promise.all(addresses.map(key=>h.connection.getBalance(key.publicKey))),debits=before.map((value,index)=>(BigInt(value)-BigInt(after[index])).toString())
   expect(balances.slice(0,3).every(balance=>balance>0n)).toBe(true);expect(balances[3]).toBe(0n);expect(debits[3]).toBe('0');expect(debits[0]).toBe(prepared.review.creatorDebitLamports)
   selected.forEach((_key,index)=>{const reviewed=prepared.review.wallets[index];expect(BigInt(debits[index+1])).toBeGreaterThan(0n);if(example.mode==='block0')expect(debits[index+1]).toBe(reviewed.initialDebitLamports);else expect(BigInt(debits[index+1])).toBeLessThanOrEqual(BigInt(reviewed.requiredLamports))})
   const statuses=await h.connection.getSignatureStatuses(result.submittedSignatures!,{searchTransactionHistory:true});expect(statuses.value.every(status=>status&&!status.err&&['confirmed','finalized'].includes(status.confirmationStatus!))).toBe(true)
   expect(JSON.stringify([...h.storage.values()])).not.toMatch(/privateKey|secretKey|encodedTransactions|signedBytes|mintKeypair/)
   const proof={proof:'production-inline-launch-bundle-engine',mode:example.mode,creatorFeeRouting:routing,observedCreator:curve.creator.toBase58(),observedHolderReward:curve.isHolderReward,maximumMetadata:example.long,packetBytes:prepared.transactions.map(tx=>tx.serialize().length),mint:result.mintAddress,initialSignatures:originals[0],allSignatures:result.submittedSignatures,reviewedCreatorDebitLamports:prepared.review.creatorDebitLamports,actualWalletDebitsLamports:debits,tokenBalancesRaw:balances.map(value=>value.toString()),realSolSpent:false,transport:'loopback Surfpool sendBundle/sendTransaction; no Jito auction',checks:['selected-mint-preserved','actual-native-builders','all-signed-simulations','real-fake-bank-execution','creator-and-selected-buyers-own-tokens','unselected-wallet-unchanged','original-public-receipts','future-buys-only-after-create-confirmed','effective-creator-and-flags','github-shares-and-social-identity']}
   proofs.push(proof);if(process.env.VANITY_LAUNCH_BUNDLE_EVIDENCE_FILE)writeFileSync(process.env.VANITY_LAUNCH_BUNDLE_EVIDENCE_FILE,JSON.stringify(proofs,null,2)+'\n');console.log(JSON.stringify(proof))
  },120_000)
 }
 it('refuses three immediate buyers when maximum metadata consumes two launch packets, without creating a mint',async()=>{
  const h=await setup(),payer=h.creator.publicKey.toBase58(),keys=new Map(h.buyers.map((key,index)=>[`buyer-${index}`,key])),settings={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0' as const,groupId:'local',wallets:h.buyers.map((key,index)=>({walletId:`buyer-${index}`,publicKey:key.publicKey.toBase58(),name:'Local',buySol:0.01,delaySeconds:0}))}
  await expect(prepareLaunchBundle(h.connection,{payer,mintKeypair:h.mint,metadata:{name:'N'.repeat(32),symbol:'S'.repeat(10),uri:'https://example.com/'.padEnd(200,'m')},devBuySol:0.01,slippage:5,priorityFeeSol:0.00002,jitoTipSol:0.00001,settings},{readSigner:()=>payer,readBuyer:id=>keys.get(id)??null})).rejects.toThrow(/capacity|reduce|packet/i)
  expect(await h.connection.getAccountInfo(h.mint.publicKey,'confirmed')).toBeNull()
 },120_000)
})
