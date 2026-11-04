import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {clearSniperSession,readSniperSessionPublicState,sniperSessionSelectionKey,sniperSessionProfileKey,DEFAULT_SNIPER_SESSION_NAME,type SniperSessionLifecyclePorts} from '../src/lib/sniperPairs/sessionLifecycle'
import {resolveSniperPairs,type SniperPair} from '../src/lib/sniperPairs/catalog'
import {mapSniperPairsToBundle} from '../src/lib/sniperPairs/launch'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
import type {BundleWallet} from '../src/lib/bundler/types'

const fixture=(mode:'standalone'|'launch'='standalone')=>{
 const addresses=Array.from({length:6},()=>Keypair.generate().publicKey.toBase58()),wallets=addresses.map((publicKey,i)=>({id:`wallet-${i}`,name:`Wallet ${i}`,publicKey,createdAt:'2026-11-04T00:00:00.000Z'}))
 const pairs:SniperPair[]=[1,3].map((i,index)=>({id:`pair-${index}`,name:String.fromCharCode(65+index),sniperWalletId:wallets[i].id,sniperAddress:addresses[i],receiverWalletId:wallets[i+1].id,receiverAddress:addresses[i+1],createdAt:'2026-11-04T00:00:00.000Z'})),ids=pairs.map(pair=>pair.id)
 const bundle={isExecuting:false,result:null as null|{status?:'unknown'|'confirmed';createSignature?:string;bundleId?:string;submittedSignatures?:string[]},creatorPublicKey:addresses[0],managedGroupId:'preserved-group',managedCreatorWalletId:'wallet-0',bundleWallets:mapSniperPairsToBundle([],resolveSniperPairs(pairs,wallets),wallets[0]),tokenName:'Keep token design'}
 const manual:BundleWallet={...bundle.bundleWallets[2],publicKey:addresses[5],privateKey:'unrelated-manual-test-material',buyAmount:.5,isValid:true,mode:'delayed',delaySeconds:19};bundle.bundleWallets[2]=manual
 const launch={isLoading:false,receipt:undefined as unknown,transactionSignature:null as string|null,config:{name:'Keep the draft'},usePlatformWallet:true,bundleSettings:{...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'organic' as const,groupId:'launch-group',deferBuys:true,stagedPlanId:'old-staged-plan',intervalMinSeconds:6,intervalMaxSeconds:12,wallets:[...pairs.map(pair=>({walletId:pair.sniperWalletId,publicKey:pair.sniperAddress,name:pair.name,buySol:.1,delaySeconds:3,transferTo:pair.receiverAddress})),{walletId:'wallet-5',publicKey:addresses[5],name:'Unrelated buyer',buySol:.2,delaySeconds:9}]}}
 const values=new Map<string,string>([[sniperSessionSelectionKey(mode),JSON.stringify(ids)],[sniperSessionProfileKey(mode),JSON.stringify({version:1,name:'Saved launch',deployerAddress:addresses[0]})],['outsol-wallet-library-v1','preserve encrypted wallets'],['outsol-sniper-pairs-v1','preserve reusable pairs'],['vanity-launch-receipts-v1','preserve transaction receipts']])
 let afterWrite:((key:string,value:string)=>void)|undefined,blocked='',standaloneCommits=0,inlineCommits=0,writeCount=0
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{writeCount++;values.set(key,value);afterWrite?.(key,value)},removeItem:(key:string)=>{values.delete(key)}}
 const ports:SniperSessionLifecyclePorts={storage,readPairs:()=>pairs,readBundle:()=>bundle,readLaunch:()=>launch,assertAvailable:()=>{if(blocked)throw Error(blocked)},commitStandalone:patch=>{standaloneCommits++;Object.assign(bundle,patch)},commitInline:patch=>{inlineCommits++;Object.assign(launch,patch)}}
 return{mode,addresses,wallets,pairs,ids,bundle,launch,manual,storage,values,ports,onWrite:(fn:typeof afterWrite)=>{afterWrite=fn},block:(message:string)=>{blocked=message},counts:()=>({standaloneCommits,inlineCommits,writeCount})}
}
const expectPreserved=(f:ReturnType<typeof fixture>)=>{expect(f.values.get('outsol-wallet-library-v1')).toBe('preserve encrypted wallets');expect(f.values.get('outsol-sniper-pairs-v1')).toBe('preserve reusable pairs');expect(f.values.get('vanity-launch-receipts-v1')).toBe('preserve transaction receipts')}

