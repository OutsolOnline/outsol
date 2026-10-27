import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {simulateAtomicBundle} from '../src/lib/bundler/jito'
afterEach(()=>vi.unstubAllGlobals())
describe('complete buyer debit simulation',()=>{
 it('requests and validates the complete before and after balance for every participating wallet',async()=>{
  const payer=Keypair.generate().publicKey,buyer=Keypair.generate().publicKey
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:buyer,lamports:1})]}).compileToV0Message())
  let requested:string[]=[]
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{
   requested=JSON.parse(String(init.body)).params[1].preExecutionAccountsConfigs[0].addresses
   return Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:[{lamports:100},{lamports:200}],postExecutionAccounts:[{lamports:80},{lamports:150}]}]}}})
  })
  const result=await simulateAtomicBundle(new Connection('http://127.0.0.1:8899'),[tx],{payer:payer.toBase58(),accounts:[payer.toBase58(),buyer.toBase58()]})
  expect(requested).toEqual([payer.toBase58(),buyer.toBase58()])
  expect(result.walletDebitsLamports).toEqual({[payer.toBase58()]:'20',[buyer.toBase58()]:'50'})
  expect(result.payerDebitLamports).toBe('20')
 })
})
