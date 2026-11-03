import {describe,expect,it} from 'vitest'
import {appendFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,type TransactionInstruction} from '@solana/web3.js'
import {AuthorityType,ExtensionType,MINT_SIZE,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,createInitializeMintInstruction,createInitializeMetadataPointerInstruction,createMintToInstruction,createSetAuthorityInstruction,getAssociatedTokenAddressSync,getMintLen,unpackAccount,unpackMint} from '@solana/spl-token'
import {createInitializeInstruction,pack} from '@solana/spl-token-metadata'
import {decodeStream} from '@streamflow/stream'
import {prepareSupplyLock,submitSupplyLock} from '../src/lib/supplyLocks/engine'
import {readPendingSupplyLock,readSupplyLockHistory} from '../src/lib/supplyLocks/history'
import {reconcilePendingSupplyLock} from '../src/lib/supplyLocks/recovery'
import {confirmSignatures,sendAndConfirmTransaction} from '../src/lib/transactions/send'

const endpoint='http://127.0.0.1:8899',allowed=new Set<string>()
async function prove(){const url=new URL(endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Only the isolated unauthenticated loopback runtime is allowed.');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getVersion',params:[]}),redirect:'error',signal:AbortSignal.timeout(10000)}),value=await response.json();if(!response.ok||value.error||value.result?.['surfnet-version']!=='1.6.1')throw new Error('The isolated Surfpool1.6.1 runtime was not proven.')}
const safeFetch:typeof fetch=async(url,options)=>{if(new URL(String(url)).origin!==new URL(endpoint).origin)throw new Error('Local supply-lock tests reject external requests.');const call=JSON.parse(String(options?.body));if(['sendTransaction','requestAirdrop'].includes(call.method)){await prove();const payer=call.method==='requestAirdrop'?call.params[0]:VersionedTransaction.deserialize(Buffer.from(call.params[0],'base64')).message.staticAccountKeys[0].toBase58();if(!allowed.has(payer))throw new Error('Only a fresh generated test payer may spend simulated SOL.')}return fetch(url,{...options,redirect:'error',signal:options?.signal??AbortSignal.timeout(20000)})}
const connection=new Connection(endpoint,{commitment:'confirmed',fetch:safeFetch,disableRetryOnRateLimit:true}),locks={request:async<T>(_name:string,_options:{ifAvailable:true},fn:(lock:object)=>Promise<T>)=>fn({})}
function storage(){const rows=new Map<string,string>();return{getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value)},removeItem:(key:string)=>{rows.delete(key)},publicSnapshot:()=>Object.fromEntries(rows)}}
function evidence(value:Record<string,unknown>){appendFileSync('work/supply-locks-localnet-proof.jsonl',JSON.stringify({timestamp:new Date().toISOString(),runtime:'Surfpool1.6.1',realSolSpent:false,...value})+'\n')}
async function send(payer:Keypair,ixs:TransactionInstruction[],extra:Keypair[]=[]){const latest=await connection.getLatestBlockhash('confirmed'),tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:latest.blockhash,instructions:ixs}).compileToV0Message());tx.sign([payer,...extra]);const result=await sendAndConfirmTransaction(connection,tx,{timeoutMs:10000,pollIntervalMs:50});expect(result.status,result.error).toBe('confirmed')}
async function setup(program:PublicKey){
 await prove();const payer=Keypair.generate();allowed.add(payer.publicKey.toBase58());const signature=await connection.requestAirdrop(payer.publicKey,5000000000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:50})).status).toBe('confirmed')
 const mint=Keypair.generate(),source=getAssociatedTokenAddressSync(mint.publicKey,payer.publicKey,false,program),is2022=program.equals(TOKEN_2022_PROGRAM_ID),metadata={mint:mint.publicKey,updateAuthority:payer.publicKey,name:'Disposable supply lock',symbol:'LOCK',uri:'https://example.com/local-lock.json',additionalMetadata:[]},space=is2022?getMintLen([ExtensionType.MetadataPointer]):MINT_SIZE,fullSpace=is2022?space+4+pack(metadata).length:space,rent=await connection.getMinimumBalanceForRentExemption(fullSpace)
 await send(payer,[SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,space,lamports:rent,programId:program}),...(is2022?[createInitializeMetadataPointerInstruction(mint.publicKey,null,mint.publicKey,program)]:[]),createInitializeMintInstruction(mint.publicKey,6,payer.publicKey,null,program),...(is2022?[createInitializeInstruction({programId:program,metadata:mint.publicKey,updateAuthority:payer.publicKey,mint:mint.publicKey,mintAuthority:payer.publicKey,name:metadata.name,symbol:metadata.symbol,uri:metadata.uri})]:[]),createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,source,payer.publicKey,mint.publicKey,program),createMintToInstruction(mint.publicKey,source,payer.publicKey,1000000000n,[],program),createSetAuthorityInstruction(mint.publicKey,payer.publicKey,AuthorityType.MintTokens,null,[],program)],[mint])
 return{payer,mint:mint.publicKey,source}
}
describe.skipIf(process.env.RUN_SUPPLY_LOCK_LOCALNET!=='1')('immutable supply locks on proven isolated Surfpool',()=>{
 it.each([TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID])('locks exact tokens through real Streamflow with signed simulation and preserved supply (%s)',async program=>{
  const {payer,mint,source}=await setup(program),disk=storage(),slot=await connection.getSlot('confirmed'),chainTime=await connection.getBlockTime(slot)
  if(chainTime===null)throw new Error('The local chain time is unavailable.')
  const input={version:1,mint:mint.toBase58(),payer:payer.publicKey.toBase58(),recipient:payer.publicKey.toBase58(),amountRaw:'100000000',unlockAt:chainTime+3600,priorityFeeLamports:'0'},guards={readSigner:()=>payer.publicKey.toBase58()},plan=await prepareSupplyLock(connection,input,guards,{storage:disk,locks})
  const result=await submitSupplyLock(connection,plan,{...guards,approved:true,signTransaction:async tx=>{tx.sign([payer]);return tx}},{storage:disk,locks})
  expect(result.status,result.error).toBe('confirmed');expect(readPendingSupplyLock(disk)).toBeNull();expect(readSupplyLockHistory(disk)[0].status).toBe('confirmed')
  const contract=decodeStream((await connection.getAccountInfo(new PublicKey(plan.intent.metadata),'confirmed'))!.data)
  expect(contract.depositedAmount.toString()).toBe('100000000');expect(contract.cancelableBySender).toBe(false);expect(contract.cliff.toString()).toBe(String(input.unlockAt))
  expect(unpackAccount(source,await connection.getAccountInfo(source),program).amount).toBe(1000000000n-BigInt(plan.intent.sourceDebitRaw))
  expect(unpackMint(mint,await connection.getAccountInfo(mint),program).supply).toBe(1000000000n)
  evidence({proof:'native-immutable-token-supply-lock',mint:mint.toBase58(),payer:payer.publicKey.toBase58(),tokenProgram:program.toBase58(),metadata:plan.intent.metadata,escrow:plan.intent.escrow,signature:result.signature,preview:plan.preview,receipts:readSupplyLockHistory(disk),browserStorage:disk.publicSnapshot()})
  console.log(JSON.stringify({proof:'signed-local-surfpool-streamflow-lock',realSolSpent:false,tokenProgram:program.toBase58(),signature:result.signature,metadata:plan.intent.metadata,netLockedRaw:plan.intent.amountRaw,tokenFeeRaw:plan.intent.tokenFeeRaw,solDebitLamports:plan.preview.maxDebitLamports}))
 },90000)
 it('preserves a real submitted lock as unknown and recovers its original without resubmission',async()=>{
  const {payer,mint}=await setup(TOKEN_PROGRAM_ID),disk=storage(),chainTime=await connection.getBlockTime(await connection.getSlot('confirmed'))
  if(chainTime===null)throw new Error('Local chain time is unavailable.')
  const input={version:1,mint:mint.toBase58(),payer:payer.publicKey.toBase58(),recipient:payer.publicKey.toBase58(),amountRaw:'1000000',unlockAt:chainTime+3600,priorityFeeLamports:'0'},guards={readSigner:()=>payer.publicKey.toBase58()},plan=await prepareSupplyLock(connection,input,guards,{storage:disk,locks});let sends=0
  const receipt=await submitSupplyLock(connection,plan,{...guards,approved:true,signTransaction:async tx=>{tx.sign([payer]);return tx}},{storage:disk,locks,send:async(conn,tx,options)=>{sends++;const result=await sendAndConfirmTransaction(conn,tx,{...options,timeoutMs:10000,pollIntervalMs:50});expect(result.status,result.error).toBe('confirmed');return{...result,status:'unknown'}}})
  expect(receipt.status).toBe('unknown');expect(readPendingSupplyLock(disk)?.signature).toBe(receipt.signature)
  await expect(prepareSupplyLock(connection,input,guards,{storage:disk,locks})).rejects.toThrow(/pending/i)
  expect((await reconcilePendingSupplyLock(connection,{storage:disk,locks})).status).toBe('confirmed');expect(sends).toBe(1);expect(readPendingSupplyLock(disk)).toBeNull()
  evidence({proof:'original-lock-recovered-with-one-broadcast',mint:mint.toBase58(),payer:payer.publicKey.toBase58(),signature:receipt.signature,broadcasts:sends,receipts:readSupplyLockHistory(disk),browserStorage:disk.publicSnapshot()})
 },90000)
})
