import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {mergeManagedBundleWallets,appendLaunchBundleWallets} from '../src/lib/bundler/walletSetup'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
import type {BundleWallet} from '../src/lib/bundler/types'
const wallet=(id:string)=>({id,name:id,publicKey:Keypair.generate().publicKey.toBase58(),createdAt:new Date().toISOString()})
describe('adding generated and imported bundle wallets',()=>{
 it('preserves existing buyer budgets, timing and recipient while adding fresh zero-budget slots',()=>{
  const creator=wallet('creator'),one=wallet('one'),two=wallet('two'),recipient=wallet('recipient')
  const old={id:1,libraryWalletId:one.id,publicKey:one.publicKey,privateKey:'',balance:2,isValid:true,buyAmount:0.125,mode:'delayed',delaySeconds:9,sellEnabled:false,sellPercent:25,sellTriggerType:'time',sellDelaySeconds:18,sellProfitMultiplier:2,transferTo:recipient.publicKey} as BundleWallet
  const result=mergeManagedBundleWallets([old],[creator,one,two],creator.id)
  expect(result).toHaveLength(16);expect(result[0]).toMatchObject({...old,id:1});expect(result[1]).toMatchObject({libraryWalletId:two.id,buyAmount:0,isValid:true,privateKey:''});expect(result[2].publicKey).toBeNull()
  expect(old.buyAmount).toBe(0.125)
 })
 it('rejects duplicate addresses, unavailable creator and oversized buyer sets instead of omitting wallets',()=>{
  const creator=wallet('creator'),one=wallet('one')
  expect(()=>mergeManagedBundleWallets([],[creator,{...one,publicKey:creator.publicKey}],creator.id)).toThrow(/distinct|duplicate/i)
  expect(()=>mergeManagedBundleWallets([],[one],creator.id)).toThrow(/creator/i)
  expect(()=>mergeManagedBundleWallets([],[creator,...Array.from({length:17},(_,i)=>wallet(`w${i}`))],creator.id)).toThrow(/16|seventeen|17/)
 })
 it('appends inline buyers without resetting allocation, mode, intervals or saved destinations',()=>{
  const one=wallet('one'),two=wallet('two'),recipient=wallet('recipient')
  const initial={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0' as const,groupId:'existing',wallets:[{walletId:one.id,publicKey:one.publicKey,name:one.name,buySol:0.25,delaySeconds:7,transferTo:recipient.publicKey}]}
  const result=appendLaunchBundleWallets(initial,'existing',[one,two])
  expect(result.wallets).toHaveLength(2);expect(result.wallets[0]).toEqual(initial.wallets[0]);expect(result.wallets[1]).toMatchObject({walletId:two.id,buySol:0,delaySeconds:0});expect(result.mode).toBe('block0')
 })
 it('does not append the signing wallet and refuses replacing another group without an explicit new selection',()=>{
  const creator=wallet('creator'),one=wallet('one')
  const initial={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,groupId:'old',wallets:[{walletId:one.id,publicKey:one.publicKey,name:one.name,buySol:0.1,delaySeconds:0}]}
  expect(()=>appendLaunchBundleWallets(initial,'new',[creator],creator.publicKey)).toThrow(/group|selection/i)
  const result=appendLaunchBundleWallets({...DEFAULT_LAUNCH_BUNDLE_SETTINGS,wallets:[]},'new',[creator,one],creator.publicKey)
  expect(result.wallets.map(value=>value.walletId)).toEqual([one.id])
 })
})
