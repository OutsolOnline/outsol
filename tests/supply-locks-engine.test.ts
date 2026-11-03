import {describe,expect,it} from 'vitest'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {prepareSupplyLock,submitSupplyLock,type SupplyLockPorts} from '../src/lib/supplyLocks/engine'
import {readPendingSupplyLock,readSupplyLockHistory,SUPPLY_LOCK_PENDING_KEY} from '../src/lib/supplyLocks/history'
import {signedTransactionSignature} from '../src/lib/transactions/send'

function fixture(){
 const payer=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58(),blockhash=Keypair.generate().publicKey.toBase58(),disk=new Map<string,string>(),storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}}
 const input={version:1,mint,payer:payer.publicKey.toBase58(),recipient:payer.publicKey.toBase58(),amountRaw:'1000000',unlockAt:2000000000,priorityFeeLamports:'0'}
 let signer:string|null=input.payer,sends=0
 const position={mint,payer:input.payer,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),decimals:6,supplyRaw:'1000000000',balanceRaw:'10000000',chainTime:1999990000,slot:100,feeUnits:5000,creationFeeLamports:'160000000',oracleData:'fee oracle bytes'}
 const preview={payerBeforeLamports:'1000000000',payerAfterLamports:'830000000',networkFeeLamports:'5000',rentLamports:'9995000',creationFeeLamports:'160000000',maxDebitLamports:'170000000',sourceBeforeRaw:'10000000',sourceAfterRaw:'8995000',lockedRaw:'1000000',tokenFeeRaw:'5000'}
 const connection={getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:500}),isBlockhashValid:async()=>({value:true}),getAccountInfo:async()=>null} as unknown as Connection
 const ports:Partial<SupplyLockPorts>={storage,locks:{request:async(_name,_options,fn)=>fn({})},nonce:()=>123,now:()=>100000,readPosition:async()=>({...position}),simulate:async()=>({...preview}),send:async(_connection,tx,options)=>{options.onBroadcast?.();sends++;return{status:'confirmed',submitted:true,signature:signedTransactionSignature(tx)}},build:async(_connection,intent,hash)=>{
  const {supplyLockAccounts}=await import('../src/lib/supplyLocks/native'),{createStreamV2Instruction}=await import('@streamflow/stream'),BN=(await import('bn.js')).default
  const instruction=await createStreamV2Instruction({start:new BN(intent.unlockAt),depositedAmount:new BN(intent.amountRaw),period:new BN(1),amountPerPeriod:new BN(1),cliff:new BN(intent.unlockAt),cliffAmount:new BN(intent.amountRaw),cancelableBySender:false,cancelableByRecipient:false,automaticWithdrawal:false,transferableBySender:false,transferableByRecipient:false,canTopup:false,canPause:false,canUpdateRate:false,name:'OutSol token supply lock',withdrawFrequency:new BN(1),nonce:intent.nonce},(await import('../src/lib/supplyLocks/model')).LOCK_PROGRAM,supplyLockAccounts(intent))
  instruction.data.writeUInt32LE(intent.nonce,136)
  const {ComputeBudgetProgram,TransactionMessage}=await import('@solana/web3.js'),{createAssociatedTokenAccountIdempotentInstruction}=await import('@solana/spl-token'),accounts=supplyLockAccounts(intent)
  return new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(intent.payer),recentBlockhash:hash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:1000000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:0}),createAssociatedTokenAccountIdempotentInstruction(accounts.sender,accounts.partnerTokens,accounts.partner,accounts.mint,accounts.tokenProgram),instruction]}).compileToV0Message())
 }}
 const options={approved:true,readSigner:()=>signer,signTransaction:async(tx:VersionedTransaction)=>{tx.sign([payer]);return tx}}
 return{payer,input,storage,disk,position,preview,connection,ports,options,setSigner:(value:string|null)=>{signer=value},sends:()=>sends}
}
describe('reviewed immutable supply-lock engine',()=>{
 it('records the original before one broadcast and saves a public confirmed escrow receipt',async()=>{
  const f=fixture(),review=await prepareSupplyLock(f.connection,f.input,f.options,f.ports)
  const result=await submitSupplyLock(f.connection,review,{...f.options,onPending:record=>expect(readPendingSupplyLock(f.storage)?.signature).toBe(record.signature)},f.ports)
  expect(result.status).toBe('confirmed');expect(f.sends()).toBe(1);expect(readPendingSupplyLock(f.storage)).toBeNull();expect(readSupplyLockHistory(f.storage)[0].intent.amountRaw).toBe('1000000')
  await expect(submitSupplyLock(f.connection,review,f.options,f.ports)).rejects.toThrow()
 })
 it('fails closed on stale fees, insufficient holdings, nearby unlock time and malformed existing pending data',async()=>{
  for(const step of ['fees','balance','time','pending']){
   const f=fixture()
   if(step==='balance')f.position.balanceRaw='1000000'
   if(step==='time')f.position.chainTime=f.input.unlockAt-100
   if(step==='pending')f.disk.set(SUPPLY_LOCK_PENDING_KEY,'{')
   if(step!=='fees'){await expect(prepareSupplyLock(f.connection,f.input,f.options,f.ports)).rejects.toThrow();continue}
   const review=await prepareSupplyLock(f.connection,f.input,f.options,f.ports);f.position.feeUnits=6000
   await expect(submitSupplyLock(f.connection,review,f.options,f.ports)).rejects.toThrow(/changed|fee/i)
   expect(f.sends()).toBe(0)
  }
 })
 it('does not send when the signer locks after approval or when signed simulation increases the reviewed debit',async()=>{
  for(const step of ['signer','cost']){
   const f=fixture(),review=await prepareSupplyLock(f.connection,f.input,f.options,f.ports)
   if(step==='signer'){const sign=f.options.signTransaction;f.options.signTransaction=async tx=>{const value=await sign(tx);f.setSigner(null);return value}}
   else f.preview.maxDebitLamports='170000001'
   await expect(submitSupplyLock(f.connection,review,f.options,f.ports)).rejects.toThrow()
   expect(f.sends()).toBe(0)
  }
 })
 it('keeps an unknown submitted original after a lost response and blocks a fresh lock',async()=>{
  const f=fixture(),review=await prepareSupplyLock(f.connection,f.input,f.options,f.ports)
  f.ports.send=async(_connection,_tx,options)=>{options.onBroadcast?.();throw new Error('Lost response')}
  const result=await submitSupplyLock(f.connection,review,f.options,f.ports)
  expect(result.status).toBe('unknown');expect(readPendingSupplyLock(f.storage)?.signature).toBe(result.signature)
  await expect(prepareSupplyLock(f.connection,f.input,f.options,f.ports)).rejects.toThrow(/pending/i)
 })
})
