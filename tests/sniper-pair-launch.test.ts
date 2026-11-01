import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {createSniperPairScope,mapSniperPairsToBundle,mapSniperPairsToLaunch,applySniperPairsToLaunch,type SniperPairApplyPorts} from '@/lib/sniperPairs/launch'
import type {SniperPair} from '@/lib/sniperPairs/catalog'
import {resolveSniperPairs} from '@/lib/sniperPairs/catalog'
import type {WalletSummary} from '@/lib/walletLibrary/types'
import type {BundleControlLibrary} from '@/lib/bundler/walletControls'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '@/lib/launchBundle/types'

function fixture(){
 const keys=Array.from({length:6},()=>Keypair.generate()),wallets:WalletSummary[]=keys.map((key,index)=>({id:`wallet-${index}`,name:`Wallet ${index}`,publicKey:key.publicKey.toBase58(),createdAt:'2026-11-01T00:00:00.000Z'}))
 const pair:SniperPair={id:'pair-a',name:'A',sniperWalletId:wallets[1].id,sniperAddress:wallets[1].publicKey,receiverWalletId:wallets[2].id,receiverAddress:wallets[2].publicKey,createdAt:'2026-11-01T00:00:00.000Z'}
 const pairs=[pair],keyMap=new Map(wallets.map((wallet,index)=>[wallet.id,keys[index]]))
 const library:BundleControlLibrary={revision:1,storageUnavailable:false,wallets,groups:[],unlockedIds:wallets.map(wallet=>wallet.id),getKeypair:id=>keyMap.get(id)??null}
 return{keys,wallets,pair,pairs,library,keyMap,resolved:()=>resolveSniperPairs(pairs,library.wallets)}
}
describe('reusable sniper pair launch binding',()=>{
 it('maps only sources into buyers, keeps deployer separate and forces the paired receiver',()=>{
  const f=fixture(),first=mapSniperPairsToBundle([],f.resolved(),f.wallets[0])
  expect(first[0]).toMatchObject({libraryWalletId:'wallet-1',publicKey:f.pair.sniperAddress,transferTo:f.pair.receiverAddress,buyAmount:0,sellEnabled:false})
  expect(first).toHaveLength(16);expect(first.filter(row=>row.publicKey).map(row=>row.publicKey)).toEqual([f.pair.sniperAddress])
  expect(()=>mapSniperPairsToBundle([],f.resolved(),f.wallets[1])).toThrow(/deployer/i)
  expect(()=>mapSniperPairsToBundle([],f.resolved(),f.wallets[2])).toThrow(/deployer/i)
 })
 it('preserves source budgets and timing across imported IDs while disabling conflicting source sells',()=>{
  const f=fixture(),old=mapSniperPairsToBundle([],f.resolved(),f.wallets[0]);Object.assign(old[0],{buyAmount:0.23,mode:'delayed',delaySeconds:9,sellEnabled:true})
  f.library.wallets=f.library.wallets.map(wallet=>wallet.id==='wallet-1'?{...wallet,id:'restored-source'}:wallet)
  const next=mapSniperPairsToBundle(old,f.resolved(),f.wallets[0])
  expect(next[0]).toMatchObject({libraryWalletId:'restored-source',buyAmount:0.23,mode:'delayed',delaySeconds:9,sellEnabled:false,transferTo:f.pair.receiverAddress})
 })
 it('keeps inline mode and intervals while replacing buyer roles with sources only',()=>{
  const f=fixture(),settings={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:'organic' as const,intervalMinSeconds:4,intervalMaxSeconds:8,wallets:[{walletId:'old',name:'Old source',publicKey:f.pair.sniperAddress,buySol:0.12,delaySeconds:7,transferTo:f.wallets[5].publicKey}]}
  const next=mapSniperPairsToLaunch(settings,f.resolved(),'source-group',f.wallets[0].publicKey)
  expect(next).toMatchObject({mode:'organic',groupId:'source-group',intervalMinSeconds:4,intervalMaxSeconds:8})
  expect(next.wallets).toEqual([{walletId:'wallet-1',name:'Wallet 1',publicKey:f.pair.sniperAddress,buySol:0.12,delaySeconds:7,transferTo:f.pair.receiverAddress}])
  expect(()=>mapSniperPairsToLaunch(settings,f.resolved(),'source-group',f.pair.receiverAddress)).toThrow(/deployer/i)
 })
 it('refuses too many pairs and forged resolved identities',()=>{
  const f=fixture(),resolved=f.resolved()
  expect(()=>mapSniperPairsToBundle([],Array.from({length:17},()=>resolved[0]),f.wallets[0])).toThrow(/16/)
  expect(()=>mapSniperPairsToBundle([],[{...resolved[0],receiver:f.wallets[3]}],f.wallets[0])).toThrow(/changed|match|receiver/i)
 })
})
describe('live pair wallet scope',()=>{
 it('contains only selected sources and receivers and resolves their actual controlled IDs',()=>{
  const f=fixture(),scope=createSniperPairScope(()=>f.pairs,()=>f.library)
  expect(scope.wallets.map(row=>row.id)).toEqual(['wallet-1','wallet-2']);expect(scope.roles).toEqual({'wallet-1':'buyer','wallet-2':'recipient'})
  expect(scope.getKeypair('wallet-1')).toBe(f.keys[1]);expect(scope.getKeypair('wallet-0')).toBeNull()
  expect(scope.revision).not.toContain(Array.from(f.keys[1].secretKey).join(','))
 })
 it('invalidates on pair destination change, wallet removal, library changes or late locking',()=>{
  const f=fixture(),scope=createSniperPairScope(()=>f.pairs,()=>f.library)
  expect(scope.getKeypair('wallet-2')).toBe(f.keys[2]);f.library.unlockedIds=[];f.keyMap.clear()
  expect(scope.getKeypair('wallet-2')).toBeNull();expect(()=>scope.assertCurrent()).toThrow(/changed|locked/i)
  const fresh=fixture(),next=createSniperPairScope(()=>fresh.pairs,()=>fresh.library);fresh.pairs[0]={...fresh.pair,receiverAddress:fresh.wallets[3].publicKey,receiverWalletId:fresh.wallets[3].id}
  expect(()=>next.assertCurrent()).toThrow(/changed/i)
 })
 it('binds restored private keys by exact address but never silently switches an open review',()=>{
  const f=fixture(),scope=createSniperPairScope(()=>f.pairs,()=>f.library);scope.getKeypair('wallet-2')
  f.library.wallets=f.library.wallets.map(wallet=>wallet.id==='wallet-2'?{...wallet,id:'restored-receiver'}:wallet);f.keyMap.set('restored-receiver',f.keys[2]);f.library.unlockedIds!.push('restored-receiver')
  expect(scope.getKeypair('wallet-2')).toBeNull()
  const restored=createSniperPairScope(()=>f.pairs,()=>f.library);expect(restored.roles['restored-receiver']).toBe('recipient');expect(restored.getKeypair('restored-receiver')).toBe(f.keys[2])
 })
 it('keeps signer authorization private when a UI consumer mutates its public summaries',()=>{
  const f=fixture(),scope=createSniperPairScope(()=>f.pairs,()=>f.library)
  scope.wallets.push({...f.wallets[0]});scope.wallets[0].publicKey=f.wallets[5].publicKey;scope.roles['wallet-0']='recipient'
  expect(scope.getKeypair('wallet-0')).toBeNull();expect(scope.resolveWallet('wallet-0')).toBeNull();expect(scope.getKeypair('wallet-1')).toBe(f.keys[1])
 })
 it('fails closed if the pair catalog becomes unavailable during an open operation',()=>{
  const f=fixture();let available=true
  const scope=createSniperPairScope(()=>{if(!available)throw new Error('Pair catalog is unavailable');return f.pairs},()=>f.library)
  expect(scope.getKeypair('wallet-2')).toBe(f.keys[2]);available=false
  expect(()=>scope.assertCurrent()).toThrow(/unavailable/);expect(scope.getKeypair('wallet-2')).toBeNull();expect(scope.resolveWallet('wallet-2')).toBeNull()
 })
})

