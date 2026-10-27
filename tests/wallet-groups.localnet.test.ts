import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {Connection,Keypair,VersionedTransaction} from '@solana/web3.js'
import {confirmSignatures} from '../src/lib/transactions/send'
import {prepareGroupOperation} from '../src/lib/walletGroups/prepare'
import {submitReviewedGroupOperation} from '../src/lib/walletGroups/submission'
import {reconcilePendingGroupOperation} from '../src/lib/walletGroups/recovery'
import {readGroupOperationHistory,readPendingGroupOperation} from '../src/lib/walletGroups/history'
import type {GroupWallet} from '../src/lib/walletGroups/types'
import type {WalletOperationLocks} from '../src/lib/walletOperations/recovery'

const endpoint=process.env.VANITY_LOCALNET_RPC||'http://127.0.0.1:8899'
const nativeFetch=globalThis.fetch,owned=new Map<string,Keypair>()
let rpcCount=0,sendCount=0
const rpcMethods=new Map<string,number>()
const evidence:Record<string,string|number|boolean>[]=[]
const locks:WalletOperationLocks={request:async(_name,_options,callback)=>callback({})}
const memory=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
async function proveRuntime(){const url=new URL(endpoint);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.search||url.hash||url.username||url.password||url.pathname!=='/')throw new Error('Group tests require a private loopback runtime.');const response=await nativeFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getVersion'}),signal:AbortSignal.timeout(10000)});const data=await response.json();if(data.result?.['surfnet-version']!=='1.6.1')throw new Error('Group tests require identified Surfpool1.6.1.');}
const guardedFetch:typeof fetch=async(resource,init)=>{
 if(new URL(String(resource)).origin!==new URL(endpoint).origin)throw new Error('Group tests deny non-loopback requests.')
 const call=JSON.parse(String(init?.body));rpcCount++;rpcMethods.set(call.method,(rpcMethods.get(call.method)||0)+1)
 if(['sendTransaction','requestAirdrop'].includes(call.method)){
  await proveRuntime()
  const payer=call.method==='requestAirdrop'?call.params[0]:VersionedTransaction.deserialize(Buffer.from(call.params[0],'base64')).message.staticAccountKeys[0].toBase58()
  if(!owned.has(payer))throw new Error('Only fresh test-generated wallets may spend simulated SOL.')
  if(call.method==='sendTransaction')sendCount++
 }
 return nativeFetch(resource,{...init,redirect:'error',signal:init?.signal||AbortSignal.timeout(20000)})
}
const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guardedFetch,disableRetryOnRateLimit:true})
function fresh():Keypair{const key=Keypair.generate();owned.set(key.publicKey.toBase58(),key);return key}
function members(count:number):GroupWallet[]{return Array.from({length:count},(_,index)=>({id:crypto.randomUUID(),name:`Group wallet${index+1}`,address:fresh().publicKey.toBase58()}))}
async function funder(){const key=fresh();const signature=await connection.requestAirdrop(key.publicKey,5000000000);expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:20})).status).toBe('confirmed');return key}
function options(storage=memory()){return{approved:true,storage,locks,assertAvailable:()=>{},canSign:(payer:string)=>owned.has(payer),signTransaction:async(payer:string,tx:VersionedTransaction)=>{const key=owned.get(payer);if(!key)throw new Error('Test signer locked.');tx.sign([key]);return tx},timeoutMs:10000,pollIntervalMs:20}}

