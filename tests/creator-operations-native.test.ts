import {afterEach,describe,expect,it,vi} from 'vitest'
import {AddressLookupTableAccount,Connection,Keypair,PublicKey} from '@solana/web3.js'
import {PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_SDK,feeSharingConfigPda} from '@pump-fun/pump-sdk'
import {buildCreatorRecipe,assertCreatorEligibility,CreatorLookupRequired,compileCreatorRecipe} from '../src/lib/creatorOperations/native'
import {validateCreatorSimulation} from '../src/lib/creatorOperations/simulation'
import type {CreatorOperationInput,CreatorState} from '../src/lib/creatorOperations/model'

const payer=Keypair.fromSeed(new Uint8Array(32).fill(61)).publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey.toBase58()
const wallet=Keypair.fromSeed(new Uint8Array(32).fill(63)).publicKey.toBase58(),blockhash=Keypair.generate().publicKey.toBase58()
function state():CreatorState{return{mint,slot:100,checkedAt:Date.now(),creator:payer,complete:false,holderReward:false,cashback:false,curveFeeLamports:'0',vaultBalanceLamports:'1000000'}}
const input=(kind:'collect'|'distribute'|'shares'):CreatorOperationInput=>({version:1,mint,payer,kind,priorityFeeLamports:'1000',...(kind==='shares'?{shares:[{address:wallet,shareBps:10000}]}:{})}) as CreatorOperationInput
afterEach(()=>vi.restoreAllMocks())

describe('native creator operation recipes',()=>{
 it('constructs a native wallet-wide collect with curve sweep before collection and no third-party transfer',async()=>{
  const before=state();before.curveFeeLamports='123'
  const connection={getMultipleAccountsInfo:async()=>[null,null]} as unknown as Connection
  const recipe=await buildCreatorRecipe(connection,input('collect'),before)
  expect(recipe.instructions[0].programId.equals(PUMP_PROGRAM_ID)).toBe(true)
  expect(recipe.instructions.filter(ix=>ix.programId.equals(PUMP_PROGRAM_ID))).toHaveLength(2)
  const tx=compileCreatorRecipe(input('collect'),recipe,blockhash)
  expect(tx.message.staticAccountKeys[0].toBase58()).toBe(payer)
  expect(tx.message.header.numRequiredSignatures).toBe(1)
 })
 it('creates native fee sharing before setting the exact reviewed recipients',async()=>{
  const recipe=await buildCreatorRecipe({} as Connection,input('shares'),state())
  expect(recipe.instructions.map(ix=>ix.programId.toBase58())).toEqual([PUMP_FEE_PROGRAM_ID.toBase58(),PUMP_FEE_PROGRAM_ID.toBase58()])
  const last=recipe.instructions.at(-1)!
  expect(last.data.readUInt32LE(8)).toBe(1)
  expect(new PublicKey(last.data.subarray(12,44)).toBase58()).toBe(wallet)
  expect(last.data.readUInt16LE(44)).toBe(10000)
 })
 it('refuses social and holder authorities, immutable/foreign sharing admins and unsupported share versions',()=>{
  const before=state();before.holderReward=true
  expect(()=>assertCreatorEligibility(input('collect'),before)).toThrow(/holder/i)
  before.holderReward=false;before.creator=feeSharingConfigPda(new PublicKey(mint)).toBase58()
  before.sharing={address:before.creator,version:2,admin:wallet,adminRevoked:false,shareholders:[{address:wallet,shareBps:10000}]}
  expect(()=>assertCreatorEligibility(input('collect'),before)).toThrow(/wallet/i)
  before.pool={address:Keypair.generate().publicKey.toBase58(),creator:payer,feeLamports:'0'}
  expect(()=>assertCreatorEligibility(input('collect'),before)).toThrow(/wallet/i)
  expect(()=>assertCreatorEligibility(input('shares'),before)).toThrow(/administrator/i)
  before.sharing.admin=payer;before.sharing.adminRevoked=true
  expect(()=>assertCreatorEligibility(input('shares'),before)).toThrow(/immutable/i)
  before.sharing.adminRevoked=false;before.sharing.version=1
  expect(()=>assertCreatorEligibility(input('shares'),before)).toThrow(/immutable/i)
 })
 it('requires account lookup setup instead of truncating ten shares when packet capacity is exceeded',async()=>{
  const before=state();before.creator=feeSharingConfigPda(new PublicKey(mint)).toBase58()
  before.sharing={address:before.creator,version:2,admin:payer,adminRevoked:false,shareholders:Array.from({length:10},(_,i)=>({address:Keypair.fromSeed(new Uint8Array(32).fill(i+70)).publicKey.toBase58(),shareBps:1000}))}
  const configuration={...input('shares'),kind:'shares' as const,shares:Array.from({length:10},(_,i)=>({address:Keypair.fromSeed(new Uint8Array(32).fill(i+90)).publicKey.toBase58(),shareBps:1000}))}
  const recipe=await buildCreatorRecipe({} as Connection,configuration,before)
  let addresses:string[]=[]
  try{compileCreatorRecipe(configuration,recipe,blockhash);throw new Error('Expected lookup requirement')}catch(error){expect(error).toBeInstanceOf(CreatorLookupRequired);addresses=(error as CreatorLookupRequired).addresses;expect(addresses.length).toBeLessThanOrEqual(20)}
  const table=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{deactivationSlot:18446744073709551615n,lastExtendedSlot:10,lastExtendedSlotStartIndex:0,authority:new PublicKey(payer),addresses:addresses.map(value=>new PublicKey(value))}})
  const compact=compileCreatorRecipe(configuration,recipe,blockhash,table)
  expect(compact.serialize().length).toBeLessThanOrEqual(1232)
  expect(compact.message.addressTableLookups).toHaveLength(1)
 })
})

