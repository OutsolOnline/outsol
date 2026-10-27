import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS,parseLaunchBundleSettings,validateLaunchBundleSettings,launchBundleModeLabel} from '../src/lib/launchBundle/types'

const wallet=()=>({walletId:crypto.randomUUID(),publicKey:Keypair.generate().publicKey.toBase58(),name:'Buyer',buySol:0.01,delaySeconds:0})
describe('public inline launch bundle settings',()=>{
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
