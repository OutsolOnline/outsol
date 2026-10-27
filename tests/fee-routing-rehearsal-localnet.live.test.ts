import {afterEach,describe,expect,it,vi} from 'vitest'
import {appendFileSync} from 'node:fs'
import {Connection,Keypair,VersionedTransaction} from '@solana/web3.js'
import {PUMP_SDK,socialFeePda,Platform} from '@pump-fun/pump-sdk'
import {executeRehearsal} from '../src/lib/server/rehearsal/execute'
import {resolveGitHubIndividual} from '../src/lib/server/githubRecipient'
import type {CreatorFeeSelection} from '../src/lib/creatorFeeRouting'

// Attach the product executor to the already-running audit VM. Retain its real
// loopback/version/genesis verification and never reset, stop or own this VM.
vi.mock('../src/lib/server/rehearsal/runtime',async original=>({
 ...await original<typeof import('../src/lib/server/rehearsal/runtime')>(),
 acquireRehearsalRuntime:async()=> 'http://127.0.0.1:8899',
 releaseRehearsalRuntime:async()=>{},
}))
afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_FEE_CONSUMERS_LOCAL!=='1')('product rehearsal creator routing on shared fake-SOL fork',()=>{
 const wallet=Keypair.generate().publicKey.toBase58()
 const routes:CreatorFeeSelection[]=[{kind:'deployer'},{kind:'wallet',address:wallet},{kind:'holder-rewards'},{kind:'github',username:'octocat'},{kind:'github',username:'wycats'}]
 it.each(routes.flatMap(selection=>['0','0.1'].map(initialBuySol=>({selection,initialBuySol}))))('executes $selection.kind / $initialBuySol with verified public input, actual authorities and exact debit',async({selection,initialBuySol})=>{
  const realFetch=globalThis.fetch,funded=new Set<string>()
  vi.stubGlobal('fetch',async(resource:Parameters<typeof fetch>[0],init?:RequestInit)=>{
   const url=new URL(typeof resource==='string'||resource instanceof URL?String(resource):resource.url)
   if(url.origin==='https://api.github.com'&&init?.method==='GET'&&url.pathname.startsWith('/users/'))return realFetch(resource,init)
   if(url.origin!=='http://127.0.0.1:8899'||url.pathname!=='/'||url.search||url.hash)throw new Error('The consumer proof blocked an external request')
   const call=JSON.parse(String(init?.body))
   if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared runtime mutation is forbidden')
   if(call.method==='requestAirdrop')funded.add(call.params[0])
   if(call.method==='sendTransaction'||call.method==='sendBundle'){
    const encoded=call.method==='sendBundle'?call.params[0]:[call.params[0]]
    for(const raw of encoded){const tx=VersionedTransaction.deserialize(Buffer.from(raw,'base64'));if(!funded.has(tx.message.staticAccountKeys[0].toBase58()))throw new Error('Only a fresh disposable rehearsal payer may submit')}
   }
   return realFetch(resource,init)
  })
  const connection=new Connection('http://127.0.0.1:8899','confirmed')
  let socialWasInitialized:boolean|undefined
  const mustInitialize=selection.kind==='github'&&selection.username==='wycats'
  if(mustInitialize){
   let chosen:string|undefined
   for(const username of initialBuySol==='0'?['wycats','ryanb','josh']:['tenderlove','atmos','rtomayko']){
    const identity=await resolveGitHubIndividual(username,AbortSignal.timeout(10000))
    if(!await connection.getAccountInfo(socialFeePda(identity.userId,Platform.GitHub))){chosen=username;break}
   }
   if(!chosen)throw new Error('No unused public GitHub individual in the bounded test fixture list')
   selection={kind:'github',username:chosen}
  }
  if(selection.kind==='github'){
   const identity=await resolveGitHubIndividual(selection.username,AbortSignal.timeout(10000))
   socialWasInitialized=!!(await connection.getAccountInfo(socialFeePda(identity.userId,Platform.GitHub)))
   if(mustInitialize)expect(socialWasInitialized).toBe(false)
  }
  const report=await executeRehearsal({name:'N'.repeat(32),symbol:'S'.repeat(10),metadataUri:'https://example.com/'.padEnd(200,'x'),initialBuySol,priorityFeeSol:'0.00002',jitoTipSol:'0.00001',creatorFeeSelection:selection},AbortSignal.timeout(55000))
  expect(report.creatorFeeRouting?.selection).toEqual(selection)
  expect(report.observedRouting?.creator).toBe(report.creatorFeeRouting?.effectiveCreator)
  expect(report.observedRouting?.isHolderReward).toBe(selection.kind==='holder-rewards')
  expect(report.observedRouting?.isCashbackCoin).toBe(false)
  expect(report.mintAuthority).toBeNull();expect(report.freezeAuthority).toBeNull();expect(report.metadataImmutable).toBe(true)
  expect(BigInt(report.totalCostLamports)).toBe(BigInt(report.payerBeforeLamports)-BigInt(report.payerAfterLamports))
  expect(BigInt(report.networkFeeLamports)).toBeGreaterThan(0n)
  expect(BigInt(report.walletTokenRaw)>0n).toBe(initialBuySol!=='0')
  if(selection.kind==='github'){
   const routing=report.creatorFeeRouting!,account=await connection.getAccountInfo(socialFeePda(routing.github!.userId,Platform.GitHub))
   expect(PUMP_SDK.decodeSocialFeePda(account!).userId).toBe(routing.github!.userId)
   expect(report.observedRouting?.sharing).toMatchObject({adminRevoked:true,shareholder:routing.socialRecipient,shareBps:10000})
  }
  expect(report.unsupported).toEqual({devLock:'not-configured',lp:'not-configured'})
  expect(JSON.stringify(report)).not.toMatch(/secretKey|privateKey|RPC_URL|signedBytes/)
  appendFileSync('work/consumer-fee-rehearsal-proof.jsonl',JSON.stringify({proof:'product-rehearsal-creator-fee',realSolSpent:false,selection,initialBuySol,socialWasInitialized,mint:report.mint,routing:report.creatorFeeRouting,observed:report.observedRouting,walletTokenRaw:report.walletTokenRaw,totalCostLamports:report.totalCostLamports,networkFeeLamports:report.networkFeeLamports,packets:report.transactionSignatures.length})+'\n')
 },60000)
})
