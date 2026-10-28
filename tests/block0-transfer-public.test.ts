import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import bs58 from 'bs58'
import {parseLaunchBundleSettings,DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
import {publicLaunchBundleOutcome} from '../src/lib/launchBundle/receipt'
import {publicBundleReceipt} from '../src/lib/bundler/receipt'
import {persistBundleCheckpoint,readPendingBundleReceipt} from '../src/lib/bundler/pending'
import {publicPending,samePending} from '../src/lib/launchHistory'
const key=()=>Keypair.generate().publicKey.toBase58()
function transfer(){return {walletId:'buyer',payer:key(),recipient:key(),mint:key(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),rawAmount:'123456789012345',decimals:6}}
describe('public Block-0 transfer intent',()=>{
 it('round-trips only public recipient settings and supports legacy rows',()=>{
  const wallet={walletId:'buyer',publicKey:key(),name:'Buyer',buySol:1,delaySeconds:0},settings={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0' as const,groupId:'group',wallets:[{...wallet,transferTo:key()}]}
  expect(parseLaunchBundleSettings(settings)).toEqual(settings)
  expect(parseLaunchBundleSettings({...settings,wallets:[wallet]}).wallets[0]).toEqual(wallet)
  for(const recipient of [wallet.publicKey,'bad',null,'',Keypair.generate().publicKey.toBase58()+' '])expect(()=>parseLaunchBundleSettings({...settings,wallets:[{...wallet,transferTo:recipient}]})).toThrow()
  expect(()=>parseLaunchBundleSettings({...settings,mode:'manual'})).toThrow(/Block-0/)
  expect(()=>parseLaunchBundleSettings({...settings,wallets:[{...settings.wallets[0],privateKey:'secret'}]})).toThrow(/public/i)
 })
 it('copies allowlisted outcome intent and leaves old outcomes readable',()=>{
  const intent=transfer(),legacy={mode:'block0' as const,buyerCount:1,status:'partial' as const},outcome=publicLaunchBundleOutcome({...legacy,transfers:[{...intent,privateKey:'secret'}]})
  expect(outcome).toEqual({...legacy,transfers:[intent]});expect(publicLaunchBundleOutcome(legacy)).toEqual(legacy)
  for(const invalid of [{...intent,rawAmount:'0'},{...intent,recipient:intent.payer},{...intent,tokenProgram:key()},{...intent,decimals:256}])expect(()=>publicLaunchBundleOutcome({...legacy,transfers:[invalid]})).toThrow()
 })
 it('persists exact public transfer recovery intent and refuses changes while unknown',()=>{
  const intent=transfer(),signature=bs58.encode(new Uint8Array(64).fill(7)),values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
  const receipt={success:false,status:'unknown' as const,mintAddress:intent.mint,submittedSignatures:[signature],tokenTransfers:[{...intent,secretKey:'secret'}]}
  persistBundleCheckpoint(receipt,storage)
  expect(readPendingBundleReceipt(storage)?.tokenTransfers).toEqual([intent]);expect([...values.values()].join('')).not.toContain('secret')
  expect(publicBundleReceipt({...receipt,tokenTransfers:[intent]} as never)?.tokenTransfers).toEqual([intent])
  for(const tokenTransfers of [undefined,[{...intent,recipient:key()}],[{...intent,rawAmount:'1'}]])expect(()=>persistBundleCheckpoint({...receipt,tokenTransfers},storage)).toThrow(/transfer/i)
  persistBundleCheckpoint({...receipt,success:true,status:'confirmed'},storage)
  expect(readPendingBundleReceipt(storage)).toBeNull()
 })
 it('binds launch recovery to original transfer amounts, destinations and mint',()=>{
  const intent=transfer(),pending={mode:'standard' as const,venue:'pump' as const,mint:intent.mint,payer:key(),blockhash:key(),submittedAt:new Date().toISOString(),signatures:['original'],bundleExecution:{mode:'block0' as const,buyerCount:1,status:'partial' as const,transfers:[intent]}}
  expect(publicPending(pending).bundleExecution?.transfers).toEqual([intent])
  expect(samePending(pending,structuredClone(pending))).toBe(true)
  for(const transfers of [undefined,[{...intent,recipient:key()}],[{...intent,rawAmount:'1'}]])expect(samePending(pending,{...pending,bundleExecution:{...pending.bundleExecution,transfers}})).toBe(false)
  expect(()=>publicPending({...pending,mint:key()})).toThrow(/transfer/i)
 })
})
