import {afterEach,describe,expect,it,vi} from 'vitest'
import {appendFileSync} from 'node:fs'
import {Connection,Keypair,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID,unpackAccount} from '@solana/spl-token'
import bs58 from 'bs58'
import {executeBundleLaunch} from '../src/lib/bundler/api'
import {useBundlerStore} from '../src/stores/bundlerStore'
import type {CreatorFeeSelection} from '../src/lib/creatorFeeRouting'

vi.mock('../src/lib/githubRecipient',async()=>{const actual=await import('../src/lib/server/githubRecipient');return {fetchGitHubIndividual:actual.resolveGitHubIndividual}})
afterEach(()=>vi.unstubAllGlobals())
describe.skipIf(process.env.RUN_FEE_CONSUMERS_LOCAL!=='1')('routed immediate-buyer bundle on shared fake-SOL fork',()=>{
 const routes:CreatorFeeSelection[]=[{kind:'deployer'},{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards'},{kind:'github',username:'octocat'}]
 it.each(routes)('executes maximum metadata and two immediate buyers using %s with every routed creator vault',async creatorFeeSelection=>{
  const creator=Keypair.generate(),buyers=[Keypair.generate(),Keypair.generate()],mint=Keypair.generate(),fresh=new Set([creator,...buyers].map(key=>key.publicKey.toBase58())),funded=new Set<string>(),realFetch=globalThis.fetch
  const endpoint='http://127.0.0.1:8899'
  let verified=false
  const guarded:typeof fetch=async(resource,init)=>{
   const url=new URL(typeof resource==='string'||resource instanceof URL?String(resource):resource.url)
   if(url.origin==='https://api.github.com'&&init?.method==='GET'&&url.pathname.startsWith('/users/'))return realFetch(resource,init)
   if(url.origin!==endpoint||url.pathname!=='/'||url.search||url.hash)throw new Error('Only the shared loopback VM is allowed')
   const call=JSON.parse(String(init?.body))
   if(/reset|setAccount|stop/i.test(call.method))throw new Error('Shared VM mutation is forbidden')
   if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)&&!verified)throw new Error('Official fork runtime must be verified before writes')
   if(call.method==='requestAirdrop'){if(!fresh.has(call.params[0]))throw new Error('Only fresh disposable keys may be funded');funded.add(call.params[0])}
   if(call.method==='sendTransaction'||call.method==='sendBundle')for(const raw of call.method==='sendBundle'?call.params[0]:[call.params[0]]){const tx=VersionedTransaction.deserialize(Buffer.from(raw,'base64'));if(!funded.has(tx.message.staticAccountKeys[0].toBase58()))throw new Error('Only disposable fake-SOL payers may send')}
   return realFetch(resource,init)
  }
  vi.stubGlobal('fetch',guarded)
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guarded,disableRetryOnRateLimit:true})
  const version=await connection.getVersion() as unknown as Record<string,unknown>;expect(version['surfnet-version']).toBe('1.6.1');expect(await connection.getGenesisHash()).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');verified=true
  for(const key of [creator,...buyers])await connection.requestAirdrop(key.publicKey,1_000_000_000)
  const state=useBundlerStore.getState()
  const config={...state,creatorFeeSelection,tokenName:'N'.repeat(32),tokenSymbol:'S'.repeat(10),tokenImage:new Blob(['fake test artwork'],{type:'image/png'}) as File,creatorPrivateKey:bs58.encode(creator.secretKey),creatorPublicKey:creator.publicKey.toBase58(),devBuyAmount:0.01,mintMode:'import' as const,importedMintKey:bs58.encode(mint.secretKey),sniperMode:'block0' as const,jitoTip:0.00001,autoSellEnabled:false,bundleWallets:buyers.map((key,index)=>({...state.bundleWallets[index],privateKey:bs58.encode(key.secretKey),publicKey:key.publicKey.toBase58(),buyAmount:0.01,mode:'sniper' as const,sellEnabled:false}))}
  const result=await executeBundleLaunch(config,()=>{},{connection,metadataUri:'https://example.com/'.padEnd(200,'x'),bundleEndpoint:endpoint})
  expect(result.success,result.error).toBe(true);expect(result.status).toBe('confirmed');expect(result.buySignatures).toHaveLength(2);expect(result.submittedSignatures).toHaveLength(5)
  expect(result.creatorFeeRouting?.selection).toEqual(creatorFeeSelection)
  for(const key of [creator,...buyers]){
   const ata=getAssociatedTokenAddressSync(mint.publicKey,key.publicKey,false,TOKEN_2022_PROGRAM_ID),info=await connection.getAccountInfo(ata)
   const account=unpackAccount(ata,info!,TOKEN_2022_PROGRAM_ID)
   expect(account.owner.equals(key.publicKey)).toBe(true);expect(account.mint.equals(mint.publicKey)).toBe(true);expect(account.amount).toBeGreaterThan(0n)
  }
  appendFileSync('work/consumer-fee-bundle-proof.jsonl',JSON.stringify({proof:'product-bundle-creator-fees',realSolSpent:false,creatorFeeSelection,mint:result.mintAddress,routing:result.creatorFeeRouting,packets:result.submittedSignatures?.length,immediateBuyers:2})+'\n')
 },60000)
})