describe.skipIf(process.env.RUN_GROUP_LOCALNET!=='1')('managed wallet groups on real isolated Surfpool',()=>{
 beforeEach(()=>{vi.stubGlobal('fetch',guardedFetch);rpcCount=0;sendCount=0;rpcMethods.clear()})
 afterEach(()=>vi.unstubAllGlobals())
 afterAll(()=>{if(process.env.WALLET_GROUP_REPORT_FILE)writeFileSync(process.env.WALLET_GROUP_REPORT_FILE,JSON.stringify({checkedAt:new Date().toISOString(),runtime:'Surfpool1.6.1',network:'loopback-mainnet-fork',realSolSpent:false,cases:evidence},null,2))})
 it('creates, bulk-imports, groups, reloads/unlocks, funds, and withdraws the complete managed group',async()=>{
  const storage=memory();vi.stubGlobal('localStorage',storage);vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{addEventListener:()=>{},removeEventListener:()=>{},dispatchEvent:()=>true,location:{origin:'http://localhost'}})
  const {useWalletLibraryStore:store}=await import('../src/stores/walletLibraryStore')
  await store.getState().ready()
  await store.getState().createWallets({count:3,prefix:'Created',passphrase:'group-local-test-passphrase'})
  const imported=[fresh(),fresh()]
  await store.getState().importWallets({text:JSON.stringify(imported.map(key=>({secretKey:Array.from(key.secretKey)}))),prefix:'Imported',passphrase:'group-local-test-passphrase'})
  const all=store.getState().wallets
  expect(all).toHaveLength(5)
  const group=await store.getState().createGroup('Launch team',all.map(wallet=>wallet.id))
  const selected=store.getState().groups.find(value=>value.id===(typeof group==='string'?group:(group as {id:string}).id))||store.getState().groups[0]
  expect(selected.name).toBe('Launch team');expect(selected.walletIds).toHaveLength(5)
  for(const wallet of all){const key=store.getState().getKeypair(wallet.id);expect(key).not.toBeNull();owned.set(wallet.publicKey,key!)}
  store.getState().lockAll();expect(store.getState().unlockedIds).toEqual([])
  // A fresh module reads the exact encrypted storage left by the prior session.
  vi.resetModules()
  const {useWalletLibraryStore:reloaded}=await import('../src/stores/walletLibraryStore')
  await reloaded.getState().ready();expect(reloaded.getState().unlockedIds).toEqual([]);expect(reloaded.getState().groups[0].walletIds).toHaveLength(5)
  await reloaded.getState().unlockWallets(selected.walletIds,'group-local-test-passphrase')
  const wallets:GroupWallet[]=reloaded.getState().wallets.map(wallet=>({id:wallet.id,name:wallet.name,address:wallet.publicKey})),payer=await funder()
  const funded=await prepareGroupOperation(connection,{kind:'fund',groupId:selected.id,groupName:selected.name,wallets,payer:payer.publicKey.toBase58(),amountSol:'0.01',priorityFeeSol:'0.00001'})
  const transfer=await submitReviewedGroupOperation(connection,funded,options(storage))
  expect(transfer.status,transfer.error).toBe('confirmed');for(const wallet of wallets)expect(await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(wallet.address))).toBe(10000000)
  const destination=fresh().publicKey.toBase58()
  const fixed=await prepareGroupOperation(connection,{kind:'withdraw',groupId:selected.id,groupName:selected.name,wallets,destination,amountMode:'fixed',amountSol:'0.001',reserveSol:'0',priorityFeeSol:'0'})
  const fixedReceipt=await submitReviewedGroupOperation(connection,fixed,options(storage));expect(fixedReceipt.status,fixedReceipt.error).toBe('confirmed')
  const available=await prepareGroupOperation(connection,{kind:'withdraw',groupId:selected.id,groupName:selected.name,wallets,destination,amountMode:'available',reserveSol:'0',priorityFeeSol:'0.00001'})
  const callbacks={...options(storage),canSign:(address:string)=>{const wallet=reloaded.getState().wallets.find(wallet=>wallet.publicKey===address);return!!wallet&&!!reloaded.getState().getKeypair(wallet.id)},signTransaction:async(address:string,tx:VersionedTransaction)=>{const wallet=reloaded.getState().wallets.find(wallet=>wallet.publicKey===address)!;const key=reloaded.getState().getKeypair(wallet.id);if(!key)throw new Error('Test library locked.');tx.sign([key]);return tx}}
  const withdrawn=await submitReviewedGroupOperation(connection,available,callbacks)
  expect(withdrawn.status,withdrawn.error).toBe('confirmed');for(const wallet of wallets)expect(await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(wallet.address))).toBe(0)
  expect(readPendingGroupOperation(storage)).toBeNull();expect(readGroupOperationHistory(storage)).toHaveLength(3)
  expect(String(await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(destination)))).toBe(available.summary.destinationAfterLamports)
  console.log(JSON.stringify({proof:'managed-wallet-group-complete-local-execution',created:3,bulkImported:2,groupSize:5,encryptedReload:true,fundingPackets:funded.transactions.length,fixedWithdrawals:fixed.transactions.length,availableWithdrawals:available.transactions.length,allGroupWalletsDrained:true,realSolSpent:false}))
  evidence.push({case:'create/import/group/reload/fund/fixed-withdraw/drain',created:3,bulkImported:2,groupSize:5,encryptedReload:true,fundingPackets:funded.transactions.length,fixedWithdrawals:fixed.transactions.length,availableWithdrawals:available.transactions.length,allGroupWalletsDrained:true,passed:true})
 },120000)
 it('funds and drains 20 wallets while leaving RPC headroom for ordinary account refreshes',async()=>{
  const payer=await funder(),wallets=members(20),storage=memory(),destination=fresh().publicKey.toBase58()
  const plan=await prepareGroupOperation(connection,{kind:'fund',groupName:'Twenty wallets',wallets,payer:payer.publicKey.toBase58(),amountSol:'0.01',priorityFeeSol:'0'})
  expect(plan.transactions).toHaveLength(3)
  const receipt=await submitReviewedGroupOperation(connection,plan,options(storage));expect(receipt.status,receipt.error).toBe('confirmed')
  rpcCount=0;rpcMethods.clear()
  const withdrawals=await prepareGroupOperation(connection,{kind:'withdraw',groupName:'Twenty wallets',wallets,destination,amountMode:'available',reserveSol:'0',priorityFeeSol:'0'})
  expect(withdrawals.transactions).toHaveLength(20)
  const done=await submitReviewedGroupOperation(connection,withdrawals,options(storage))
  expect(done.status,done.error).toBe('confirmed');expect(rpcCount).toBeLessThanOrEqual(240);expect(rpcMethods.get('getFeeForMessage')).toBe(1)
  console.log(JSON.stringify({proof:'twenty-wallet-group-local-execution',fundingPackets:3,withdrawalPackets:20,withdrawalRpcCalls:rpcCount,realSolSpent:false}))
  evidence.push({case:'twenty-wallet whole-group funding and available withdrawal',fundingPackets:3,withdrawalPackets:20,withdrawalRpcCalls:rpcCount,passed:true})
 },120000)
 it('stops on an unknown first funding packet and recovers its original signature without a resend',async()=>{
  const payer=await funder(),wallets=members(9),storage=memory(),plan=await prepareGroupOperation(connection,{kind:'fund',groupName:'Recovery group',wallets,payer:payer.publicKey.toBase58(),amountSol:'0.001',priorityFeeSol:'0'})
  const unknown=new Proxy(connection,{get(target,key){if(key==='getSignatureStatuses')return async()=>({context:{slot:1},value:[null]});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
  const before=sendCount,receipt=await submitReviewedGroupOperation(unknown,plan,{...options(storage),timeoutMs:100,pollIntervalMs:20})
  expect(receipt.status).toBe('unknown');expect(sendCount-before).toBe(1);expect(receipt.packets[1].status).toBe('not-submitted')
  const sent=sendCount,recovered=await reconcilePendingGroupOperation(connection,{storage,locks})
  expect(recovered?.status).toBe('partial');expect(sendCount).toBe(sent);expect(readPendingGroupOperation(storage)).toBeNull()
  evidence.push({case:'unknown submission recovers original signature without resend',packetsSent:1,remainingNotSubmitted:true,passed:true})
 },60000)
 it('cancels after one confirmed packet and preserves the completed transfers without sending the remainder',async()=>{
  const payer=await funder(),wallets=members(9),storage=memory(),controller=new AbortController(),plan=await prepareGroupOperation(connection,{kind:'fund',groupName:'Cancel group',wallets,payer:payer.publicKey.toBase58(),amountSol:'0.001',priorityFeeSol:'0'})
  const before=sendCount,receipt=await submitReviewedGroupOperation(connection,plan,{...options(storage),signal:controller.signal,onProgress:record=>{if(record.packets[0].status==='confirmed')controller.abort()}})
  expect(receipt.status).toBe('partial');expect(sendCount-before).toBe(1);expect(receipt.packets[0].status).toBe('confirmed');expect(receipt.packets[1].status).toBe('not-submitted');expect(readPendingGroupOperation(storage)).toBeNull()
  evidence.push({case:'cancellation preserves confirmed transfers and stops remainder',packetsSent:1,remainingNotSubmitted:true,passed:true})
 },60000)
})
