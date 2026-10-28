import {afterEach,describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS,parseLaunchBundleSettings,validateLaunchBundleSettings,launchBundleModeLabel} from '../src/lib/launchBundle/types'
import {useLaunchStore,launchReviewKey} from '../src/stores/launchStore'
import {createLaunchDraft,restoreLaunchDraft} from '../src/lib/launchDrafts'
import {DEFAULT_LAUNCH_CONFIG} from '../src/lib/launchConfig'

afterEach(()=>useLaunchStore.getState().reset())

const wallet=()=>({walletId:crypto.randomUUID(),publicKey:Keypair.generate().publicKey.toBase58(),name:'Buyer',buySol:0.01,delaySeconds:0})
describe('public inline launch bundle settings',()=>{
 it.each(['manual','organic'] as const)('clears every public transfer destination when leaving Block-0 for %s',mode=>{
  const store=useLaunchStore.getState(),buyer={...wallet(),transferTo:Keypair.generate().publicKey.toBase58()}
  store.setBundleSettings({...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0',groupId:'group',wallets:[buyer]})
  store.setBundleSettings({...useLaunchStore.getState().bundleSettings,mode})
  expect(useLaunchStore.getState().bundleSettings.wallets[0]).not.toHaveProperty('transferTo')
  expect(useLaunchStore.getState().bundleSettings.wallets[0].buySol).toBe(0.01)
  store.setBundleSettings({...useLaunchStore.getState().bundleSettings,mode:'block0'})
  expect(useLaunchStore.getState().bundleSettings.wallets[0]).not.toHaveProperty('transferTo')
  expect(buyer).toHaveProperty('transferTo')
 })
 it('requires a fresh review identity after changing a destination or execution mode',()=>{
  const store=useLaunchStore.getState(),buyer={...wallet(),transferTo:Keypair.generate().publicKey.toBase58()}
  store.setBundleSettings({...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0',groupId:'group',wallets:[buyer]})
  const approved=launchReviewKey(useLaunchStore.getState(),'creator')
  store.setBundleSettings({...useLaunchStore.getState().bundleSettings,wallets:[{...buyer,transferTo:Keypair.generate().publicKey.toBase58()}]})
  expect(launchReviewKey(useLaunchStore.getState(),'creator')).not.toBe(approved)
  const changed=launchReviewKey(useLaunchStore.getState(),'creator')
  store.setBundleSettings({...useLaunchStore.getState().bundleSettings,mode:'manual'})
  expect(launchReviewKey(useLaunchStore.getState(),'creator')).not.toBe(changed)
 })
 it('roundtrips the public destination through saved drafts and preserves it during amount edits',()=>{
  const buyer={...wallet(),transferTo:Keypair.generate().publicKey.toBase58()},bundleSettings={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'block0' as const,groupId:'group',wallets:[buyer]}
  const draft=createLaunchDraft({name:'Transfer launch',metadata:{name:'Example',symbol:'EX',description:''},metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG},bundleSettings})
  const restored=restoreLaunchDraft(JSON.parse(JSON.stringify(draft)))
  expect(restored.bundleSettings.wallets[0]).toEqual(buyer)
  const store=useLaunchStore.getState();store.setBundleSettings(restored.bundleSettings)
  store.setBundleSettings({...useLaunchStore.getState().bundleSettings,wallets:[{...useLaunchStore.getState().bundleSettings.wallets[0],buySol:0.02}]})
  expect(useLaunchStore.getState().bundleSettings.wallets[0]).toHaveProperty('transferTo',buyer.transferTo)
  expect(JSON.stringify(draft)).not.toMatch(/privateKey|secretKey|mintSecretKey/)
 })
 it('restores only missing legacy settings and returns independent defaults',()=>{
  const a=parseLaunchBundleSettings(undefined),b=parseLaunchBundleSettings(undefined)
  expect(a).toEqual(DEFAULT_LAUNCH_BUNDLE_SETTINGS);a.wallets.push(wallet());expect(b.wallets).toEqual([])
  for(const bad of [null,{},'manual',{...b,mode:'unknown'},{...b,privateKey:'never-store'}])expect(()=>parseLaunchBundleSettings(bad)).toThrow()
 })
 it('accepts managed buyers and rejects duplicate identity, excess atomic buyers and invalid numeric budgets',()=>{
  const value={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,groupId:'group',wallets:[wallet()]}
  expect(parseLaunchBundleSettings(value)).toEqual(value)
  expect(validateLaunchBundleSettings({...value,wallets:[value.wallets[0],{...wallet(),publicKey:value.wallets[0].publicKey}]}).join(' ')).toMatch(/unique|duplicate/i)
  expect(validateLaunchBundleSettings({...value,mode:'block0',wallets:Array.from({length:4},wallet)}).join(' ')).toMatch(/three|3/i)
  for(const buySol of [NaN,Infinity,-1,1001])expect(()=>parseLaunchBundleSettings({...value,wallets:[{...wallet(),buySol}]})).toThrow()
  expect(()=>parseLaunchBundleSettings({...value,groupId:null})).toThrow()
  expect(launchBundleModeLabel('block0')).toBe('Block-0')
 })
})
