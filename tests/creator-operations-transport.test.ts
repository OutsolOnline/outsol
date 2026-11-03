import {afterEach,describe,expect,it,vi} from 'vitest'
import {AddressLookupTableProgram,Connection,Keypair,PublicKey,SystemProgram,type AccountInfo} from '@solana/web3.js'
import {MintLayout,TOKEN_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token'
import {OnlinePumpSdk,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,bondingCurvePda,feeSharingConfigPda,getPumpProgram,getPumpFeeProgram} from '@pump-fun/pump-sdk'
import BN from 'bn.js'
import {inspectCreatorState} from '../src/lib/creatorOperations/inspect'
import {buildCreatorRecipe,compileCreatorRecipe} from '../src/lib/creatorOperations/native'
import {simulateCreatorOperation,validateCreatorSimulation,type CreatorSimulationBank} from '../src/lib/creatorOperations/simulation'
import type {CreatorOperationInput,CreatorOperationIntent,CreatorState} from '../src/lib/creatorOperations/model'
import {readTokenFacts} from '../src/lib/tokenFacts'

const key=(seed:number)=>Keypair.fromSeed(new Uint8Array(32).fill(seed)),payer=key(111),mint=key(112).publicKey,recipient=key(113).publicKey,sharing=feeSharingConfigPda(mint),curve=bondingCurvePda(mint)
const info=(owner:PublicKey,data:Buffer=Buffer.alloc(0),lamports=1000000):AccountInfo<Buffer>=>({owner,data,lamports,executable:false,rentEpoch:0})
function mintInfo(){const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return info(TOKEN_PROGRAM_ID,data)}
async function curveInfo(creator=payer.publicKey,creatorFee=0){return info(PUMP_PROGRAM_ID,await getPumpProgram(null as unknown as Connection).coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN(1000000),virtualQuoteReserves:new BN(1000000),realTokenReserves:new BN(1000000),realQuoteReserves:new BN(1000000),tokenTotalSupply:new BN(1000000),complete:false,creator,isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:new BN(0),canEditCreatorFee:false,isHolderReward:false,creatorFee:new BN(creatorFee),protocolFees:new BN(0),depth:0,initialVirtualQuoteReserves:new BN(1000000),postCompleteBaseOut:new BN(0),postCompleteQuoteIn:new BN(0)}))}
async function sharingInfo(revoked=false){return info(PUMP_FEE_PROGRAM_ID,await getPumpFeeProgram(null as unknown as Connection).coder.accounts.encode('sharingConfig',{bump:1,version:2,status:{active:{}},mint,admin:payer.publicKey,adminRevoked:revoked,shareholders:[{address:recipient,shareBps:10000}]}))}
const raw=(account:AccountInfo<Buffer>|null)=>account?{owner:account.owner.toBase58(),lamports:account.lamports,data:[account.data.toString('base64'),'base64'],executable:false}:null
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

describe('confirmed creator account inspection',()=>{
 it('decodes real official account bytes and exposes the actual sharing administrator',async()=>{
  const bank=[mintInfo(),await curveInfo(sharing),await sharingInfo(),null]
  vi.spyOn(OnlinePumpSdk.prototype,'getCreatorVaultBalanceBothPrograms').mockResolvedValue(new BN(123456))
  const connection={getMultipleAccountsInfoAndContext:async()=>({context:{slot:100},value:bank})} as unknown as Connection
  const state=await inspectCreatorState(connection,mint.toBase58())
  expect(state).toMatchObject({creator:sharing.toBase58(),vaultBalanceLamports:'123456',sharing:{version:2,admin:payer.publicKey.toBase58(),adminRevoked:false,shareholders:[{address:recipient.toBase58(),shareBps:10000}]}})
  expect((await readTokenFacts({...connection,getMultipleAccountsInfoAndContext:async()=>({context:{slot:100},value:bank.slice(0,3)})} as unknown as Connection,mint.toBase58())).feeSharing?.admin).toBe(payer.publicKey.toBase58())
 })
 it('rejects foreign sharing ownership, missing current configuration and a locked signer after the RPC await',async()=>{
  const base=[mintInfo(),await curveInfo(sharing),await sharingInfo(),null]
  for(const value of [[base[0],base[1],info(SystemProgram.programId),null],[base[0],base[1],null,null]])await expect(inspectCreatorState({getMultipleAccountsInfoAndContext:async()=>({context:{slot:100},value})} as unknown as Connection,mint.toBase58())).rejects.toThrow()
  let checks=0
  await expect(inspectCreatorState({getMultipleAccountsInfoAndContext:async()=>({context:{slot:100},value:base})} as unknown as Connection,mint.toBase58(),()=>{if(++checks===2)throw new Error('Wallet locked')})).rejects.toThrow(/locked/)
 })
})

