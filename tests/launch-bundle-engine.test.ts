import {describe,expect,it} from 'vitest'
import {Connection,Keypair,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {buildFreshNativeBuy} from '../src/lib/pumpfun/api'
import {createJitoTipTransaction} from '../src/lib/bundler/jito'
import {signedTransactionSignature} from '../src/lib/transactions/send'
import {prepareLaunchBundle} from '../src/lib/launchBundle/prepare'
import {executePreparedLaunchBundle} from '../src/lib/launchBundle/execute'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
import type {LaunchBundlePorts,LaunchBundleExecutionOptions} from '../src/lib/launchBundle/model'
import {consumerLaunchPlan} from './helpers/consumerLaunchPlan'
import type {CreatorFeeSelection} from '../src/lib/creatorFeeRouting'
import {creatorVaultPda} from '@pump-fun/pump-sdk'
import type {LaunchBundleWallet} from '../src/lib/launchBundle/types'
const wrongVault=(tx:VersionedTransaction)=>{const message=TransactionMessage.decompile(tx.message),buy=message.instructions.find(ix=>ix.data.subarray(0,8).equals(Buffer.from([102,6,61,18,1,218,235,234])))!;buy.keys[9].pubkey=creatorVaultPda(Keypair.generate().publicKey);return new VersionedTransaction(new TransactionMessage({payerKey:message.payerKey,recentBlockhash:message.recentBlockhash,instructions:message.instructions}).compileToV0Message())}
async function harness(mode:'manual'|'block0'|'organic'='block0',selection?:CreatorFeeSelection,long=false,devBuySol=0){
 const creator=Keypair.generate(),buyer=Keypair.generate(),secondBuyer=Keypair.generate(),mint=Keypair.generate(),blockhash=Keypair.generate().publicKey.toBase58();let locked=false,time=1_000,sent=0,initialConfirmed=false
 const receipts:unknown[]=[],events:string[]=[]
 const input={payer:creator.publicKey.toBase58(),mintKeypair:mint,metadata:long?{name:'N'.repeat(32),symbol:'S'.repeat(10),uri:'https://example.com/'.padEnd(200,'m')}:{name:'Inline',symbol:'INL',uri:'ipfs://inline'},devBuySol,slippage:5,priorityFeeSol:0.0001,jitoTipSol:0.00001,...(selection===undefined?{}:{creatorFeeSelection:selection}),...(selection?.kind==='github'?{githubRecipient:{userId:'583231',username:selection.username,profileUrl:`https://github.com/${selection.username}`,accountType:'User' as const}}:{}),settings:{...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode,groupId:'group',wallets:[{walletId:'buyer',publicKey:buyer.publicKey.toBase58(),name:'Buyer',buySol:0.01,delaySeconds:1} as LaunchBundleWallet]}}
 const connection={getBalance:async()=>1_000_000_000,getFeeForMessage:async()=>({value:5_000}),isBlockhashValid:async()=>({value:true}),getBlockHeight:async()=>10,getAccountInfo:async()=>({owner:TOKEN_2022_PROGRAM_ID})} as unknown as Connection
 const ports:Partial<LaunchBundlePorts>={now:()=>time,wait:async ms=>{time+=ms},random:()=>0,
  buildCreate:params=>consumerLaunchPlan(params,blockhash),
  buildFreshBuy:buildFreshNativeBuy,
  buildBuy:async params=>{expect(initialConfirmed).toBe(true);const plan=await consumerLaunchPlan({userPublicKey:creator.publicKey.toBase58(),mintKeypair:mint,metadata:{...input.metadata,description:''},metadataUri:input.metadata.uri,creatorFeeSelection:input.creatorFeeSelection as never,githubRecipient:input.githubRecipient},blockhash);return (await buildFreshNativeBuy({context:plan.nativeContext!,mint:mint.publicKey,payer:new PublicKey(params.userPublicKey),metadata:input.metadata,maxBuyLamports:BigInt(Math.round(params.maxBuyAmountSol*1e9)),blockhash,priorityFee:params.priorityFee})).transaction},
  tip:async(_c,p,b,l)=>createJitoTipTransaction(p,b,l),
  simulate:async(_c,txs,opts)=>{const accounts=opts?.accounts??[opts?.payer!];return {success:true,payerDebitLamports:accounts[0]===creator.publicKey.toBase58()?'10000000':'10000001',walletDebitsLamports:Object.fromEntries(accounts.map(address=>[address,address===creator.publicKey.toBase58()?'10000000':txs.some(tx=>tx.message.staticAccountKeys[0].toBase58()===address)?'10000001':'0'])),...(opts?.tokenAccounts?{tokenAccountDeltasRaw:Object.fromEntries(opts.tokenAccounts.map(item=>[item.address,item.expectedDeltaRaw]))}:{})}},
  sendSingle:async(_c,tx,opts)=>{opts?.onBroadcast?.();sent++;return {status:'confirmed',signature:signedTransactionSignature(tx),submitted:true}},
  sendBundle:async(_c,txs,opts)=>{opts?.onBroadcast?.();sent++;return {status:'confirmed',signatures:txs.map(signedTransactionSignature),submitted:true,bundleId:'bundle'}},
  verifyRouting:async(_c,routing,binding)=>{expect(routing.payer).toBe(binding.payer);expect(routing.mint).toBe(binding.mint);events.push('routing-verified')}}
 const keys=new Map([['buyer',buyer],['second-buyer',secondBuyer]])
 const guards={readSigner:()=>creator.publicKey.toBase58(),readBuyer:(id:string)=>locked?null:keys.get(id)??null}
 const options:LaunchBundleExecutionOptions={approved:true,...guards,signCreator:async txs=>txs.map(tx=>{tx.sign([creator]);return tx}),onInitialBroadcast:()=>{events.push('pending')},onInitialConfirmed:()=>{initialConfirmed=true;events.push('confirmed')},onReceipt:receipt=>{receipts.push(receipt);events.push('receipt')}}
 return {input,connection,ports,guards,options,receipts,events,creator,buyer,secondBuyer,mint,lock:()=>{locked=true},sent:()=>sent,setTime:(value:number)=>{time=value},addSecondBuyer:()=>{input.settings.wallets.push({walletId:'second-buyer',publicKey:secondBuyer.publicKey.toBase58(),name:'Second buyer',buySol:0.01,delaySeconds:1})}}
}
describe('reviewed inline bundle engine',()=>{
 it('composes a signed exact-output transfer in its buyer packet and persists detached original intent',async()=>{
  const h=await harness(),recipient=Keypair.generate().publicKey.toBase58();h.input.settings.wallets[0].transferTo=recipient
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports),intent=structuredClone(prepared.review.transfers)
  expect(intent).toHaveLength(1);expect(intent![0]).toMatchObject({walletId:'buyer',payer:h.buyer.publicKey.toBase58(),recipient,mint:h.mint.publicKey.toBase58(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),decimals:6})
  expect(TransactionMessage.decompile(prepared.transactions[1].message).instructions.at(-1)!.data.readBigUInt64LE(1).toString()).toBe(intent![0].rawAmount)
  prepared.review.transfers![0].recipient=Keypair.generate().publicKey.toBase58();h.input.settings.wallets[0].transferTo=Keypair.generate().publicKey.toBase58()
  let saved:unknown;const result=await executePreparedLaunchBundle(prepared,{...h.options,onInitialBroadcast:pending=>{saved=structuredClone(pending.bundleExecution?.transfers);pending.bundleExecution!.transfers![0].rawAmount='1'},onReceipt:receipt=>{receipt.tokenTransfers![0].recipient=Keypair.generate().publicKey.toBase58()}})
  expect(result.success,result.error).toBe(true);expect(result.tokenTransfers).toEqual(intent);expect(saved).toEqual(intent);expect(h.sent()).toBe(1)
 })
 it('aggregates shared recipient output once and charges each payer its actual simulated rent debit',async()=>{
  const h=await harness(),recipient=Keypair.generate().publicKey;h.addSecondBuyer();h.input.settings.wallets.forEach(wallet=>{wallet.transferTo=recipient.toBase58()})
  const simulate=h.ports.simulate!;let inspected:Parameters<LaunchBundlePorts['simulate']>[2]
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,simulate:async(...args)=>{inspected=args[2];const result=await simulate(...args);result.walletDebitsLamports![h.buyer.publicKey.toBase58()]='12000001';return result}})
  const account=getAssociatedTokenAddressSync(h.mint.publicKey,recipient,false,TOKEN_2022_PROGRAM_ID).toBase58(),tokens=inspected!.tokenAccounts!
  expect(tokens.filter(item=>item.address===account)).toHaveLength(1);expect(tokens.find(item=>item.address===account)!.expectedDeltaRaw).toBe(prepared.review.transfers!.reduce((sum,item)=>sum+BigInt(item.rawAmount),0n).toString())
  expect(prepared.review.wallets.map(wallet=>wallet.requiredLamports)).toEqual(['12000001','10000001']);expect((await executePreparedLaunchBundle(prepared,h.options)).success).toBe(true)
 })
 it('includes creator first buy and cross-participant incoming and outgoing output in net token expectations',async()=>{
  const h=await harness('block0',undefined,false,0.01);h.addSecondBuyer();h.input.settings.wallets[0].transferTo=h.secondBuyer.publicKey.toBase58();h.input.settings.wallets[1].transferTo=h.creator.publicKey.toBase58()
  const simulate=h.ports.simulate!;let inspected:Parameters<LaunchBundlePorts['simulate']>[2]
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,simulate:async(...args)=>{inspected=args[2];return simulate(...args)}}),tokens=inspected!.tokenAccounts!,amountFor=(owner:PublicKey)=>tokens.find(item=>item.owner===owner.toBase58())!.expectedDeltaRaw
  expect(amountFor(h.buyer.publicKey)).toBe('0');expect(amountFor(h.secondBuyer.publicKey)).toBe(prepared.review.transfers![0].rawAmount)
  expect(amountFor(h.creator.publicKey)).toBe((BigInt(prepared.creatorLaunchPlan.firstBuyTokenAmountRaw)+BigInt(prepared.review.transfers![1].rawAmount)).toString())
  const result=await executePreparedLaunchBundle(prepared,h.options);expect(result.success,result.error).toBe(true)
 })
 it('fails closed on absent unsigned or changed signed token evidence and mutated simulation expectations',async()=>{
  for(const when of ['unsigned','signed','mutated'] as const){
   const h=await harness();h.input.settings.wallets[0].transferTo=Keypair.generate().publicKey.toBase58();const simulate=h.ports.simulate!
   const ports={...h.ports,simulate:async(...args:Parameters<LaunchBundlePorts['simulate']>)=>{const result=await simulate(...args);if(when==='unsigned'&&!args[2]?.verifySignatures)delete result.tokenAccountDeltasRaw;if(when==='signed'&&args[2]?.verifySignatures)result.tokenAccountDeltasRaw![args[2].tokenAccounts![0].address]='1';if(when==='mutated'){args[2]!.tokenAccounts![0].expectedDeltaRaw='1';result.tokenAccountDeltasRaw![args[2]!.tokenAccounts![0].address]='1'}return result}}
   if(when==='signed'){const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,ports),result=await executePreparedLaunchBundle(prepared,h.options);expect(result.success).toBe(false);expect(result.error).toMatch(/token|transfer/i)}else await expect(prepareLaunchBundle(h.connection,h.input,h.guards,ports)).rejects.toThrow(/token|transfer/i)
   expect(h.sent()).toBe(0)
  }
 })
 it('keeps transfer originals on unknown broadcast and never submits the same prepared transfer twice',async()=>{
  const h=await harness();h.input.settings.wallets[0].transferTo=Keypair.generate().publicKey.toBase58()
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,sendBundle:async(_c,txs,opts)=>{opts?.onBroadcast?.();return {status:'unknown',signatures:txs.map(signedTransactionSignature),submitted:true,error:'lost response'}}}),intent=structuredClone(prepared.review.transfers),result=await executePreparedLaunchBundle(prepared,h.options)
  expect(intent).toHaveLength(1);expect(result.status).toBe('unknown');expect(result.tokenTransfers).toEqual(intent);expect(result.submittedSignatures).toHaveLength(3)
  await expect(executePreparedLaunchBundle(prepared,h.options)).rejects.toThrow(/already|used/i)
 })
 it('rejects an oversized composed buyer input with a clear packet limit before signing',async()=>{
  const h=await harness(),build=h.ports.buildFreshBuy!;h.input.settings.wallets[0].transferTo=Keypair.generate().publicKey.toBase58()
  await expect(prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,buildFreshBuy:async args=>{const built=await build(args);built.transaction.message.compiledInstructions[0].data=new Uint8Array(1600);return built}})).rejects.toThrow(/packet.*size|1232|1,232/i)
  expect(h.sent()).toBe(0)
 })
 it('rejects insufficient SOL including recipient rent and stops on failed transfer simulation',async()=>{
  for(const failure of ['balance','simulation'] as const){const h=await harness();h.input.settings.wallets[0].transferTo=Keypair.generate().publicKey.toBase58();if(failure==='balance')h.connection.getBalance=async()=>1000
   await expect(prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,...(failure==='simulation'?{simulate:async()=>({success:false,error:'transfer compute budget exceeded'})}:{})})).rejects.toThrow(failure==='balance'?/insufficient SOL/i:/compute budget/i);expect(h.sent()).toBe(0)
  }
 })
 it('cancels a composed launch before broadcast and retains its public transfer intent',async()=>{
  const h=await harness(),abort=new AbortController(),simulate=h.ports.simulate!;h.input.settings.wallets[0].transferTo=Keypair.generate().publicKey.toBase58()
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,simulate:async(...args)=>{const value=await simulate(...args);if(args[2]?.verifySignatures)abort.abort();return value}}),result=await executePreparedLaunchBundle(prepared,{...h.options,signal:abort.signal})
  expect(result.success).toBe(false);expect(result.status).toBe('failed');expect(result.error).toMatch(/abort|cancel/i);expect(result.tokenTransfers).toEqual(prepared.review.transfers);expect(h.sent()).toBe(0)
 })
 it('saves a conservative public action outcome before broadcasting an interruptible launch',async()=>{
  const h=await harness('organic'),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports)
  const result=await executePreparedLaunchBundle(prepared,{...h.options,onInitialBroadcast:pending=>{expect(pending.bundleExecution).toMatchObject({mode:'organic',buyerCount:1,status:'partial'});h.options.onInitialBroadcast(pending)}})
  expect(result.success).toBe(true)
 })
 it('requires an exact native launch plan instead of trusting compatibility packets',async()=>{
  const h=await harness(),build=h.ports.buildCreate!
  await expect(prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,buildCreate:async params=>({...await build(params),launchPlan:undefined})})).rejects.toThrow(/plan/i)
 })
 it('prepares all reviewed fee routes with maximum metadata and two immediate buyers while retaining first buy and setup',async()=>{
  for(const selection of [{kind:'deployer'},{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards'},{kind:'github',username:'octocat'}] as CreatorFeeSelection[]){
   const h=await harness('block0',selection,true,0.01);h.addSecondBuyer()
   const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports)
   expect(prepared.review.creatorFeeRouting.selection.kind).toBe(selection.kind)
   expect(prepared.transactions).toHaveLength(5)
   const result=await executePreparedLaunchBundle(prepared,h.options)
   expect(result.success,result.error).toBe(true);expect(result.creatorFeeRouting).toEqual(prepared.review.creatorFeeRouting)
   expect(result.buySignatures).toHaveLength(2);expect(h.events.indexOf('routing-verified')).toBeLessThan(h.events.indexOf('confirmed'))
  }
 })
 it('preserves pending routing and stops before confirmation callback or future buys when chain routing verification fails',async()=>{
  const h=await harness('manual',{kind:'holder-rewards'}),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,verifyRouting:async()=>{throw new Error('On-chain creator fee routing differs')}})
  let routing:unknown
  const result=await executePreparedLaunchBundle(prepared,{...h.options,onInitialBroadcast:pending=>{routing=pending.creatorFeeRouting;h.options.onInitialBroadcast(pending)}})
  expect(result.status).toBe('unknown');expect(result.error).toMatch(/routing differs/i);expect(routing).toEqual(prepared.review.creatorFeeRouting);expect(h.sent()).toBe(1);expect(h.events).not.toContain('confirmed')
 })
 it('rejects malformed present selections and self-consistent native plans that differ from approved input',async()=>{
  const h=await harness(),build=h.ports.buildCreate!
  for(const selection of [null,{kind:'cashback'},{kind:'unknown'}])await expect(prepareLaunchBundle(h.connection,{...h.input,creatorFeeSelection:selection as never},h.guards,h.ports)).rejects.toThrow()
  await expect(prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,buildCreate:params=>build({...params,metadata:{...params.metadata,name:'Changed after approval'}})})).rejects.toThrow(/approved|metadata|plan/i)
  const holder=await harness('block0',{kind:'holder-rewards'})
  await expect(prepareLaunchBundle(holder.connection,holder.input,holder.guards,{...holder.ports,buildCreate:params=>build({...params,creatorFeeSelection:{kind:'deployer'}})})).rejects.toThrow(/routing|approved/i)
 })
 it('rejects an appended buyer using another creator vault without signing or broadcasting',async()=>{
  const h=await harness('block0',{kind:'holder-rewards'}),build=h.ports.buildFreshBuy!
  await expect(prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,buildFreshBuy:async params=>{const next=await build(params);return {...next,transaction:wrongVault(next.transaction)}}})).rejects.toThrow(/creator vault/i)
  expect(h.sent()).toBe(0)
 })
 it('rejects a later manual buy when fresh chain state routes to a different creator vault',async()=>{
  const h=await harness('manual',{kind:'holder-rewards'}),build=h.ports.buildBuy!,prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,buildBuy:async params=>wrongVault(await build(params))})
  const result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.status).toBe('partial');expect(result.error).toMatch(/creator vault/i);expect(h.sent()).toBe(1)
 })
 it('awaits chain routing verification before confirming the initial launch or quoting future buys',async()=>{
  const h=await harness('manual',{kind:'holder-rewards'});let release!:()=>void,entered!:()=>void
  const enteredPromise=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,verifyRouting:async()=>{entered();await gate}}),execution=executePreparedLaunchBundle(prepared,h.options)
  await enteredPromise;expect(h.events).not.toContain('confirmed');expect(h.sent()).toBe(1)
  release();expect((await execution).success).toBe(true)
 })
 it('isolates public plan, review, builder objects and journal callback copies from canonical runtime intent',async()=>{
  const h=await harness('block0',{kind:'holder-rewards'}),build=h.ports.buildCreate!;let builderResult:Awaited<ReturnType<typeof build>>|undefined
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,buildCreate:async params=>{builderResult=await build(params);return builderResult}}),expected=structuredClone(prepared.review.creatorFeeRouting)
  prepared.review.creatorFeeRouting.effectiveCreator=Keypair.generate().publicKey.toBase58();prepared.creatorLaunchPlan.routing.effectiveCreator=Keypair.generate().publicKey.toBase58();prepared.creatorLaunchPlan.packets[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();builderResult!.launchPlan!.routing.effectiveCreator=Keypair.generate().publicKey.toBase58();builderResult!.nativeContext!.curve.creator=Keypair.generate().publicKey
  const result=await executePreparedLaunchBundle(prepared,{...h.options,onInitialBroadcast:pending=>{pending.creatorFeeRouting!.effectiveCreator=Keypair.generate().publicKey.toBase58();h.options.onInitialBroadcast(pending)},onReceipt:receipt=>{receipt.creatorFeeRouting!.effectiveCreator=Keypair.generate().publicKey.toBase58();h.options.onReceipt(receipt)}})
  expect(result.success,result.error).toBe(true);expect(result.creatorFeeRouting).toEqual(expected)
 })
 it('prepares the actual atomic buyers, all wallet costs and the selected mint without signing buyers or sending',async()=>{
  const h=await harness(),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports)
  expect(prepared.review.mint).toBe(h.mint.publicKey.toBase58());expect(prepared.transactions).toHaveLength(3)
  expect(prepared.review.initialDebitLamports).toBe('20000001');expect(prepared.review.wallets[0].initialDebitLamports).toBe('10000001')
  expect(prepared.review.totalRequirementLamports).toBe('20000001');expect(h.sent()).toBe(0)
  expect(JSON.stringify(prepared)).not.toMatch(/secretKey|privateKey|mintKeypair/)
 })
 it('signs the reviewed atomic plan and checkpoints originals before broadcast',async()=>{
  const h=await harness(),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports)
  const result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.success).toBe(true);expect(h.sent()).toBe(1);expect(result.submittedSignatures).toHaveLength(3)
  expect(result.submissions?.map(item=>item.payer)).toEqual([h.creator.publicKey.toBase58(),h.buyer.publicKey.toBase58(),h.creator.publicKey.toBase58()])
  expect(h.events.slice(0,2)).toEqual(['pending','receipt']);expect(h.events).toContain('confirmed')
  await expect(executePreparedLaunchBundle(prepared,h.options)).rejects.toThrow(/already|used/i)
 })
 it('rejects a changed creator message and never broadcasts',async()=>{
  const h=await harness(),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports)
  const result=await executePreparedLaunchBundle(prepared,{...h.options,signCreator:async txs=>{txs[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();return txs}})
  expect(result.success).toBe(false);expect(result.error).toMatch(/message|changed/i);expect(h.sent()).toBe(0)
 })
 it('stops if any selected buyer locks after preparation',async()=>{
  const h=await harness(),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports);h.lock()
  const result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.success).toBe(false);expect(result.error).toMatch(/locked|changed/i);expect(h.sent()).toBe(0)
 })
 it('confirms creation before quoting future buys and carries their explicit reserve in the review',async()=>{
  const h=await harness('manual'),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports)
  expect(prepared.review.wallets[0].initialDebitLamports).toBe('0');expect(prepared.review.wallets[0].followupReserveLamports).toBe('10100000')
  const result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.error).toBeUndefined();expect(result.success).toBe(true);expect(h.sent()).toBe(2);expect(result.buySignatures).toHaveLength(1)
 })
 it('refuses expired preparation before invoking a signer',async()=>{
  const h=await harness(),prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,h.ports);h.setTime(62_000)
  let signed=false;const result=await executePreparedLaunchBundle(prepared,{...h.options,signCreator:async txs=>{signed=true;return txs}})
  expect(result.error).toMatch(/expired/i);expect(signed).toBe(false);expect(h.sent()).toBe(0)
 })
 it('rejects a simulation port that substitutes a different unsigned message',async()=>{
  const h=await harness(),original=h.ports.simulate!
  await expect(prepareLaunchBundle(h.connection,h.input,h.guards,{...h.ports,simulate:async(c,txs,opts)=>{txs[0].message.recentBlockhash=Keypair.generate().publicKey.toBase58();return original(c,txs,opts)}})).rejects.toThrow(/changed|message/i)
  expect(h.sent()).toBe(0)
 })
 it('requires every signed wallet debit to still match the approved atomic review',async()=>{
  const h=await harness(),original=h.ports.simulate!,ports={...h.ports,simulate:async(...args:Parameters<LaunchBundlePorts['simulate']>)=>{const value=await original(...args);if(args[2]?.verifySignatures)value.walletDebitsLamports![h.buyer.publicKey.toBase58()]='10000002';return value}}
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,ports),result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.success).toBe(false);expect(result.error).toMatch(/cost.*changed/i);expect(h.sent()).toBe(0)
 })
 it('keeps original pending evidence and stops all followups when initial confirmation is unknown',async()=>{
  const h=await harness('manual'),ports={...h.ports,sendSingle:async(c:Connection,tx:VersionedTransaction,opts?:Parameters<LaunchBundlePorts['sendSingle']>[2])=>{opts?.onBroadcast?.();return {status:'unknown' as const,signature:signedTransactionSignature(tx),submitted:true,error:'lost response'}}}
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,ports),result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.status).toBe('unknown');expect(result.createSignature).toBeTruthy();expect(result.submittedSignatures).toEqual([result.createSignature]);expect(result.buySignatures).toEqual([])
  expect(h.events).not.toContain('confirmed')
 })
 it('stops future buys before broadcast when a fresh signed simulation exceeds the approved reserve',async()=>{
  const h=await harness('organic'),original=h.ports.simulate!,ports={...h.ports,simulate:async(...args:Parameters<LaunchBundlePorts['simulate']>)=>{const value=await original(...args);if(args[2]?.payer===h.buyer.publicKey.toBase58())value.walletDebitsLamports![h.buyer.publicKey.toBase58()]='99999999';return value}}
  const prepared=await prepareLaunchBundle(h.connection,h.input,h.guards,ports),result=await executePreparedLaunchBundle(prepared,h.options)
  expect(result.status).toBe('partial');expect(result.error).toMatch(/budget|reserve/i);expect(h.sent()).toBe(1);expect(result.submittedSignatures).toHaveLength(1)
 })
})