describe('restore public sniper session without overwriting unreadable data',()=>{
 it('restores the exact selected order and explicit empty deployer',()=>{
  const f=fixture();f.values.set(sniperSessionProfileKey('standalone'),JSON.stringify({version:1,name:'Reusable',deployerAddress:''}))
  expect(readSniperSessionPublicState(f.storage,'standalone')).toEqual({selection:f.ids,profile:{version:1,name:'Reusable',deployerAddress:''}})
  expect(f.counts().writeCount).toBe(0)
 })
 it.each(['{broken',JSON.stringify({version:1,name:'Saved',deployerAddress:'invalid'}),JSON.stringify({version:1,name:'Saved',deployerAddress:'',privateKey:'unexpected'})])('refuses unreadable profiles and leaves all browser data untouched',raw=>{
  const f=fixture();f.values.set(sniperSessionProfileKey('standalone'),raw);const before=new Map(f.values)
  expect(()=>readSniperSessionPublicState(f.storage,'standalone')).toThrow();expect(f.values).toEqual(before);expect(f.counts().writeCount).toBe(0)
 })
 it('returns an independent empty view for an absent mode',()=>{
  const f=fixture();expect(readSniperSessionPublicState(f.storage,'launch')).toEqual({selection:[],profile:null})
  expect(f.values.get(sniperSessionSelectionKey('standalone'))).toBe(JSON.stringify(f.ids))
 })
})
describe('remove the active sniper session without deleting its wallets',()=>{
 it('keeps legacy public keys and clears only matching standalone buyer slots, preserving other keys and configuration',async()=>{
  const f=fixture(),pairs=structuredClone(f.pairs),launch=structuredClone(f.launch),ids=f.bundle.bundleWallets.map(row=>row.id)
  expect(sniperSessionSelectionKey('standalone')).toBe('outsol-sniper-session-selection-v1:standalone');expect(sniperSessionProfileKey('launch')).toBe('outsol-sniper-session-profile-v1:launch')
  expect(await clearSniperSession('standalone',f.ids,{ports:f.ports})).toEqual({detachedBuyers:2})
  expect(f.bundle.bundleWallets).toHaveLength(16);expect(f.bundle.bundleWallets.map(row=>row.id)).toEqual(ids)
  expect(f.bundle.bundleWallets.slice(0,2)).toMatchObject([{publicKey:null,privateKey:'',buyAmount:0,isValid:false,sellEnabled:false},{publicKey:null,privateKey:'',buyAmount:0,isValid:false,sellEnabled:false}])
  expect(f.bundle.bundleWallets[0]).not.toHaveProperty('libraryWalletId');expect(f.bundle.bundleWallets[0]).not.toHaveProperty('transferTo');expect(f.bundle.bundleWallets[2]).toEqual(f.manual)
  expect(f.bundle.creatorPublicKey).toBe(f.addresses[0]);expect(f.bundle.managedGroupId).toBe('preserved-group');expect(f.bundle.tokenName).toBe('Keep token design');expect(f.launch).toEqual(launch);expect(f.pairs).toEqual(pairs)
  expect(f.values.get(sniperSessionSelectionKey('standalone'))).toBe('[]');expect(JSON.parse(f.values.get(sniperSessionProfileKey('standalone'))!)).toEqual({version:1,name:DEFAULT_SNIPER_SESSION_NAME,deployerAddress:''});expectPreserved(f)
 })
 it('detaches inline buyer mappings, invalidates only their staged reference and preserves unrelated draft settings',async()=>{
  const f=fixture('launch'),bundle=structuredClone(f.bundle),unrelated=structuredClone(f.launch.bundleSettings.wallets[2]);f.bundle.result={createSignature:'older-other-mode-launch'}
  expect(await clearSniperSession('launch',f.ids,{ports:f.ports})).toEqual({detachedBuyers:2})
  expect(f.launch.bundleSettings.wallets).toEqual([unrelated]);expect(f.launch.bundleSettings).not.toHaveProperty('stagedPlanId');expect(f.launch.bundleSettings).toMatchObject({mode:'organic',groupId:'launch-group',deferBuys:true,intervalMinSeconds:6,intervalMaxSeconds:12});expect(f.launch.config.name).toBe('Keep the draft');expect(f.launch.usePlatformWallet).toBe(true)
  expect(f.bundle).toEqual({...bundle,result:{createSignature:'older-other-mode-launch'}});expectPreserved(f)
 })
 it('removes the inline group reference only when no buyers remain',async()=>{
  const f=fixture('launch');f.launch.bundleSettings.wallets=f.launch.bundleSettings.wallets.slice(0,2)
  await clearSniperSession('launch',f.ids,{ports:f.ports});expect(f.launch.bundleSettings.wallets).toEqual([]);expect(f.launch.bundleSettings.groupId).toBeNull();expectPreserved(f)
 })
 it('keeps independently changed mappings and their staged plan intact when no session buyer is attached',async()=>{
  const f=fixture('launch'),first=f.launch.bundleSettings.wallets[0];if('transferTo'in first)first.transferTo=f.addresses[5];f.launch.bundleSettings.wallets=f.launch.bundleSettings.wallets.slice(0,1);const before=structuredClone(f.launch.bundleSettings)
  expect(await clearSniperSession('launch',f.ids,{ports:f.ports})).toEqual({detachedBuyers:0});expect(f.launch.bundleSettings).toEqual(before)
 })
 it.each(['selection-order','selection-missing','profile-secret','profile-address','missing-pair'])('preserves all data when %s is not the reviewed public session',async issue=>{
  const f=fixture();if(issue==='selection-order')f.values.set(sniperSessionSelectionKey(f.mode),JSON.stringify([...f.ids].reverse()));if(issue==='selection-missing')f.values.delete(sniperSessionSelectionKey(f.mode));if(issue==='profile-secret')f.values.set(sniperSessionProfileKey(f.mode),JSON.stringify({version:1,name:'bad',deployerAddress:'',privateKey:'do not accept'}));if(issue==='profile-address')f.values.set(sniperSessionProfileKey(f.mode),JSON.stringify({version:1,name:'bad',deployerAddress:'invalid'}));if(issue==='missing-pair')f.pairs.pop();const disk=new Map(f.values),bundle=structuredClone(f.bundle)
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports})).rejects.toThrow();expect(f.values).toEqual(disk);expect(f.bundle).toEqual(bundle);expect(f.counts().standaloneCommits).toBe(0)
 })
 it.each(['locked','bundle-running','launch-running','bundle-completed','bundle-id','launch-receipt','launch-signature','pending','corrupt-recovery'])('rejects %s before any mutation',async issue=>{
  const mode=issue.startsWith('launch-')?'launch':'standalone',f=fixture(mode),disk=new Map(f.values)
  if(issue==='bundle-running')f.bundle.isExecuting=true;if(issue==='launch-running')f.launch.isLoading=true;if(issue==='bundle-completed')f.bundle.result={createSignature:'confirmed'};if(issue==='bundle-id')f.bundle.result={bundleId:'submitted-bundle'};if(issue==='launch-receipt')f.launch.receipt={mint:'preserve'};if(issue==='launch-signature')f.launch.transactionSignature='original';if(issue==='pending')f.block('A transaction is pending.');if(issue==='corrupt-recovery')f.block('Recovery data cannot be read.')
  await expect(clearSniperSession(mode,f.ids,{ports:f.ports,locked:issue==='locked'})).rejects.toThrow();expect(f.values).toEqual(disk);expect(f.counts()).toEqual({standaloneCommits:0,inlineCommits:0,writeCount:0})
 })
 it('refuses to discard manual key material even in a matching source/receiver row',async()=>{
  const f=fixture(),disk=new Map(f.values);f.bundle.bundleWallets[0].privateKey='unexpected-manual-test-material'
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports})).rejects.toThrow(/manual|key|backup/i);expect(f.values).toEqual(disk);expect(f.bundle.bundleWallets[0].privateKey).toBe('unexpected-manual-test-material')
 })
 it.each(['throw','silent','profile-failure'])('keeps configuration and restores old public session after a %s write failure',async issue=>{
  const f=fixture(),disk=new Map(f.values),bundle=structuredClone(f.bundle),set=f.storage.setItem;let failed=false
  f.storage.setItem=(key,value)=>{if(!failed&&(issue!=='profile-failure'||key===sniperSessionProfileKey(f.mode))){failed=true;if(issue==='silent')return;throw Error('quota')}set(key,value)}
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports})).rejects.toThrow();expect(f.values).toEqual(disk);expect(f.bundle).toEqual(bundle);expect(f.counts().standaloneCommits).toBe(0)
 })
 it('rechecks pending status after public writes and rolls back before committing buyers',async()=>{
  const f=fixture(),disk=new Map(f.values),bundle=structuredClone(f.bundle);f.onWrite(()=>f.block('An original signature became pending.'))
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports})).rejects.toThrow(/pending/);expect(f.values).toEqual(disk);expect(f.bundle).toEqual(bundle);expect(f.counts().standaloneCommits).toBe(0)
 })
 it('does not clear a view that closed before preparation or after its first public write',async()=>{
  const f=fixture(),disk=new Map(f.values)
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports,isCurrent:()=>false})).rejects.toThrow(/closed|changed|session/i)
  expect(f.values).toEqual(disk);expect(f.counts().writeCount).toBe(0)
  let active=true;f.onWrite(()=>{active=false})
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports,isCurrent:()=>active})).rejects.toThrow(/closed|changed|session/i)
  expect(f.values).toEqual(disk);expect(f.counts().standaloneCommits).toBe(0)
 })
 it('rejects changed pair/config snapshots and preserves a concurrent tab update instead of overwriting it',async()=>{
  const f=fixture(),selectionKey=sniperSessionSelectionKey(f.mode);let changed=false;f.onWrite(key=>{if(key===selectionKey&&!changed){changed=true;f.values.set(selectionKey,JSON.stringify([f.ids[1]]))}})
  await expect(clearSniperSession('standalone',f.ids,{ports:f.ports})).rejects.toThrow(/changed|session/i);expect(f.values.get(selectionKey)).toBe(JSON.stringify([f.ids[1]]));expect(f.counts().standaloneCommits).toBe(0)
  const pairChange=fixture(),oldDisk=new Map(pairChange.values);pairChange.onWrite(()=>{pairChange.pairs[0].name='Changed in another tab'})
  await expect(clearSniperSession('standalone',pairChange.ids,{ports:pairChange.ports})).rejects.toThrow(/changed/i);expect(pairChange.values).toEqual(oldDisk);expect(pairChange.counts().standaloneCommits).toBe(0)
  const configChange=fixture(),configDisk=new Map(configChange.values);configChange.onWrite(()=>{configChange.bundle.bundleWallets[0].buyAmount=.2})
  await expect(clearSniperSession('standalone',configChange.ids,{ports:configChange.ports})).rejects.toThrow(/changed/i);expect(configChange.values).toEqual(configDisk);expect(configChange.counts().standaloneCommits).toBe(0)
 })
})
