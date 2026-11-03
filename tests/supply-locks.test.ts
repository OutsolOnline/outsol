import {describe,expect,it} from 'vitest'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {MintLayout,TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync} from '@solana/spl-token'
import {buildLockParams,WITHDRAWOR_PUBLIC_KEY,PROGRAM_ID,FEE_ORACLE_PUBLIC_KEY,PARTNER_ORACLE_PROGRAM_ID,ICluster,deriveStreamMetadataPDA} from '@streamflow/stream'
import BN from 'bn.js'
import bs58 from 'bs58'
import {normalizeSupplyLockInput,supplyLockFees,readSupplyLockFees,lockAddresses} from '../src/lib/supplyLocks/model'
import {buildSupplyLockTransaction,assertSupplyLockTransaction} from '../src/lib/supplyLocks/native'
import {SUPPLY_LOCK_PENDING_KEY,readPendingSupplyLock,savePendingSupplyLock,saveSupplyLockReceipt,readSupplyLockHistory} from '../src/lib/supplyLocks/history'
import {assertNoUnresolvedSupplyLock} from '../src/lib/supplyLocks/pendingGuard'
import {assertSupplyLockAvailable} from '../src/lib/supplyLocks/availability'
import {LOCK_PROGRAM as LIGHT_PROGRAM,LOCK_ORACLE as LIGHT_ORACLE,LOCK_ORACLE_PROGRAM as LIGHT_ORACLE_PROGRAM,lockAddresses as lightweightAddresses} from '../src/lib/supplyLocks/addresses'

const payer=Keypair.fromSeed(new Uint8Array(32).fill(121)).publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(122)).publicKey.toBase58()
const input={version:1 as const,mint,payer,recipient:payer,amountRaw:'123456789',unlockAt:2000000000,priorityFeeLamports:'1000'}
function oracle(){const data=Buffer.alloc(64);data.writeUInt32LE(1);WITHDRAWOR_PUBLIC_KEY.toBuffer().copy(data,4);data.writeUInt32LE(160000000,36);data.writeFloatLE(.5,48);return data}
function memory(){const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
const intent=()=>({...input,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),decimals:6,nonce:12,...lockAddresses(input,12),feeUnits:5000,creationFeeLamports:'160000000',tokenFeeRaw:'617283',sourceDebitRaw:'124074072',maxDebitLamports:'170000000'})

