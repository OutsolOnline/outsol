import {afterEach,describe,expect,it,vi} from 'vitest'
import {AddressLookupTableAccount,AddressLookupTableProgram,Connection,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {AccountLayout,createAssociatedTokenAccountIdempotentInstruction,createCloseAccountInstruction,getAssociatedTokenAddressSync,MintLayout,NATIVE_MINT,TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token'
import {assertMarketSale,prepareMarketSale,simulateSignedMarketSale,type MarketSaleInput} from '../src/lib/sales/market'
import {createMarketBuildHandler} from '../src/lib/sales/provider'

afterEach(()=>vi.unstubAllGlobals())
const key=Keypair.generate(),payer=key.publicKey,mint=Keypair.generate().publicKey,source=getAssociatedTokenAddressSync(mint,payer),destination=getAssociatedTokenAddressSync(NATIVE_MINT,payer)
const jupiter=new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),event=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],jupiter)[0]
const input:MarketSaleInput={payer:payer.toBase58(),mint:mint.toBase58(),amountRaw:'1000000',decimals:6,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),slippageBps:100,priorityFeeLamports:'20000'}
const account=(address:PublicKey,writable=false,signer=false)=>({pubkey:address.toBase58(),isWritable:writable,isSigner:signer})
const api=(ix:TransactionInstruction)=>({programId:ix.programId.toBase58(),accounts:ix.keys.map(value=>account(value.pubkey,value.isWritable,value.isSigner)),data:ix.data.toString('base64')})
function response(){
 const data=Buffer.alloc(39);Buffer.from([187,100,250,204,49,196,175,20]).copy(data);data.writeBigUInt64LE(1000000n,8);data.writeBigUInt64LE(10000000n,16);data.writeUInt16LE(100,24);data.writeUInt32LE(1,30);data[34]=73;data.writeUInt16LE(10000,35);data[38]=1
 return {inputMint:input.mint,outputMint:NATIVE_MINT.toBase58(),inAmount:input.amountRaw,outAmount:'10000000',otherAmountThreshold:'9900000',swapMode:'ExactIn',slippageBps:100,routePlan:[{percent:100,bps:10000,swapInfo:{ammKey:Keypair.generate().publicKey.toBase58(),label:'PumpSwap',inputMint:input.mint,outputMint:NATIVE_MINT.toBase58(),inAmount:input.amountRaw,outAmount:'10000000'}}],computeBudgetInstructions:[],setupInstructions:[api(createAssociatedTokenAccountIdempotentInstruction(payer,destination,payer,NATIVE_MINT))],swapInstruction:{programId:jupiter.toBase58(),accounts:[account(payer,false,true),account(source,true),account(destination,true),account(mint),account(NATIVE_MINT),account(TOKEN_PROGRAM_ID),account(TOKEN_PROGRAM_ID),account(payer,true),account(event),account(jupiter)],data:data.toString('base64')},cleanupInstruction:api(createCloseAccountInstruction(destination,payer,payer)),otherInstructions:[],tipInstruction:null,addressesByLookupTableAddress:{},transactionVersion:0}
}
function mintData(){const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return data}
function tokenData(amount:bigint,mintKey=mint){const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:mintKey,owner:payer,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return data}
const chainAccount=(data:Buffer,owner=TOKEN_PROGRAM_ID,lamports=2039280)=>({data,owner,lamports,executable:false,rentEpoch:0})
function harness(build=response()){
 const hash=Keypair.generate().publicKey.toBase58(),sent:unknown[]=[],extra=new Map<string,ReturnType<typeof chainAccount>>()
 let simulationMutation:((before:Record<string,unknown>[],after:Record<string,unknown>[])=>void)|undefined
 const read=(address:PublicKey)=>address.equals(mint)?chainAccount(mintData()):address.equals(source)?chainAccount(tokenData(1000000n)):extra.get(address.toBase58())??null
 const connection={rpcEndpoint:'http://localhost:9999',getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getAccountInfo:async(address:PublicKey)=>read(address),getMultipleAccountsInfo:async(addresses:PublicKey[])=>addresses.map(read),getLatestBlockhash:async()=>({blockhash:hash,lastValidBlockHeight:12345}),getMinimumBalanceForRentExemption:async()=>2039280,getFeeForMessage:async()=>({value:25000}),sendRawTransaction:async()=>{throw new Error('No sends allowed')},getAddressLookupTable:async()=>{throw new Error('Unverified LUT reader forbidden')}} as unknown as Connection
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(String(url)==='/api/sales/build')return Response.json(build)
  if(String(url)!==connection.rpcEndpoint)throw new Error('Unexpected external request')
  const request=JSON.parse(String(options?.body));expect(request.method).toBe('simulateBundle');sent.push(request)
  const addresses:string[]=request.params[1].preExecutionAccountsConfigs[0].addresses
  const asJson=(value:ReturnType<typeof chainAccount>|null)=>value?{...value,owner:value.owner.toBase58(),data:[value.data.toString('base64'),'base64']}:null
  const before=addresses.map(address=>address===payer.toBase58()?{lamports:100000000,owner:SystemProgram.programId.toBase58(),data:['','base64'],executable:false}:asJson(read(new PublicKey(address))))
  const after=addresses.map(address=>address===payer.toBase58()?{lamports:109975000,owner:SystemProgram.programId.toBase58(),data:['','base64'],executable:false}:address===source.toBase58()?asJson(chainAccount(tokenData(0n))):asJson(read(new PublicKey(address))))
  simulationMutation?.(before as Record<string,unknown>[],after as Record<string,unknown>[])
  return Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:before,postExecutionAccounts:after}]}}})
 })
 vi.stubGlobal('fetch',fetcher)
 return {connection,fetcher,sent,build,extra,mutateSimulation:(mutation:typeof simulationMutation)=>{simulationMutation=mutation}}
}
describe('reviewed zero-platform-fee market sales',()=>{
 it('builds a self-managed SOL exit with exact input, same payer, fresh chain hash and conservative fee/rent reserve',async()=>{
  const h=harness(),plan=await prepareMarketSale(h.connection,input)
  expect(plan.route).toBe('jupiter');expect(plan.amountRaw).toBe('1000000');expect(plan.minimumSolOut).toBe('9900000');expect(plan.estimatedNetSolOut).toBe('9975000');expect(BigInt(plan.maxDebitLamports)).toBeGreaterThanOrEqual(2064280n)
  expect(plan.transaction.message.staticAccountKeys[0].toBase58()).toBe(input.payer);expect(plan.lastValidBlockHeight).toBe(12345)
  expect(()=>assertMarketSale(plan,plan.transaction)).not.toThrow();expect(h.sent).toHaveLength(1)
  const signed=VersionedTransaction.deserialize(plan.transaction.serialize());signed.sign([key]);const result=await simulateSignedMarketSale(h.connection,plan,signed,()=>{})
  expect(result.networkFeeLamports).toBe('25000');expect(result.walletBeforeLamports).toBe('100000000');expect(result.netDebitLamports).toBe('0')
  expect((h.sent[1] as {params:unknown[]}).params[1]).toMatchObject({skipSigVerify:false,replaceRecentBlockhash:false})
 })
 it('rejects foreign recipients, mints, amounts, platform and positive-slippage fees before simulation',async()=>{
  for(const mutate of [(b:ReturnType<typeof response>)=>{b.swapInstruction.accounts[7]=account(Keypair.generate().publicKey,true)},(b:ReturnType<typeof response>)=>{b.outputMint=mint.toBase58()},(b:ReturnType<typeof response>)=>{b.inAmount='999999'},(b:ReturnType<typeof response>)=>{const data=Buffer.from(b.swapInstruction.data,'base64');data.writeUInt16LE(1,26);b.swapInstruction.data=data.toString('base64')},(b:ReturnType<typeof response>)=>{const data=Buffer.from(b.swapInstruction.data,'base64');data.writeUInt16LE(1,28);b.swapInstruction.data=data.toString('base64')}]){
   const build=response();mutate(build);const h=harness(build);await expect(prepareMarketSale(h.connection,input)).rejects.toThrow();expect(h.sent).toHaveLength(0)
  }
 })
 it('binds the protocol minimum with conservative upward lamport rounding',async()=>{
  const build=response();build.outAmount='10000001';build.otherAmountThreshold='9900001';const data=Buffer.from(build.swapInstruction.data,'base64');data.writeBigUInt64LE(10000001n,16);build.swapInstruction.data=data.toString('base64')
  const h=harness(build),plan=await prepareMarketSale(h.connection,input);expect(plan.minimumSolOut).toBe('9900001')
 })
 it('bounds unique writable accounts while accepting repeated route account metas',async()=>{
  const h=harness();h.build.swapInstruction.accounts.push(...Array.from({length:70},()=>account(source,true)))
  const plan=await prepareMarketSale(h.connection,input);expect(plan.route).toBe('jupiter')
 })
 it('recognizes same-bank empty System placeholders for missing intermediate associated accounts',async()=>{
  const h=harness(),otherMint=Keypair.generate().publicKey,other=getAssociatedTokenAddressSync(otherMint,payer)
  h.build.setupInstructions.push(api(createAssociatedTokenAccountIdempotentInstruction(payer,other,payer,otherMint)))
  h.mutateSimulation((before,after)=>{const call=h.sent.at(-1) as {params:[unknown,{preExecutionAccountsConfigs:{addresses:string[]}[]}]},index=call.params[1].preExecutionAccountsConfigs[0].addresses.indexOf(other.toBase58());before[index]={owner:SystemProgram.programId.toBase58(),lamports:0,data:['','base64']};after[index]={owner:TOKEN_PROGRAM_ID.toBase58(),lamports:2039280,data:[tokenData(0n,otherMint).toString('base64'),'base64']};const wallet=after.find(value=>value?.owner===SystemProgram.programId.toBase58())!;wallet.lamports=107935720})
  const plan=await prepareMarketSale(h.connection,input);expect(plan.estimatedNetSolOut).toBe('7935720')
 })
 it('rejects arbitrary transfers, approvals, foreign signers and unsupported Jupiter instruction variants',async()=>{
  for(const mutate of [(b:ReturnType<typeof response>)=>{b.otherInstructions=[api(SystemProgram.transfer({fromPubkey:payer,toPubkey:Keypair.generate().publicKey,lamports:1}))] as never[]},(b:ReturnType<typeof response>)=>{b.setupInstructions=[{programId:TOKEN_PROGRAM_ID.toBase58(),accounts:[],data:Buffer.from([4]).toString('base64')}]},(b:ReturnType<typeof response>)=>{b.swapInstruction.accounts.push(account(Keypair.generate().publicKey,false,true))},(b:ReturnType<typeof response>)=>{b.swapInstruction.data=Buffer.alloc(40).toString('base64')}]){
   const build=response();mutate(build);const h=harness(build);await expect(prepareMarketSale(h.connection,input)).rejects.toThrow();expect(h.sent).toHaveLength(0)
  }
 })
 it('rejects incomplete or incorrect same-bank deltas and input authority mutations',async()=>{
  for(const mutation of [(before:Record<string,unknown>[],after:Record<string,unknown>[])=>{const index=before.findIndex(value=>value?.owner===SystemProgram.programId.toBase58());after[index].lamports=100001000},(_before:Record<string,unknown>[],after:Record<string,unknown>[])=>{after.pop()},(_before:Record<string,unknown>[],after:Record<string,unknown>[])=>{const item=after.find(value=>value?.owner===TOKEN_PROGRAM_ID.toBase58())!,data=Buffer.from((item.data as string[])[0],'base64');data[72]=1;item.data=[data.toString('base64'),'base64']}]){
   const h=harness();h.mutateSimulation(mutation);await expect(prepareMarketSale(h.connection,input)).rejects.toThrow()
  }
 })
 it('checks all writable token accounts and rejects an unrelated token loss',async()=>{
  const h=harness(),otherMint=Keypair.generate().publicKey,other=getAssociatedTokenAddressSync(otherMint,payer)
  h.extra.set(other.toBase58(),chainAccount(tokenData(500n,otherMint)));h.build.swapInstruction.accounts.push(account(other,true))
  h.mutateSimulation((before,after)=>{const index=before.findIndex(value=>value&&Array.isArray(value.data)&&Buffer.from((value.data as string[])[0],'base64').subarray(0,32).equals(otherMint.toBuffer()));after[index]={...after[index],data:[tokenData(499n,otherMint).toString('base64'),'base64']}})
  await expect(prepareMarketSale(h.connection,input)).rejects.toThrow(/unrelated|another|unexpected/i)
 })
 it('does not trust provider lookup table contents',async()=>{
  const h=harness(),table=Keypair.generate().publicKey;Object.assign(h.build.addressesByLookupTableAddress,{[table.toBase58()]:[mint.toBase58()]})
  h.extra.set(table.toBase58(),chainAccount(Buffer.alloc(100),SystemProgram.programId))
  await expect(prepareMarketSale(h.connection,input)).rejects.toThrow(/lookup|table/i)
 })
 it('binds an opaque approved message and checks signer, expiry and cancellation before signed simulation',async()=>{
  const h=harness(),plan=await prepareMarketSale(h.connection,input),signed=VersionedTransaction.deserialize(plan.transaction.serialize());signed.sign([key])
  expect(()=>assertMarketSale({...plan},signed)).toThrow()
  const changed=VersionedTransaction.deserialize(signed.serialize());changed.message.recentBlockhash=Keypair.generate().publicKey.toBase58();expect(()=>assertMarketSale(plan,changed)).toThrow()
  await expect(simulateSignedMarketSale(h.connection,plan,signed,()=>{throw new Error('Locked')})).rejects.toThrow('Locked')
 })
 it('refuses an uninitialized mint before requesting a market route',async()=>{
  const h=harness(),data=mintData();data[45]=0
  vi.spyOn(h.connection,'getMultipleAccountsInfo').mockResolvedValue([chainAccount(data),chainAccount(tokenData(1000000n)),null])
  await expect(prepareMarketSale(h.connection,input)).rejects.toThrow(/initialized|mint/i);expect(h.fetcher).not.toHaveBeenCalled()
 })
})
describe('fixed official Jupiter build boundary',()=>{
 const request=(body:unknown)=>new Request('http://localhost:3091/api/sales/build',{method:'POST',headers:{Origin:'http://localhost:3091','Content-Type':'application/json'},body:JSON.stringify(body)})
 it('uses the fixed zero-fee endpoint and keeps operator credentials in its server request',async()=>{
  const fetcher=vi.fn(async()=>Response.json(response())),handler=createMarketBuildHandler({fetch:fetcher as typeof fetch,apiKey:'server-only-test'})
  const result=await handler(request(input));expect(result.status).toBe(200)
  const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];const parsed=new URL(url)
  expect(parsed.origin+parsed.pathname).toBe('https://api.jup.ag/swap/v2/build');expect(parsed.searchParams.get('platformFeeBps')).toBe('0');expect(parsed.searchParams.get('nativeDestinationAccount')).toBe(input.payer);expect(parsed.searchParams.has('feeAccount')).toBe(false);expect((options.headers as Record<string,string>)['x-api-key']).toBe('server-only-test');expect(await result.text()).not.toContain('server-only-test')
 })
 it('allows keyless provider reads, rejects foreign origins and reports rate limits without provider details',async()=>{
  const fetcher=vi.fn(async()=>new Response('private provider detail',{status:429})),handler=createMarketBuildHandler({fetch:fetcher as typeof fetch,apiKey:''})
  const foreign=new Request('http://localhost:3091/api/sales/build',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(input)})
  expect((await handler(foreign)).status).toBe(403);expect(fetcher).not.toHaveBeenCalled()
  const result=await handler(request(input));expect(result.status).toBe(429);expect(await result.text()).not.toContain('private provider detail')
 })
 it('projects only public build fields even if an upstream debug field echoes its credential',async()=>{
  const handler=createMarketBuildHandler({fetch:async()=>Response.json({...response(),debugCredential:'private-server-key'}),apiKey:'private-server-key'})
  const result=await handler(request(input));expect(result.status).toBe(200);expect(await result.text()).not.toContain('private-server-key')
 })
})

