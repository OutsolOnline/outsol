import {describe,expect,it} from 'vitest'
import {BUNDLE_PRESETS_KEY,BUILT_IN_BUNDLE_PRESETS,publicBundleSettings,readBundlePresets,writeBundlePresets,applyBundleSettings} from '../src/lib/bundler/presets'
import {useBundlerStore} from '../src/stores/bundlerStore'

function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}}
describe('public bundle execution presets',()=>{
 it('saves only supported numeric timing settings and never wallet or mint material',()=>{
  const config={...useBundlerStore.getState(),creatorPrivateKey:'creator-secret',importedMintKey:'mint-secret',foundVanityKey:'vanity-secret',tokenImage:new Blob(['private-artwork']) as File,bundleWallets:useBundlerStore.getState().bundleWallets.map(wallet=>({...wallet,privateKey:'buyer-secret',libraryWalletId:'library-id',publicKey:'public-address',buyAmount:0.01}))}
  const projected=publicBundleSettings(config)
  const serialized=JSON.stringify(projected)
  for(const secret of ['creator-secret','mint-secret','vanity-secret','buyer-secret','library-id','public-address','private-artwork'])expect(serialized).not.toContain(secret)
  expect(projected.wallets).toHaveLength(16)
  expect(projected.wallets[0].buyAmount).toBe(0.01)
 })
 it('round-trips named public settings while applying them to the current session identities',()=>{
  const disk=storage(),settings=publicBundleSettings(useBundlerStore.getState())
  const saved={id:'one',name:'My launch',createdAt:'2026-10-27T00:00:00.000Z',updatedAt:'2026-10-27T00:00:00.000Z',settings}
  writeBundlePresets(disk,[saved],null)
  const loaded=readBundlePresets(disk)
  expect(loaded.presets).toEqual([saved])
  const current={...useBundlerStore.getState(),creatorPrivateKey:'session-key',bundleWallets:useBundlerStore.getState().bundleWallets.map(wallet=>({...wallet,privateKey:'session-buyer'}))}
  const applied=applyBundleSettings(current,BUILT_IN_BUNDLE_PRESETS[0].settings)
  expect(applied.creatorPrivateKey).toBe('session-key')
  expect(applied.bundleWallets[0].privateKey).toBe('session-buyer')
  expect(applied.bundleWallets.filter(wallet=>wallet.buyAmount>0)).toHaveLength(3)
  expect(applied.sniperMode).toBe('block0')
 })
 it('preserves malformed data and refuses stale writes or unavailable storage',()=>{
  const disk=storage();disk.setItem(BUNDLE_PRESETS_KEY,'{broken')
  expect(()=>readBundlePresets(disk)).toThrow(/read|preserv|preset/i)
  expect(disk.getItem(BUNDLE_PRESETS_KEY)).toBe('{broken')
  expect(()=>writeBundlePresets(disk,[],null)).toThrow(/changed|reload/i)
  expect(()=>readBundlePresets({getItem:()=>{throw new Error('denied')},setItem:()=>{}})).toThrow()
 })
})