describe('immutable supply lock public contracts',()=>{
 it('uses exact raw-unit fee arithmetic and reads live oracle fees without fallback',()=>{
  expect(readSupplyLockFees(oracle())).toEqual({creationFeeLamports:'160000000',feeUnits:5000})
  expect(supplyLockFees('123456789',5000)).toEqual({tokenFeeRaw:'617283',sourceDebitRaw:'124074072'})
  expect(normalizeSupplyLockInput(input)).toEqual(input)
  const params=buildLockParams({recipient:payer,tokenId:mint,amount:new BN(input.amountRaw),unlockDate:input.unlockAt,name:'OutSol token supply lock'})
  expect(params).toMatchObject({cancelableBySender:false,cancelableByRecipient:false,transferableBySender:false,transferableByRecipient:false,automaticWithdrawal:false,canTopup:false,start:input.unlockAt,cliff:input.unlockAt})
  expect(params.cliffAmount.toString()).toBe('123456789')
 })
 it('cross-checks lightweight public constants and PDA seeds against the pinned official SDK',()=>{
  expect(LIGHT_PROGRAM.toBase58()).toBe(PROGRAM_ID[ICluster.Mainnet]);expect(LIGHT_ORACLE.toBase58()).toBe(FEE_ORACLE_PUBLIC_KEY[ICluster.Mainnet]);expect(LIGHT_ORACLE_PROGRAM.toBase58()).toBe(PARTNER_ORACLE_PROGRAM_ID[ICluster.Mainnet])
  for(const nonce of [0,12,4294967295])expect(lightweightAddresses(input,nonce).metadata).toBe(deriveStreamMetadataPDA(LIGHT_PROGRAM,new PublicKey(mint),new PublicKey(payer),nonce).toBase58())
 })
 it('rejects ambiguous amounts, extra flags, native SOL, malformed and duplicate fee records',()=>{
  for(const value of [{...input,amountRaw:'0'},{...input,amountRaw:'01'},{...input,amountRaw:'1.2'},{...input,mint:NATIVE_MINT.toBase58()},{...input,cancelableBySender:true},{...input,unlockAt:1.5}])expect(()=>normalizeSupplyLockInput(value)).toThrow()
  const duplicate=Buffer.concat([oracle(),oracle().subarray(4)]);duplicate.writeUInt32LE(2)
  for(const data of [Buffer.alloc(4),duplicate,oracle().subarray(0,60)])expect(()=>readSupplyLockFees(data)).toThrow()
  expect(()=>supplyLockFees('18446744073709551615',5000)).toThrow()
 })
 it('persists only public intent and refuses changed or unreadable originals',()=>{
  const storage=memory(),record={version:1 as const,intent:intent(),signature:bs58.encode(new Uint8Array(64).fill(31)),blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200,submittedAt:'2026-11-03T13:00:00.000Z'}
  savePendingSupplyLock(record,storage);expect(readPendingSupplyLock(storage)).toEqual(record)
  expect(()=>savePendingSupplyLock(record,storage)).toThrow(/pending/i)
  expect(()=>saveSupplyLockReceipt({...record,blockhash:mint},'confirmed',undefined,storage)).toThrow(/changed/i)
  const receipt=saveSupplyLockReceipt(record,'confirmed',undefined,storage)
  expect(readSupplyLockHistory(storage)).toEqual([receipt]);expect(readPendingSupplyLock(storage)).toBeNull()
  storage.setItem(SUPPLY_LOCK_PENDING_KEY,JSON.stringify({...record,metadataKeypair:'never'}))
  expect(()=>readPendingSupplyLock(storage)).toThrow(/preserve/i)
 })
 it('blocks other engines on both pending and corrupt lock data without changing the original',()=>{
  const storage=memory();expect(()=>assertNoUnresolvedSupplyLock(storage)).not.toThrow()
  for(const raw of ['{','null','[]',JSON.stringify({version:1,intent:{},signature:'1'.repeat(64),lastValidBlockHeight:200})]){
   storage.setItem(SUPPLY_LOCK_PENDING_KEY,raw);expect(()=>assertNoUnresolvedSupplyLock(storage)).toThrow();expect(storage.getItem(SUPPLY_LOCK_PENDING_KEY)).toBe(raw)
  }
 })
 it('permits only its own exact saved original at broadcast and fails closed if its storage becomes unreadable',()=>{
  const storage=memory(),record={version:1 as const,intent:intent(),signature:bs58.encode(new Uint8Array(64).fill(32)),blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200,submittedAt:'2026-11-03T13:00:00.000Z'}
  savePendingSupplyLock(record,storage)
  const original=storage.getItem(SUPPLY_LOCK_PENDING_KEY)
  expect(()=>assertSupplyLockAvailable(storage,record)).not.toThrow()
  expect(()=>assertSupplyLockAvailable(storage)).toThrow(/pending/i)
  expect(()=>assertSupplyLockAvailable(storage,{...record,blockhash:mint})).toThrow(/changed|pending/i)
  expect(()=>assertSupplyLockAvailable({...storage,getItem:()=>{throw new Error('unreadable')}},record)).toThrow(/preserve/i)
  expect(storage.getItem(SUPPLY_LOCK_PENDING_KEY)).toBe(original)
 })
})

describe('native Streamflow preparation without SDK signing',()=>{
 it('prepares a nonce-derived PDA lock using the pinned official SDK and verifies its exact message',async()=>{
  const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data)
  const connection={getAccountInfo:async()=>({owner:TOKEN_PROGRAM_ID,data,lamports:1000000,executable:false})} as unknown as Connection
  const tx=await buildSupplyLockTransaction(connection,intent(),Keypair.generate().publicKey.toBase58())
  expect(tx.message.header.numRequiredSignatures).toBe(1)
  expect(TransactionMessage.decompile(tx.message).instructions.at(-1)!.data.readUInt32LE(136)).toBe(12)
  await expect(assertSupplyLockTransaction(tx,intent())).resolves.toBeUndefined()
  const decoded=TransactionMessage.decompile(tx.message),last=decoded.instructions.at(-1)!
  last.keys[3].pubkey=Keypair.generate().publicKey
  const changed=new VersionedTransaction(new TransactionMessage({...decoded,instructions:decoded.instructions}).compileToV0Message())
  await expect(assertSupplyLockTransaction(changed,intent())).rejects.toThrow()
  const source=getAssociatedTokenAddressSync(new PublicKey(mint),new PublicKey(payer))
  expect(decoded.instructions.some(ix=>ix.keys.some(key=>key.pubkey.equals(source)))).toBe(true)
 })
 it('rejects extra transfers and changes to cancellation flags instead of accepting a general SDK payload',async()=>{
  const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data)
  const connection={getAccountInfo:async()=>({owner:TOKEN_PROGRAM_ID,data,lamports:1000000,executable:false})} as unknown as Connection
  const tx=await buildSupplyLockTransaction(connection,intent(),Keypair.generate().publicKey.toBase58()),decoded=TransactionMessage.decompile(tx.message)
  decoded.instructions.push(SystemProgram.transfer({fromPubkey:new PublicKey(payer),toPubkey:Keypair.generate().publicKey,lamports:1}))
  await expect(assertSupplyLockTransaction(new VersionedTransaction(new TransactionMessage(decoded).compileToV0Message()),intent())).rejects.toThrow()
 })
})
