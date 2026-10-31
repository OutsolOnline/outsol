import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {MINT_SIZE,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,createInitializeMint2Instruction,createMintToInstruction,getAssociatedTokenAddressSync,unpackAccount} from '@solana/spl-token'
import {confirmSignatures,sendAndConfirmTransaction} from '../src/lib/transactions/send'
import {prepareRelayTransfer} from '../src/lib/relay/prepare'
import {scanRelayWallet} from '../src/lib/relay/scan'
import {executeRelayTransfer} from '../src/lib/relay/execute'
import {readRelayReceipts} from '../src/lib/relay/history'

const enabled=process.env.RUN_RELAY_LOCALNET==='1',endpoint=process.env.VANITY_LOCALNET_RPC??'http://127.0.0.1:8899',realFetch=globalThis.fetch,owned=new Set<string>(),evidence:Record<string,unknown>[]=[]
let verified=false,sends=0
const locks={request:async<T>(_name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>callback({})}
function memory(){const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
function fresh(){const key=Keypair.generate();owned.add(key.publicKey.toBase58());return key}
const guardedFetch:typeof fetch=async(input,init)=>{
 const local=new URL(endpoint)
 if(local.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(local.hostname)||local.search||local.hash||local.username||local.password||local.pathname!=='/'||new URL(String(input)).origin!==local.origin)throw new Error('Relay acceptance rejects all external requests.')
 const call=JSON.parse(String(init?.body))
 if(['requestAirdrop','sendTransaction','sendBundle'].includes(call.method)){
  if(!verified)throw new Error('Identify Surfpool before funding or signing.')
  const payers=call.method==='requestAirdrop'?[call.params[0]]:(call.method==='sendBundle'?call.params[0]:[call.params[0]]).map((value:string)=>VersionedTransaction.deserialize(Buffer.from(value,'base64')).message.staticAccountKeys[0].toBase58())
  if(payers.some((value:string)=>!owned.has(value)))throw new Error('Only fresh in-memory test wallets may spend fake SOL.')
  if(call.method==='sendTransaction')sends++
 }
 return realFetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(20000)})
}
const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guardedFetch,disableRetryOnRateLimit:true})
async function rpc(method:string,params:unknown[]=[]){const response=await guardedFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),value=await response.json();if(!response.ok||value.error)throw new Error('Local fake runtime operation failed.');return value.result}

describe.skipIf(!enabled)('Relay exact token migration on isolated fake-SOL Surfpool',()=>{
 beforeAll(async()=>{expect((await rpc('getVersion'))['surfnet-version']).toBe('1.6.1');expect((await rpc('surfnet_getSurfnetInfo')).value.startup.phase).toBe('ready');await rpc('surfnet_getLocalSignatures',[0]);verified=true})
 afterEach(()=>vi.unstubAllGlobals())
 afterAll(()=>{if(process.env.RELAY_LOCALNET_REPORT_FILE)writeFileSync(process.env.RELAY_LOCALNET_REPORT_FILE,JSON.stringify({checkedAt:new Date().toISOString(),runtime:'Surfpool1.6.1',realSolSpent:false,network:'loopback-mainnet-fork',sends,cases:evidence},null,2))})
 for(const program of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID])it(`moves exact ${program.equals(TOKEN_PROGRAM_ID)?'SPL':'Token-2022'} full holdings, preserving SOL except measured fee and rent`,async()=>{
  vi.stubGlobal('fetch',guardedFetch)
  const payer=fresh(),destination=fresh(),mint=fresh(),source=getAssociatedTokenAddressSync(mint.publicKey,payer.publicKey,false,program),target=getAssociatedTokenAddressSync(mint.publicKey,destination.publicKey,false,program),amount=9_007_199_254_740_993n
  const airdrop=await connection.requestAirdrop(payer.publicKey,2_000_000_000);expect((await confirmSignatures(connection,[airdrop],{timeoutMs:10000,pollIntervalMs:25})).status).toBe('confirmed')
  const rent=await connection.getMinimumBalanceForRentExemption(MINT_SIZE),latest=await connection.getLatestBlockhash('confirmed')
  const setup=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:latest.blockhash,instructions:[SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,space:MINT_SIZE,lamports:rent,programId:program}),createInitializeMint2Instruction(mint.publicKey,6,payer.publicKey,null,program),createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,source,payer.publicKey,mint.publicKey,program),createMintToInstruction(mint.publicKey,source,payer.publicKey,amount,[],program)]}).compileToV0Message())
  setup.sign([payer,mint]);expect((await sendAndConfirmTransaction(connection,setup,{timeoutMs:15000,pollIntervalMs:25})).status).toBe('confirmed')
  const scan=await scanRelayWallet(connection,payer.publicKey.toBase58()),asset=scan.assets.find(value=>value.account===source.toBase58())!
  expect(asset).toMatchObject({eligible:true,amountRaw:amount.toString(),tokenProgram:program.toBase58()})
  const prepared=await prepareRelayTransfer(connection,{source:payer.publicKey.toBase58(),destination:destination.publicKey.toBase58(),sourceAccount:source.toBase58(),mint:mint.publicKey.toBase58(),tokenProgram:program.toBase58(),amountRaw:amount.toString(),decimals:6,priorityFeeLamports:'10000'}),before=await connection.getBalance(payer.publicKey),storage=memory(),sendBefore=sends
  const result=await executeRelayTransfer(connection,prepared,{approved:true,storage,locks,readSigner:()=>payer.publicKey.toBase58(),sign:async transaction=>{transaction.sign([payer]);return transaction},assertAvailable:()=>{},timeoutMs:15000,pollIntervalMs:25})
  expect(result.status,result.error).toBe('confirmed');expect(sends-sendBefore).toBe(1)
  const sourceInfo=await connection.getAccountInfo(source),targetInfo=await connection.getAccountInfo(target),after=await connection.getBalance(payer.publicKey)
  expect(unpackAccount(source,sourceInfo,program).amount).toBe(0n);expect(unpackAccount(target,targetInfo,program).amount).toBe(amount)
  expect(BigInt(before-after)).toBe(BigInt(prepared.preview.maxDebitLamports));expect(BigInt(before-after)).toBe(BigInt(prepared.preview.networkFeeLamports)+BigInt(prepared.preview.destinationRentLamports));expect(await connection.getBalance(destination.publicKey)).toBe(0)
  expect(readRelayReceipts(storage)[0]).toMatchObject({signature:result.signature,status:'confirmed',amountRaw:amount.toString()})
  evidence.push({program:program.toBase58(),mint:mint.publicKey.toBase58(),source:payer.publicKey.toBase58(),destination:destination.publicKey.toBase58(),amountRaw:amount.toString(),sourceRemainingRaw:'0',destinationRaw:amount.toString(),signature:result.signature,actualDebitLamports:String(before-after),...prepared.preview})
 },60000)
})