describe('creator simulation transport',()=>{
 it('simulates actual signed native bytes with signature verification and unchanged blockhash, then checks real sharing output',async()=>{
  const input:CreatorOperationInput={version:1,kind:'shares',mint:mint.toBase58(),payer:payer.publicKey.toBase58(),priorityFeeLamports:'0',shares:[{address:recipient.toBase58(),shareBps:10000}]},state:CreatorState={mint:input.mint,creator:input.payer,complete:false,holderReward:false,cashback:false,curveFeeLamports:'0',vaultBalanceLamports:'0',slot:100,checkedAt:Date.now()},intent:CreatorOperationIntent={version:1,input,scope:'mint'}
  const recipe=await buildCreatorRecipe({} as Connection,input,state),tx=compileCreatorRecipe(input,recipe,key(114).publicKey.toBase58());tx.sign([payer])
  const curveBefore=await curveInfo(),curveAfter=await curveInfo(sharing),sharingAfter=await sharingInfo(true);let verified=false,wrongRoute=false
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{
   const body=JSON.parse(String(init.body)),config=body.params[1],addresses:string[]=config.preExecutionAccountsConfigs[0].addresses
   expect(config).toMatchObject({skipSigVerify:false,replaceRecentBlockhash:false,transactionEncoding:'base64'})
   expect(body.params[0].encodedTransactions).toEqual([Buffer.from(tx.serialize()).toString('base64')]);verified=true
   const at=(address:string,after:boolean)=>address===input.payer?raw(info(SystemProgram.programId,Buffer.alloc(0),after?8995000:10000000)):address===curve.toBase58()?raw(after&&!wrongRoute?curveAfter:curveBefore):address===sharing.toBase58()?after?raw(sharingAfter):null:null
   return Response.json({jsonrpc:'2.0',id:1,result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:addresses.map(address=>at(address,false)),postExecutionAccounts:addresses.map(address=>at(address,true))}]}}})
  })
  const connection={rpcEndpoint:'https://outsol.test/api/rpc',getMultipleAccountsInfo:async()=>[],getFeeForMessage:async()=>({value:5000})} as unknown as Connection
  const preview=await simulateCreatorOperation(connection,tx,intent,state,undefined,true)
  expect(verified).toBe(true);expect(preview).toMatchObject({payerBeforeLamports:'10000000',payerAfterLamports:'8995000',networkFeeLamports:'5000',maxDebitLamports:'1005000'})
  wrongRoute=true
  await expect(simulateCreatorOperation(connection,tx,intent,state,undefined,true)).rejects.toThrow(/creator|shares|review/i)
 })
 it('checks lookup contents and exact rent before presenting setup costs',()=>{
  const input:CreatorOperationInput={version:1,kind:'lookup',mint:mint.toBase58(),payer:payer.publicKey.toBase58(),priorityFeeLamports:'0',addresses:[recipient.toBase58()]},address=key(115).publicKey.toBase58(),intent:CreatorOperationIntent={version:1,input,scope:'mint',lookupAddress:address,lookupRecentSlot:90}
  const data=Buffer.alloc(88);data.writeUInt32LE(1);data.writeBigUInt64LE(18446744073709551615n,4);data.writeBigUInt64LE(90n,12);data[21]=1;payer.publicKey.toBuffer().copy(data,22);recipient.toBuffer().copy(data,56)
  const bank:CreatorSimulationBank={addresses:[input.payer,address],before:[raw(info(SystemProgram.programId,Buffer.alloc(0),10000000)),null],after:[raw(info(SystemProgram.programId,Buffer.alloc(0),8995000)),raw(info(AddressLookupTableProgram.programId,data,1000000))],networkFeeLamports:'5000'}
  const state={mint:input.mint} as CreatorState
  expect(validateCreatorSimulation(intent,bank,state).lookupRentLamports).toBe('1000000')
  bank.after[0]=raw(info(SystemProgram.programId,Buffer.alloc(0),8994999))
  expect(()=>validateCreatorSimulation(intent,bank,state)).toThrow(/cost/i)
 })
 it('builds a real shared distribution using existing on-chain recipients and sweeps before it',async()=>{
  const before=await curveInfo(sharing,50000),current=await sharingInfo(),input:CreatorOperationInput={version:1,kind:'distribute',mint:mint.toBase58(),payer:payer.publicKey.toBase58(),priorityFeeLamports:'0'}
  const state:CreatorState={mint:input.mint,creator:sharing.toBase58(),slot:100,checkedAt:Date.now(),complete:false,holderReward:false,cashback:false,curveFeeLamports:'50000',vaultBalanceLamports:'1000000',sharing:{address:sharing.toBase58(),version:2,admin:payer.publicKey.toBase58(),adminRevoked:false,shareholders:[{address:recipient.toBase58(),shareBps:10000}]}}
  const connection={getMultipleAccountsInfo:async()=>[current,null,null,before]} as unknown as Connection
  const recipe=await buildCreatorRecipe(connection,input,state)
  expect(recipe.instructions.map(ix=>ix.programId.toBase58())).toEqual([PUMP_PROGRAM_ID.toBase58(),PUMP_PROGRAM_ID.toBase58()])
  expect(recipe.instructions.at(-1)?.keys.some(row=>row.pubkey.equals(recipient)&&row.isWritable)).toBe(true)
 })
})