describe.skipIf(process.env.RUN_MARKET_SALE_READONLY!=='1')('current market provider read-only acceptance',()=>{
 it('prepares a current zero-integrator-fee Jupiter exit and verifies same-bank unsigned balances without a wallet key',async()=>{
  const {readFileSync,mkdirSync,writeFileSync}=await import('node:fs')
  const endpoint=readFileSync(process.env.OUTSOL_RPC_ENV_FILE??'.env.local','utf8').match(/^\s*RPC_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g,'')
  if(!endpoint)throw new Error('A private read-only RPC is required for this opt-in check.')
  const realFetch=globalThis.fetch,usdc=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  const handler=createMarketBuildHandler({fetch:async(url,options)=>{if(new URL(String(url)).origin!=='https://api.jup.ag')throw new Error('External provider blocked');const result=await realFetch(url,options);if(result.ok){mkdirSync('work',{recursive:true});writeFileSync('work/sales-jupiter-build-public.json',JSON.stringify(await result.clone().json(),null,2))}return result},apiKey:''})
  const guarded:typeof fetch=async(url,options)=>{
   if(String(url)==='/api/sales/build')return handler(new Request('http://localhost:3091/api/sales/build',{...options,headers:{...options?.headers,Origin:'http://localhost:3091'}}))
   if(String(url)!==endpoint)throw new Error('Unexpected external request blocked')
   const body=JSON.parse(String(options?.body)),calls=Array.isArray(body)?body:[body]
   if(calls.some((call:{method:string})=>['sendTransaction','sendBundle','requestAirdrop','sendRawTransaction'].includes(call.method)))throw new Error('This read-only check forbids every spending operation.')
   return realFetch(url,{...options,redirect:'error',signal:options?.signal??AbortSignal.timeout(30000)})
  }
  vi.stubGlobal('fetch',guarded)
  const connection=new Connection(endpoint,{commitment:'confirmed',fetch:guarded,disableRetryOnRateLimit:true})
  connection.sendRawTransaction=async()=>{throw new Error('Every real send is forbidden')}
  const candidates=new Set<string>(['ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u'])
  const signatures=await connection.getSignaturesForAddress(usdc,{limit:8},'confirmed')
  for(const signature of signatures){
   const result=await(await guarded(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[signature.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]})})).json()
   for(const token of result.result?.meta?.postTokenBalances??[])if(token.mint===usdc.toBase58()&&typeof token.owner==='string'&&BigInt(token.uiTokenAmount.amount)>=1000000n&&PublicKey.isOnCurve(new PublicKey(token.owner).toBytes()))candidates.add(token.owner)
   if(candidates.size>=8)break
  }
  let holder:PublicKey|undefined
  for(const candidate of candidates){
   const owner=new PublicKey(candidate),ata=getAssociatedTokenAddressSync(usdc,owner),[info,wrapped]=await connection.getMultipleAccountsInfo([ata,getAssociatedTokenAddressSync(NATIVE_MINT,owner)],'confirmed');if(!info||wrapped&&unpackAccount(getAssociatedTokenAddressSync(NATIVE_MINT,owner),wrapped,TOKEN_PROGRAM_ID).amount!==0n)continue
   const token=unpackAccount(ata,info,TOKEN_PROGRAM_ID)
   if(token.amount>=1000000n&&await connection.getBalance(owner,'confirmed')>20000000){holder=owner;break}
  }
  if(!holder)throw new Error('No eligible public funded canonical holder in this read-only sample; retry the opt-in check.')
  let plan:Awaited<ReturnType<typeof prepareMarketSale>>
  try{plan=await prepareMarketSale(connection,{payer:holder.toBase58(),mint:usdc.toBase58(),amountRaw:'1000000',decimals:6,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),slippageBps:100,priorityFeeLamports:'20000'})}
  catch(reason){throw new Error(reason instanceof Error?reason.message.replaceAll(endpoint,'[private RPC]').replace(/https?:\/\/[^\s]+/g,'[endpoint]'):'Read-only market preview failed')}
  expect(plan.route).toBe('jupiter');expect(BigInt(plan.minimumSolOut)).toBeGreaterThan(0n);expect(plan.transaction.signatures.every(signature=>signature.every(byte=>byte===0))).toBe(true)
  const proof={proof:'read-only-current-jupiter-v2-market-sale',date:new Date().toISOString(),payer:plan.payer,mint:plan.mint,amountRaw:plan.amountRaw,minimumSolOut:plan.minimumSolOut,estimatedSolOut:plan.estimatedSolOut,estimatedNetSolOut:plan.estimatedNetSolOut,networkFeeLamports:plan.networkFeeLamports,maxDebitLamports:plan.maxDebitLamports,platformFeeLamports:'0',realSolSpent:false,signed:false,transactionBytes:plan.transaction.serialize().length}
  mkdirSync('work',{recursive:true});writeFileSync('work/sales-market-readonly-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof))
 },180000)
})
