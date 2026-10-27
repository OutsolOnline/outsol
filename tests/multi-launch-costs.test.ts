import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {simulateMultiLaunchCosts} from '../src/lib/multiLaunch/costs'

afterEach(()=>vi.unstubAllGlobals())
function context(){const payer=Keypair.generate().publicKey,packet=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:payer,lamports:0})]}).compileToV0Message());return {connection:{rpcEndpoint:'https://rpc.invalid'} as Connection,payer:payer.toBase58(),packet}}
function result(before:number,after:number){return {err:null,preExecutionAccounts:[{lamports:before}],postExecutionAccounts:[{lamports:after}]}}
describe('complete ordered multi-launch cost preview',()=>{
 it('uses each token’s actual before/after snapshots in one bank and adds the exact row debits',async()=>{
  const f=context()
  vi.stubGlobal('fetch',async()=>Response.json({result:{value:{summary:'succeeded',transactionResults:[result(10000,7000),result(7000,5000)]}}}))
  expect(await simulateMultiLaunchCosts(f.connection,[[f.packet],[f.packet]],{payer:f.payer})).toEqual({rowDebitsLamports:['3000','2000'],totalDebitLamports:'5000'})
 })
 it('fails closed if the provider gives independently simulated banks instead of an ordered bank',async()=>{
  const f=context()
  vi.stubGlobal('fetch',async()=>Response.json({result:{value:{summary:'succeeded',transactionResults:[result(10000,7000),result(10000,8000)]}}}))
  await expect(simulateMultiLaunchCosts(f.connection,[[f.packet],[f.packet]],{payer:f.payer})).rejects.toThrow(/one ordered.*bank/i)
 })
 it('rejects incomplete and unsafe numeric wallet snapshots',async()=>{
  const f=context()
  for(const first of [result(Number.MAX_SAFE_INTEGER+1,7000),result(10000,-1),{err:null,preExecutionAccounts:[],postExecutionAccounts:[{lamports:7000}]}]){
   vi.stubGlobal('fetch',async()=>Response.json({result:{value:{summary:'succeeded',transactionResults:[first,result(7000,5000)]}}}))
   await expect(simulateMultiLaunchCosts(f.connection,[[f.packet],[f.packet]],{payer:f.payer})).rejects.toThrow(/debit.*verified/i)
  }
 })
 it('refuses a sequence above the five-packet limit before requesting a misleading partial quote',async()=>{
  const f=context()
  vi.stubGlobal('fetch',()=>{throw new Error('No network call is allowed')})
  await expect(simulateMultiLaunchCosts(f.connection,[[f.packet,f.packet,f.packet],[f.packet,f.packet,f.packet]],{payer:f.payer})).rejects.toThrow(/five packets/i)
 })
})