describe('same-bank creator simulation verification',()=>{
 const account=(lamports:number)=>({owner:'11111111111111111111111111111111',lamports,data:['','base64'],executable:false})
 function bank(){return{addresses:[payer,wallet],before:[account(2000000),account(100000)],after:[account(1995000),account(100000)],networkFeeLamports:'5000'}}
 it('reports exact wallet net changes and fees without calling wallet-wide proceeds mint-specific rewards',()=>{
  const data=bank();data.after[0].lamports=2995000
  const preview=validateCreatorSimulation({version:1,input:input('collect'),scope:'wallet-wide'},data,state())
  expect(preview).toMatchObject({payerBeforeLamports:'2000000',payerAfterLamports:'2995000',networkFeeLamports:'5000',maxDebitLamports:'0'})
 })
 it('rejects absent, unsafe or executable account evidence rather than accepting an incomplete simulation',()=>{
  for(const change of [(data:ReturnType<typeof bank>)=>{data.after=[]},(data:ReturnType<typeof bank>)=>{data.after[0].lamports=Number.MAX_SAFE_INTEGER+1},(data:ReturnType<typeof bank>)=>{data.after[0].executable=true}]){const data=bank();change(data);expect(()=>validateCreatorSimulation({version:1,input:input('collect'),scope:'wallet-wide'},data,state())).toThrow()}
 })
 it('verifies the exact sharing result from program-owned account bytes',()=>{
  const sharing=feeSharingConfigPda(new PublicKey(mint)).toBase58(),before=state(),data=bank()
  data.addresses.push(sharing);data.before.push(null as never);data.after.push({owner:PUMP_FEE_PROGRAM_ID.toBase58(),lamports:100000,data:['AA==','base64'],executable:false})
  vi.spyOn(PUMP_SDK,'decodeSharingConfig').mockReturnValue({mint:new PublicKey(mint),version:2,admin:new PublicKey(payer),adminRevoked:false,shareholders:[{address:new PublicKey(wallet),shareBps:9999}]} as never)
  expect(()=>validateCreatorSimulation({version:1,input:input('shares'),scope:'mint'},data,before)).toThrow(/shares/i)
 })
})
