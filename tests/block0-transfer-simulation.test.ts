import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {simulateAtomicBundle} from '../src/lib/bundler/jito'
afterEach(()=>vi.unstubAllGlobals())
function fixture(){
 const payer=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,account=getAssociatedTokenAddressSync(mint,recipient,false,TOKEN_2022_PROGRAM_ID),transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:recipient,lamports:1})]}).compileToV0Message())
 const token=(raw:bigint)=>{const bytes=Buffer.alloc(165);mint.toBuffer().copy(bytes,0);recipient.toBuffer().copy(bytes,32);bytes.writeBigUInt64LE(raw,64);bytes[108]=1;return {owner:TOKEN_2022_PROGRAM_ID.toBase58(),lamports:2039280,executable:false,data:[bytes.toString('base64'),'base64']}}
 const expectation={address:account.toBase58(),owner:recipient.toBase58(),mint:mint.toBase58(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),expectedDeltaRaw:'200'}
 const before=[{lamports:10000},token(700n)],after=[{lamports:5000},token(900n)]
 return {payer,recipient,mint,transaction,token,expectation,before,after,connection:new Connection('http://127.0.0.1:8899')}
}
describe('complete-bank token evidence is independent from wallet SOL costs',()=>{
 it('requests the token accounts with both snapshots and verifies preservation of earlier holdings',async()=>{
  const h=fixture();let addresses:string[]=[]
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{const body=JSON.parse(String(init.body));addresses=body.params[1].preExecutionAccountsConfigs[0].addresses;expect(body.params[1].postExecutionAccountsConfigs[0].addresses).toEqual(addresses);return Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:h.before,postExecutionAccounts:h.after}]}}})})
  const result=await simulateAtomicBundle(h.connection,[h.transaction],{payer:h.payer.toBase58(),accounts:[h.payer.toBase58()],tokenAccounts:[h.expectation]})
  expect(result.success,result.error).toBe(true);expect(addresses).toEqual([h.payer.toBase58(),h.expectation.address]);expect(result.walletDebitsLamports).toEqual({[h.payer.toBase58()]:'5000'});expect(result.tokenAccountDeltasRaw).toEqual({[h.expectation.address]:'200'})
 })
 it('accepts a missing pre-account and rejects missing or malformed post-accounts and wrong identity/delta',async()=>{
  const h=fixture();let before:unknown[]=[{lamports:10000},null],after:unknown[]=[{lamports:5000},h.token(200n)]
  vi.stubGlobal('fetch',async()=>Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:before,postExecutionAccounts:after}]}}}))
  const run=()=>simulateAtomicBundle(h.connection,[h.transaction],{verifySignatures:true,payer:h.payer.toBase58(),tokenAccounts:[h.expectation]})
  expect((await run()).success).toBe(true)
  for(const bad of [null,undefined,{...h.token(200n),owner:TOKEN_PROGRAM_ID.toBase58()},{...h.token(200n),data:['','base64']},h.token(201n),{...h.token(200n),executable:true}]){after=[{lamports:5000},bad];expect((await run()).success).toBe(false)}
  const bytes=Buffer.from(h.token(200n).data[0],'base64');Keypair.generate().publicKey.toBuffer().copy(bytes,0);after=[{lamports:5000},{...h.token(200n),data:[bytes.toString('base64'),'base64']}];expect((await run()).success).toBe(false)
  bytes.set(h.mint.toBuffer(),0);Keypair.generate().publicKey.toBuffer().copy(bytes,32);after=[{lamports:5000},{...h.token(200n),data:[bytes.toString('base64'),'base64']}];expect((await run()).success).toBe(false)
  before=[{lamports:10000}];after=[{lamports:5000},h.token(200n)];expect((await run()).success).toBe(false)
 })
 it('aggregates an account identity only once and enforces the RPC proxy inspection bound',async()=>{
  const h=fixture();let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:h.before,postExecutionAccounts:h.after}]}}})})
  const duplicate=await simulateAtomicBundle(h.connection,[h.transaction],{payer:h.payer.toBase58(),tokenAccounts:[h.expectation,{...h.expectation,expectedDeltaRaw:'1'}]})
  expect(duplicate.success).toBe(false);expect(calls).toBe(0)
  const tooMany=await simulateAtomicBundle(h.connection,[h.transaction],{accounts:Array.from({length:20},()=>Keypair.generate().publicKey.toBase58()),tokenAccounts:[h.expectation]})
  expect(tooMany.success).toBe(false);expect(calls).toBe(0)
 })
})
