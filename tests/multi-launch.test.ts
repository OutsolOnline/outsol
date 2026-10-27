import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {PUMP_SDK,type Global} from '@pump-fun/pump-sdk'
import BN from 'bn.js'
import {consumerLaunchPlan} from './helpers/consumerLaunchPlan'
import {buildNativeCreateInstructions} from '../src/lib/pumpfun/api'
import {createJitoTipTransaction,submitAtomicBundle} from '../src/lib/bundler/jito'
import {prepareMultiLaunch,type MultiLaunchInput,type MultiLaunchPorts,type MultiLaunchSigner} from '../src/lib/multiLaunch/session'
import {readBatchJournal} from '../src/lib/multiLaunch/history'
import {readPending} from '../src/lib/launchHistory'
import {signedTransactionSignature} from '../src/lib/transactions/send'

afterEach(()=>vi.unstubAllGlobals())
function fixture(){
 const values=new Map<string,string>()
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>{values.delete(key)}})
 const payer=Keypair.generate(),blockhash=Keypair.generate().publicKey.toBase58(),sent:string[]=[]
 const lockState={held:false,granted:true,requests:[] as string[]}
 let balance=1_000_000_000,liveSigner:string|null=payer.publicKey.toBase58(),debit='10000000',clock=1_000,planDebits:string[]|undefined
 const mintData=Buffer.alloc(82);mintData[44]=6;mintData[45]=1
 const connection={getGenesisHash:async()=>'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getBalance:async()=>balance,getFeeForMessage:async()=>({context:{slot:1},value:505000}),isBlockhashValid:async()=>({context:{slot:1},value:true}),getBlockHeight:async()=>100,getAccountInfo:async()=>({owner:new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),executable:false,data:mintData,lamports:100})} as unknown as Connection
 const input:MultiLaunchInput={payer:payer.publicKey.toBase58(),rows:[{name:'Alpha',symbol:'ALPHA',buySol:'0'},{name:'Beta',symbol:'BETA',buySol:'0'}],shared:{description:'Public description',image:new Blob(['art'],{type:'image/png'})},slippage:5,priorityFeeSol:0.0005,jitoTipSol:0.00001}
 const ports:Partial<MultiLaunchPorts>={locks:{request:async(name,_options,callback)=>{lockState.requests.push(name);if(!lockState.granted)return callback(null);lockState.held=true;try{return await callback({})}finally{lockState.held=false}}},now:()=>clock,verifyRouting:async()=>{},upload:async metadata=>({success:true,metadataUri:`ipfs://${metadata.symbol.toLowerCase()}`}),build:params=>consumerLaunchPlan(params,blockhash),simulate:async(_connection,packets)=>({success:true,payerDebitLamports:packets.length>1?(planDebits??packets.map(()=>debit)).reduce((sum,value)=>sum+BigInt(value),0n).toString():debit}),simulatePlan:async(_connection,groups)=>{const rows=planDebits??groups.map(()=>debit);return {rowDebitsLamports:rows,totalDebitLamports:rows.reduce((sum,value)=>sum+BigInt(value),0n).toString()}},sendSingle:async(_connection,tx,options)=>{
  options?.onBroadcast?.();const signature=signedTransactionSignature(tx);sent.push(signature);balance-=10_000_000
  return {status:'confirmed',signature,submitted:true}
 }}
 const signer={approved:true as const,readSigner:()=>liveSigner,sign:async(txs:VersionedTransaction[])=>{txs.forEach(tx=>tx.sign([payer]));return txs}}
 return {input,connection,ports,payer,signer,sent,values,lockState,setSigner:(value:string|null)=>{liveSigner=value},setDebit:(value:string)=>{debit=value},setPlanDebits:(value:string[])=>{planDebits=value},setBalance:(value:number)=>{balance=value},setClock:(value:number)=>{clock=value}}
}
describe('reviewed multi-launch preparation',()=>{
 it('propagates one selected holder route into every mint-specific plan, review and journal',async()=>{
  const f=fixture(),build=f.ports.build!,seen:string[]=[]
  f.input.creatorFeeSelection={kind:'holder-rewards'}
  f.ports.build=async params=>{expect(params.creatorFeeSelection).toEqual({kind:'holder-rewards'});const result=await build(params);seen.push(result.creatorFeeRouting!.effectiveCreator);return result}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),review=session.review(),result=await session.run(f.signer)
  expect(new Set(seen).size).toBe(2)
  expect(review.rows.map(row=>row.creatorFeeRouting.effectiveCreator)).toEqual(seen)
  expect(result.rows.map(row=>row.creatorFeeRouting?.effectiveCreator)).toEqual(seen)
  expect(readBatchJournal()?.rows.map(row=>row.creatorFeeRouting?.effectiveCreator)).toEqual(seen)
 })
 it('freshly resolves a shared GitHub identity once and binds its immutable ID to every row',async()=>{
  const f=fixture(),resolve=vi.fn(async()=>({username:'Octocat',userId:'583231',profileUrl:'https://github.com/Octocat',accountType:'User' as const}))
  f.input.creatorFeeSelection={kind:'github',username:'octocat'};f.ports.resolveGitHub=resolve
  f.ports.simulate=async(_connection,packets)=>({success:true,payerDebitLamports:packets.length>2?'20000000':'10000000'})
  const review=(await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)).review()
  expect(resolve).toHaveBeenCalledTimes(1)
  expect(review.rows.every(row=>row.creatorFeeRouting.github?.userId==='583231')).toBe(true)
  expect(review.rows.every(row=>row.creatorFeeRouting.selection.kind==='github'&&row.creatorFeeRouting.selection.username==='Octocat')).toBe(true)
  expect(new Set(review.rows.map(row=>row.creatorFeeRouting.sharingConfig)).size).toBe(2)
 })
 it.each([{kind:'wallet' as const,address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards' as const}])('rejects a builder that replaces selected %s with deployer',async creatorFeeSelection=>{
  const f=fixture(),build=f.ports.build!;f.input.creatorFeeSelection=creatorFeeSelection
  f.ports.build=params=>build({...params,creatorFeeSelection:{kind:'deployer'}})
  await expect(prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)).rejects.toThrow(/recipient differs/)
  expect(f.sent).toEqual([])
 })
 it('binds the canonical GitHub route to the freshly resolved numeric ID rather than a builder replacement',async()=>{
  const f=fixture(),build=f.ports.build!;f.input.creatorFeeSelection={kind:'github',username:'Octocat'}
  f.ports.resolveGitHub=async()=>({username:'Octocat',userId:'583231',profileUrl:'https://github.com/Octocat',accountType:'User'})
  f.ports.build=params=>build({...params,githubRecipient:{...params.githubRecipient!,userId:'12345'}})
  await expect(prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)).rejects.toThrow(/recipient differs/)
  expect(f.sent).toEqual([])
 })
 it('stops before building when the previously reviewed GitHub username changed numeric identity',async()=>{
  const f=fixture(),build=vi.fn(f.ports.build!)
  f.input.creatorFeeSelection={kind:'github',username:'Octocat'};f.ports.build=build
  f.ports.resolveGitHub=async()=>({username:'Octocat',userId:'99',profileUrl:'https://github.com/Octocat',accountType:'User'})
  await expect(prepareMultiLaunch(f.connection,f.input,{...f.signer,previousGitHubRecipient:{username:'Octocat',userId:'583231',profileUrl:'https://github.com/Octocat',accountType:'User'}},f.ports)).rejects.toThrow(/different numeric user ID/)
  expect(build).not.toHaveBeenCalled();expect(f.sent).toEqual([])
 })
 it('rejects a route whose complete shared-bank preview exceeds five packets before any signature',async()=>{
  const f=fixture()
  f.input.creatorFeeSelection={kind:'github',username:'Octocat'}
  f.input.rows=Array.from({length:3},()=>({name:'N'.repeat(32),symbol:'S'.repeat(10),buySol:'0.01'}))
  f.ports.resolveGitHub=async()=>({username:'Octocat',userId:'583231',profileUrl:'https://github.com/Octocat',accountType:'User'})
  f.ports.upload=async()=>({success:true,metadataUri:'https://example.com/'.padEnd(200,'x')})
  await expect(prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)).rejects.toThrow(/five packets total/)
  expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('quotes later tokens after shared payer accounts are created instead of charging their rent twice',async()=>{
  const f=fixture();f.setPlanDebits(['10000000','7264720'])
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),review=session.review()
  expect(review.rows.map(row=>row.debitLamports)).toEqual(['10000000','7264720'])
  expect(review.totalDebitLamports).toBe('17264720')
 })
 it('generates distinct mint addresses per row and never exports mint keys or packet bytes',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),review=session.review()
  expect(new Set(review.rows.map(row=>row.mint)).size).toBe(2)
  expect(review.totalDebitLamports).toBe('20000000')
  expect(review.rows[0].metadataUri).toBe('ipfs://alpha')
  expect(JSON.stringify(session)).toBe('{}')
  expect(JSON.stringify(review)).not.toMatch(/secret|signatures|transaction|private/i)
 })
 it('rejects aggregate costs above the exact wallet balance before offering approval',async()=>{
  const f=fixture();f.setBalance(19_999_999)
  await expect(prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)).rejects.toThrow(/balance|cover/i)
  expect(f.sent).toEqual([])
 })
 it('requires a bounded row count and exact decimal SOL ceilings',async()=>{
  const f=fixture()
  await expect(prepareMultiLaunch(f.connection,{...f.input,rows:[f.input.rows[0]]},f.signer,f.ports)).rejects.toThrow(/2.*5/)
  await expect(prepareMultiLaunch(f.connection,{...f.input,rows:[{...f.input.rows[0],buySol:'1e-3'},f.input.rows[1]]},f.signer,f.ports)).rejects.toThrow(/decimal|SOL/)
 })
})
describe('reviewed multi-launch submission',()=>{
 it('preserves unknown recovery evidence when confirmed signatures have the wrong creator state',async()=>{
  const f=fixture();f.input.creatorFeeSelection={kind:'holder-rewards'}
  f.ports.verifyRouting=async()=>{throw new Error('On-chain creator differs from the reviewed launch')}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run(f.signer)
  expect(result.status).toBe('unknown');expect(result.rows.map(row=>row.status)).toEqual(['unknown','waiting'])
  expect(readPending()?.creatorFeeRouting?.selection).toEqual({kind:'holder-rewards'})
  expect(f.sent).toHaveLength(1)
 })
 it('requires explicit engine approval before acquiring the spending lock or signing',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)
  await expect(session.run({...f.signer,approved:false} as unknown as MultiLaunchSigner)).rejects.toThrow(/approval/i)
  expect(f.lockState.requests).toEqual([]);expect(f.sent).toEqual([])
 })
 it('owns the shared spending lock through signing, submission, and the final batch receipt',async()=>{
  const f=fixture(),observed:boolean[]=[],send=f.ports.sendSingle!
  f.ports.sendSingle=async(...args)=>{observed.push(f.lockState.held);return send(...args)}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run({...f.signer,onChange:()=>{observed.push(f.lockState.held)}})
  expect(result.status).toBe('confirmed');expect(f.lockState.requests).toEqual(['vanity-launch-submission']);expect(observed.length).toBeGreaterThan(3);expect(observed.every(Boolean)).toBe(true);expect(f.lockState.held).toBe(false)
 })
 it('never signs or submits if the engine cannot acquire the shared spending lock',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports);f.lockState.granted=false
  await expect(session.run(f.signer)).rejects.toThrow(/another tab|lock/i)
  expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('owns a private copy of wallet results so later wallet mutation cannot change authorized bytes',async()=>{
  const f=fixture(),simulate=f.ports.simulate!,reviewedSignatures:string[]=[]
  let walletPackets:VersionedTransaction[]=[]
  f.ports.simulate=async(connection,packets,options)=>{
   if(options?.verifySignatures){walletPackets[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();walletPackets[0].sign([f.payer])}
   return simulate(connection,packets,options)
  }
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)
  const result=await session.run({...f.signer,sign:async packets=>{walletPackets=await f.signer.sign(packets);reviewedSignatures.push(signedTransactionSignature(walletPackets[0]));return walletPackets}})
  expect(result.status).toBe('confirmed');expect(f.sent).toEqual(reviewedSignatures);expect(readPending()).toBeNull()
 })
 it('rejects simulation-argument mutation after an await before saving or broadcasting changed bytes',async()=>{
  const f=fixture(),simulate=f.ports.simulate!
  f.ports.simulate=async(connection,packets,options)=>{const result=await simulate(connection,packets,options);if(options?.verifySignatures){packets[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();packets[0].sign([f.payer])}return result}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run(f.signer)
  expect(result.status).toBe('failed');expect(result.error).toMatch(/changed|mutat/i);expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('rejects retained simulation-argument mutation from the sending checkpoint before invoking a sender',async()=>{
  const f=fixture(),simulate=f.ports.simulate!;let simulated:VersionedTransaction[]=[]
  f.ports.simulate=async(connection,packets,options)=>{if(options?.verifySignatures)simulated=packets;return simulate(connection,packets,options)}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run({...f.signer,onChange:journal=>{if(journal.rows.some(row=>row.status==='sending')){simulated[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();simulated[0].sign([f.payer])}}})
  expect(result.status).toBe('failed');expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('rechecks the send packet at the actual broadcast callback after a sender await',async()=>{
  const f=fixture()
  f.ports.sendSingle=async(_connection,packet,options)=>{await Promise.resolve();packet.message.recentBlockhash=Keypair.generate().publicKey.toBase58();packet.sign([f.payer]);options?.onBroadcast?.();const signature=signedTransactionSignature(packet);f.sent.push(signature);return {status:'confirmed',signature,submitted:true}}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run(f.signer)
  expect(result.status).toBe('failed');expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('blocks Jito transport if a bundle packet changes during the sender’s second signed simulation',async()=>{
  const f=fixture(),build=f.ports.build!,networkMethods:string[]=[];let transportPackets:VersionedTransaction[]=[]
  f.input.rows[0].buySol='0.01'
  f.input.rows[0].name='N'.repeat(32);f.input.rows[0].symbol='S'.repeat(10)
  f.ports.upload=async()=>({success:true,metadataUri:'https://example.com/'.padEnd(200,'x')})
  f.ports.sendBundle=(connection,packets,options)=>{transportPackets=packets;return submitAtomicBundle(connection,packets,{...options,endpoint:'https://jito.invalid'})}
  f.ports.simulate=async(_connection,packets)=>({success:true,payerDebitLamports:packets.length===3?'20000000':'10000000'})
  vi.stubGlobal('fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{
   const call=JSON.parse(String(init?.body));networkMethods.push(call.method)
   if(call.method!=='simulateBundle')throw new Error('A changed bundle must never reach sendBundle transport')
   await Promise.resolve();transportPackets[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();transportPackets[0].sign([f.payer])
   return Response.json({result:{value:{summary:'succeeded',transactionResults:transportPackets.map(()=>({err:null}))}}})
  })
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run(f.signer)
  expect(result.status).toBe('failed');expect(result.error).toMatch(/changed/i);expect(networkMethods).toEqual(['simulateBundle']);expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('records each confirmed token before starting the next and completes the full sequence once',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run(f.signer)
  expect(result.status).toBe('confirmed');expect(result.rows.map(row=>row.status)).toEqual(['confirmed','confirmed']);expect(f.sent).toHaveLength(2)
  expect(new Set(f.sent).size).toBe(2);expect(readPending()).toBeNull()
  const receipts=JSON.parse(f.values.get('vanity-launch-receipts')!);expect(receipts.map((row:{mint:string})=>row.mint).sort()).toEqual(result.rows.map(row=>row.mint).sort())
 })
 it('does not send or overwrite malformed batch history discovered after preparation',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)
  f.values.set('outsol-multi-launch-public-v1','{broken')
  const result=await session.run(f.signer)
  expect(result.status).toBe('failed');expect(f.sent).toEqual([]);expect(f.values.get('outsol-multi-launch-public-v1')).toBe('{broken')
 })
 it('requires a verified durable public batch record before requesting any signature',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)
  vi.stubGlobal('localStorage',{getItem:(key:string)=>f.values.get(key)??null,setItem:()=>{throw new Error('quota')},removeItem:(key:string)=>f.values.delete(key)})
  const result=await session.run(f.signer)
  expect(result.status).toBe('failed');expect(result.rows.map(row=>row.status)).toEqual(['waiting','waiting']);expect(f.sent).toEqual([])
 })
 it('rejects a wallet-modified message before broadcasting any row',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)
  const result=await session.run({...f.signer,sign:async txs=>{txs[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();txs.forEach(tx=>tx.sign([f.payer]));return txs}})
  expect(result.status).toBe('failed');expect(result.error).toMatch(/changed.*reviewed/i);expect(f.sent).toEqual([]);expect(readPending()).toBeNull()
 })
 it('rechecks the current signer after a signing await and never sends with a locked vault',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports)
  const result=await session.run({...f.signer,sign:async txs=>{const signed=await f.signer.sign(txs);f.setSigner(null);return signed}})
  expect(result.status).toBe('failed');expect(f.sent).toEqual([])
 })
 it('rejects a changed same-bank debit even when it is cheaper',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports);f.setDebit('9999999')
  const result=await session.run(f.signer)
  expect(result.status).toBe('failed');expect(result.error).toMatch(/cost.*changed|debit.*changed/i);expect(f.sent).toEqual([])
 })
 it('stops on an unknown first submission, preserving its original signature without resending',async()=>{
  const f=fixture();f.ports.sendSingle=async(_connection,tx,options)=>{options?.onBroadcast?.();const signature=signedTransactionSignature(tx);f.sent.push(signature);return {status:'unknown',signature,submitted:true,error:'Network response lost'}}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run(f.signer)
  expect(result.status).toBe('unknown');expect(result.rows.map(row=>row.status)).toEqual(['unknown','waiting']);expect(f.sent).toHaveLength(1)
  expect(readPending()?.signatures).toEqual(f.sent)
  expect(readBatchJournal()?.rows[0].signatures).toEqual(f.sent)
  await expect(session.run(f.signer)).rejects.toThrow(/already|new preview/i);expect(f.sent).toHaveLength(1)
 })
 it('cancels between rows and preserves the confirmed first row without launching the next',async()=>{
  const f=fixture(),controller=new AbortController(),send=f.ports.sendSingle!
  f.ports.sendSingle=async(...args)=>{const result=await send(...args);controller.abort();return result}
  const session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports),result=await session.run({...f.signer,signal:controller.signal})
  expect(result.status).toBe('cancelled');expect(f.sent).toHaveLength(1);expect(result.rows[0].status).toBe('confirmed');expect(readPending()).toBeNull()
  expect(JSON.stringify(readBatchJournal())).not.toMatch(/secretKey|encodedTransactions|signedBytes/)
 })
 it('checks balance and expiry again before beginning the approved batch',async()=>{
  const f=fixture(),session=await prepareMultiLaunch(f.connection,f.input,f.signer,f.ports);f.setBalance(19_999_999)
  expect((await session.run(f.signer)).status).toBe('failed');expect(f.sent).toEqual([])
  const g=fixture(),expired=await prepareMultiLaunch(g.connection,g.input,g.signer,g.ports);g.setClock(61_001)
  const result=await expired.run(g.signer);expect(result.status).toBe('failed');expect(result.error).toMatch(/expired/i)
 })
})