function applyFixture(){
 const f=fixture();let guardError='',groupCreates=0,commitCount=0,selectedId:string|null=null
 const bundle={isExecuting:false,result:null as {createSignature?:string}|null,bundleWallets:mapSniperPairsToBundle([],f.resolved(),f.wallets[0]),managedGroupId:undefined as string|undefined,managedCreatorWalletId:undefined as string|undefined,creatorPublicKey:null as string|null,creatorPrivateKey:''}
 const launch={isLoading:false,receipt:null as object|null,transactionSignature:null as string|null,usePlatformWallet:false,bundleSettings:structuredClone(DEFAULT_LAUNCH_BUNDLE_SETTINGS)}
 let onCreate:(()=>void)|undefined
 const ports:SniperPairApplyPorts={ready:async()=>{},readLibrary:()=>f.library,readPairs:()=>f.pairs,readBundle:()=>bundle,readLaunch:()=>launch,platformAddress:()=>selectedId?f.library.wallets.find(wallet=>wallet.id===selectedId)?.publicKey??null:null,assertAvailable:()=>{if(guardError)throw new Error(guardError)},createGroup:async(_name,ids)=>{groupCreates++;const group={id:'pair-source-group',walletIds:[...ids]};f.library.groups.push(group);f.library.revision++;onCreate?.();return group},selectDeployer:id=>{selectedId=id},commitStandalone:patch=>{Object.assign(bundle,patch);commitCount++},commitInline:patch=>{Object.assign(launch,patch);commitCount++}}
 return{...f,bundle,launch,ports,guard:(value:string)=>{guardError=value},onCreate:(value:()=>void)=>{onCreate=value},counts:()=>({groupCreates,commitCount,selectedId})}
}
describe('guarded pair assignment',()=>{
 it('creates a dedicated standalone group containing deployer and sources, never receivers',async()=>{
  const f=applyFixture();await applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)
  expect(f.library.groups[0].walletIds).toEqual(['wallet-0','wallet-1']);expect(f.bundle.managedCreatorWalletId).toBe('wallet-0');expect(f.bundle.bundleWallets[0].transferTo).toBe(f.pair.receiverAddress)
  await applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports);expect(f.counts().groupCreates).toBe(1)
 })
 it('uses a source-only inline group and selects a distinct controlled deployer',async()=>{
  const f=applyFixture();await applySniperPairsToLaunch('launch',f.resolved(),'wallet-0',f.ports)
  expect(f.library.groups[0].walletIds).toEqual(['wallet-1']);expect(f.launch.usePlatformWallet).toBe(true);expect(f.counts().selectedId).toBe('wallet-0');expect(f.launch.bundleSettings.wallets[0].transferTo).toBe(f.pair.receiverAddress)
 })
 it('rejects executing, completed or unknown-pending launches before any group write',async()=>{
  const f=applyFixture();f.bundle.isExecuting=true
  await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)).rejects.toThrow(/running|finish/i)
  f.bundle.isExecuting=false;f.bundle.result={createSignature:'confirmed'}
  await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)).rejects.toThrow(/new launch|completed/i)
  f.bundle.result=null;f.guard('A submitted transaction is unknown')
  await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)).rejects.toThrow(/unknown/)
  expect(f.counts()).toMatchObject({groupCreates:0,commitCount:0})
 })
 it('preserves existing manual creator and buyer keys before any group write or selection change',async()=>{
  for(const role of ['creator','buyer']){
   const f=applyFixture()
   if(role==='creator')f.bundle.creatorPrivateKey='existing-manual-creator-material'
   else f.bundle.bundleWallets[0].privateKey='existing-manual-buyer-material'
   const before=structuredClone(f.bundle)
   await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)).rejects.toThrow('Export the existing manual wallet backup, then switch to an encrypted group before using sniper pairs.')
   expect(f.counts()).toEqual({groupCreates:0,commitCount:0,selectedId:null});expect(f.bundle).toEqual(before);expect(f.library.groups).toEqual([])
  }
 })
 it('preserves the encrypted group but refuses attachment if state or pairing changes during save',async()=>{
  const f=applyFixture();f.onCreate(()=>{f.pairs[0]={...f.pair,receiverWalletId:'wallet-3',receiverAddress:f.wallets[3].publicKey}})
  await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)).rejects.toThrow(/saved|changed/i)
  expect(f.counts()).toMatchObject({groupCreates:1,commitCount:0});expect(f.library.groups).toHaveLength(1)
 })
 it('refuses late pending transactions and library locks without discarding the saved source group',async()=>{
  const f=applyFixture();f.onCreate(()=>f.guard('A transaction became unknown'))
  await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)).rejects.toThrow(/saved.*unknown/)
  expect(f.counts().commitCount).toBe(0)
  const next=applyFixture();next.onCreate(()=>{next.library.unlockedIds=[]})
  await expect(applySniperPairsToLaunch('standalone',next.resolved(),'wallet-0',next.ports)).rejects.toThrow(/saved.*changed/)
  expect(next.counts().commitCount).toBe(0)
  const manual=applyFixture();manual.onCreate(()=>{manual.bundle.creatorPrivateKey='late-manual-creator-material'})
  await expect(applySniperPairsToLaunch('standalone',manual.resolved(),'wallet-0',manual.ports)).rejects.toThrow(/saved.*Export the existing manual wallet backup/)
  expect(manual.counts().commitCount).toBe(0);expect(manual.bundle.creatorPrivateKey).toBe('late-manual-creator-material')
 })
 it('rejects a deployer that is a receiver and preserves unrelated group membership',async()=>{
  const f=applyFixture();f.library.groups.push({id:'unrelated',walletIds:['wallet-0','wallet-5']})
  await expect(applySniperPairsToLaunch('standalone',f.resolved(),'wallet-2',f.ports)).rejects.toThrow(/deployer/i)
  await applySniperPairsToLaunch('standalone',f.resolved(),'wallet-0',f.ports)
  expect(f.library.groups[0].walletIds).toEqual(['wallet-0','wallet-5'])
 })
})
