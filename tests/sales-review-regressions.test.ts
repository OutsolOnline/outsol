import {describe,expect,it} from 'vitest'
import {Connection,Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {prepareSaleBatch,executeSaleBatch,type SaleBatchPorts,type SaleRequest} from '../src/lib/sales/batch'
import type {PreparedMarketSale} from '../src/lib/sales/market'
import {signedTransactionSignature} from '../src/lib/transactions/send'

describe('sale transport capability independent review',()=>{
 it('cannot broadcast alternate serialized bytes hidden behind the approved message after wallet signing',async()=>{
  const payer=Keypair.generate(),destination=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,blockhash=Keypair.generate().publicKey.toBase58(),values=new Map<string,string>(),sentMessages:string[]=[]
  const tx=(lamports:number)=>new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:destination,lamports})]}).compileToV0Message())
  const reviewed=tx(1),alternate=tx(999999);alternate.sign([payer])
  const input:SaleRequest={walletId:'reviewed-wallet',walletName:'Reviewed source',payer:payer.publicKey.toBase58(),mint:mint.toBase58(),tokenProgram:TOKEN_PROGRAM_ID.toBase58(),amountRaw:'100',decimals:6}
  const connection={getBalance:async()=>10000000} as unknown as Connection
  const ports:SaleBatchPorts={storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}},locks:{request:async(_n,_o,callback)=>callback({})},assertAvailable:()=>{},now:Date.now,
   prepare:async(_connection,configuration)=>({input:configuration,transaction:VersionedTransaction.deserialize(reviewed.serialize()),message:Buffer.from(reviewed.message.serialize()).toString('base64'),route:'jupiter',payer:input.payer,mint:input.mint,amountRaw:'100',minimumSolOut:'100000',estimatedSolOut:'100000',estimatedNetSolOut:'95000',networkFeeLamports:'5000',maxDebitLamports:'5000',createdAt:Date.now(),lastValidBlockHeight:100,tokenAccount:Keypair.generate().publicKey.toBase58()}) as PreparedMarketSale,
   assert:(_plan,transaction)=>{if(!Buffer.from(transaction.message.serialize()).equals(Buffer.from(reviewed.message.serialize())))throw new Error('Changed review message')},
   simulateSigned:async(_connection,_plan,transaction)=>{const actual=VersionedTransaction.deserialize(transaction.serialize());expect(Buffer.from(actual.message.serialize()).equals(Buffer.from(reviewed.message.serialize()))).toBe(true);return{walletBeforeLamports:'10000000',netDebitLamports:'0',networkFeeLamports:'5000'}},
   send:async(_connection,transaction,options)=>{options.onBroadcast?.();sentMessages.push(Buffer.from(VersionedTransaction.deserialize(transaction.serialize()).message.serialize()).toString('base64'));return{status:'confirmed',signature:signedTransactionSignature(transaction),submitted:true}},
  }
  const review=await prepareSaleBatch(connection,[input],{slippageBps:500,priorityFeeLamports:'0'},ports)
  await executeSaleBatch(connection,review,{approved:true,readSigner:()=>input.payer,sign:async(_id,transaction)=>{
   transaction.sign([payer]);let reads=0;const original=transaction.serialize.bind(transaction)
   transaction.serialize=()=>++reads<=2?original():alternate.serialize()
   return transaction
  }},ports)
  expect(sentMessages.every(value=>value===Buffer.from(reviewed.message.serialize()).toString('base64'))).toBe(true)
 })
})
