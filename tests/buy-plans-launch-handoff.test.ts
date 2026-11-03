import {describe,expect,it} from 'vitest'
import {Connection,Keypair} from '@solana/web3.js'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS,parseLaunchBundleSettings,usesAutomaticLaunchBuyers} from '../src/lib/launchBundle/types'
import {saveStagedLaunchPlan,attachStagedLaunchMint,assertStagedLaunchPlan} from '../src/lib/buyPlans/launchHandoff'
import {readBuyPlan} from '../src/lib/buyPlans/model'
import {prepareLaunchBundle} from '../src/lib/launchBundle/prepare'
const storage=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
const settings=()=>({...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0' as const,deferBuys:true,groupId:crypto.randomUUID(),wallets:[{walletId:'buyer',publicKey:Keypair.generate().publicKey.toBase58(),name:'Buyer',buySol:0.01,delaySeconds:2,transferTo:Keypair.generate().publicKey.toBase58()}]})
const fees={slippage:5,priorityFeeSol:0.0001}
describe('explicit deploy now and buy later launch handoff',()=>{
 it('keeps legacy modes automatic while deferred settings roundtrip safely without immediate buyers',()=>{
  const legacy={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'manual' as const,groupId:'group',wallets:settings().wallets}
  expect(usesAutomaticLaunchBuyers(legacy)).toBe(true)
  const deferred=parseLaunchBundleSettings({...legacy,deferBuys:true,stagedPlanId:'saved-plan'})
  expect(deferred.deferBuys).toBe(true);expect(deferred.stagedPlanId).toBe('saved-plan');expect(usesAutomaticLaunchBuyers(deferred)).toBe(false)
  expect(parseLaunchBundleSettings(DEFAULT_LAUNCH_BUNDLE_SETTINGS)).toEqual(DEFAULT_LAUNCH_BUNDLE_SETTINGS)
 })
 it('saves public receiver bindings once and attaches only the matching confirmed mint',()=>{
  const disk=storage(),input=settings(),first=saveStagedLaunchPlan(input,fees,disk),plan=readBuyPlan(disk)!,before=JSON.stringify(plan)
  expect(first.stagedPlanId).toBe(plan.id);expect(plan.mint).toBeUndefined();expect(plan.rows[0]).toMatchObject({walletId:'buyer',transferTo:input.wallets[0].transferTo,buySol:'0.01'})
  saveStagedLaunchPlan(first,fees,disk);expect(JSON.stringify(readBuyPlan(disk))).toBe(before)
  const mint=Keypair.generate().publicKey.toBase58();attachStagedLaunchMint(first,fees,mint,disk)
  expect(readBuyPlan(disk)?.mint).toBe(mint)
  expect(()=>attachStagedLaunchMint(first,fees,Keypair.generate().publicKey.toBase58(),disk)).toThrow(/different|already/i)
  expect(()=>assertStagedLaunchPlan(first,{...fees,slippage:10},disk)).toThrow(/changed|settings/i)
  expect(()=>attachStagedLaunchMint({...first,stagedPlanId:'other'},fees,mint,disk)).toThrow(/match|missing/i)
 })
 it('rejects deferred buyer settings at the existing automatic bundle engine before construction',async()=>{
  const mint=Keypair.generate(),payer=Keypair.generate().publicKey.toBase58()
  await expect(prepareLaunchBundle({} as Connection,{payer,mintKeypair:mint,metadata:{name:'T',symbol:'T',uri:'ipfs://test'},devBuySol:0,slippage:5,priorityFeeSol:0,jitoTipSol:0.00001,settings:settings()},{readSigner:()=>payer,readBuyer:()=>null})).rejects.toThrow(/defer|staged|later/i)
 })
 it('preserves a reviewed cumulative observed-buy guard through public preparation and mint attachment',()=>{
  const disk=storage(),guard={minBuySol:'5',whitelist:[Keypair.generate().publicKey.toBase58()]},prepared=saveStagedLaunchPlan({...settings(),observedBuyGuard:guard},fees,disk)
  expect(parseLaunchBundleSettings(prepared).observedBuyGuard).toEqual(guard)
  expect(readBuyPlan(disk)?.observedBuyGuard).toEqual(guard)
  const attached=attachStagedLaunchMint(prepared,fees,Keypair.generate().publicKey.toBase58(),disk)
  expect(attached?.observedBuyGuard).toEqual(guard)
 })
})
