import {afterEach,describe,expect,it,vi} from 'vitest'
import {Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import bs58 from 'bs58'
import {createTransactionRacer,readSubmissionProviders} from '../src/lib/server/providerRacing'
afterEach(()=>vi.unstubAllEnvs())
function transaction(){const key=Keypair.generate(),tx=new VersionedTransaction(new TransactionMessage({payerKey:key.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message());tx.sign([key]);return {jsonrpc:'2.0',id:42,method:'sendTransaction',params:[Buffer.from(tx.serialize()).toString('base64'),{encoding:'base64',skipPreflight:false,maxRetries:0}]}}
describe('identical-packet provider submission',()=>{
 it('broadcasts identical already-signed bytes only to verified mainnet providers and accepts only the original signature',async()=>{
  const call=transaction(),signature=bs58.encode(VersionedTransaction.deserialize(Buffer.from(call.params[0] as string,'base64')).signatures[0]),sent:{url:string;body:unknown}[]=[]
  const racer=createTransactionRacer(async(url,init)=>{const value=JSON.parse(String(init?.body));if(value.method==='getGenesisHash')return Response.json({jsonrpc:'2.0',id:value.id,result:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'});sent.push({url:String(url),body:value});return Response.json({jsonrpc:'2.0',id:42,result:String(url).includes('one')?'wrong signature':signature})})
  expect(await racer(call,['https://one.example/private','https://two.example/private'])).toEqual({jsonrpc:'2.0',id:42,result:signature})
  expect(sent).toHaveLength(2);expect(sent.map(row=>row.body)).toEqual([call,call])
 })
 it('does not send to a different network and never exposes provider failures or credentials',async()=>{
  let sends=0
  const racer=createTransactionRacer(async(_url,init)=>{const call=JSON.parse(String(init?.body));if(call.method==='sendTransaction')sends++;return Response.json({jsonrpc:'2.0',id:call.id,result:'another-genesis'})})
  await expect(racer(transaction(),['https://one.example/api-key=private'])).rejects.toThrow(/original signature/)
  expect(sends).toBe(0)
 })
 it('bounds server configuration and leaves provider URLs out of public status',()=>{
  vi.stubEnv('RPC_URL','https://one.example/private');vi.stubEnv('RPC_RACE_URLS',JSON.stringify(['https://two.example/private']))
  expect(readSubmissionProviders()).toHaveLength(2)
  vi.stubEnv('RPC_RACE_URLS',JSON.stringify(['http://127.0.0.1:8899']))
  expect(()=>readSubmissionProviders()).toThrow(/configuration/)
 })
 it('rejects tampered or noncanonical signed packets before any provider request',async()=>{
  let requests=0;const racer=createTransactionRacer(async()=>{requests++;throw new Error('must not fetch')})
  const call=transaction();call.params[0]=String(call.params[0])+'AAAA'
  await expect(racer(call,['https://one.example/private'])).rejects.toThrow()
  expect(requests).toBe(0)
 })
})
