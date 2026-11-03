import {beforeEach,describe,it,expect,vi} from 'vitest'
import {IDBFactory} from 'fake-indexeddb'
import {Keypair} from '@solana/web3.js'
import {createLaunchDraft,loadLaunchDrafts} from '../src/lib/launchDrafts'
import {DEFAULT_LAUNCH_CONFIG} from '../src/lib/launchConfig'
import {exportLaunchKit,parseLaunchKit,importLaunchKit,readKitRequirements,assertKitBindings} from '../src/lib/launchKits'
import {getArtwork} from '../src/lib/artworkLibrary'
const memory=()=>{const rows=new Map<string,string>();return {rows,getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value)}}}
const payer=Keypair.generate().publicKey.toBase58(),receiver=Keypair.generate().publicKey.toBase58()
const draft=()=>createLaunchDraft({name:'Portable',metadata:{name:'Portable',symbol:'PORT',description:'Reusable public design'},metadataUri:'https://example.com/old.json',config:{...DEFAULT_LAUNCH_CONFIG,devBuySol:.2,creatorFeeSelection:{kind:'wallet',address:payer}},bundleSettings:{version:1,mode:'organic',groupId:'private-group-id',intervalMinSeconds:3,intervalMaxSeconds:8,wallets:[{walletId:'actual-wallet-id',publicKey:payer,name:payer,buySol:.1,delaySeconds:4,transferTo:receiver}]}})
const png=()=>new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'})
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()))
describe('portable launch kits',()=>{
 it('round-trips public presets and raster while removing all source wallet/address/group bindings',async()=>{
  const text=await exportLaunchKit(draft(),png()),store=memory()
  for(const value of [payer,receiver,'actual-wallet-id','private-group-id','old.json'])expect(text).not.toContain(value)
  const parsed=await parseLaunchKit(text);expect(parsed.kit.roles.map(row=>row.role)).toEqual(['deployer','creator-fee','buyer','receiver'])
  const imported=await importLaunchKit(text,store)
  expect(imported.draft.config).toMatchObject({devBuySol:.2,creatorFeeSelection:{kind:'deployer'}})
  expect(imported.draft).toMatchObject({metadataUri:'',bundleSettings:{groupId:null,wallets:[],mode:'organic'}})
  expect(loadLaunchDrafts(store)[0].id).toBe(imported.draft.id)
  expect(readKitRequirements(store)[imported.draft.id].roles).toEqual(parsed.kit.roles)
  expect((await getArtwork(imported.draft.artworkId!))?.blob.size).toBe(12)
 })
 it.each(['private-root','empty-key','wallet-binding','bad-role','svg','large','bad-base64'])('rejects %s imports before touching saved drafts',async kind=>{
  const value=JSON.parse(await exportLaunchKit(draft())),store=memory();store.setItem('unchanged','keep')
  if(kind==='private-root')value.privateKey='secret'
  if(kind==='empty-key')value.preset.secretKey=''
  if(kind==='wallet-binding')value.roles[0].publicKey=payer
  if(kind==='bad-role')value.roles[2].buySol=-1
  if(kind==='svg')value.artwork={type:'image/svg+xml',base64:btoa('<svg/>')}
  if(kind==='large')value.artwork={type:'image/png',base64:'A'.repeat(7_000_000)}
  if(kind==='bad-base64')value.artwork={type:'image/png',base64:'!!!!'}
  await expect(importLaunchKit(JSON.stringify(value),store)).rejects.toThrow()
  expect([...store.rows]).toEqual([['unchanged','keep']])
 })
 it('preserves corrupt draft and kit storage without overwriting either',async()=>{
  const text=await exportLaunchKit(draft())
  for(const key of ['vanity-public-launch-drafts-v1','outsol-launch-kit-roles-v1']){
   const store=memory();store.setItem(key,'{broken');const original=[...store.rows]
   await expect(importLaunchKit(text,store)).rejects.toThrow();expect([...store.rows]).toEqual(original)
  }
 })
 it('keeps legacy plain draft imports working and gives them a fresh id without auto-binding',async()=>{
  const source=draft(),store=memory(),loaded=await importLaunchKit(JSON.stringify(source),store)
  expect(loaded.draft.id).not.toBe(source.id);expect(loaded.draft.metadata).toEqual(source.metadata)
  expect(loaded.draft.bundleSettings?.wallets).toEqual([]);expect(loaded.draft.metadataUri).toBe('')
  expect(loaded.roles.some(row=>row.role==='buyer')).toBe(true)
 })
 it('requires explicit payer, buyer, receiver and creator-fee rebinding before launch',async()=>{
  const store=memory(),loaded=await importLaunchKit(await exportLaunchKit(draft()),store)
  expect(()=>assertKitBindings(loaded.draft.id,loaded.draft.bundleSettings!,{kind:'deployer'},payer,store)).toThrow(/bind|buyer/i)
  const settings=draft().bundleSettings!
  expect(()=>assertKitBindings(loaded.draft.id,settings,{kind:'deployer'},payer,store)).toThrow(/fee/i)
  expect(()=>assertKitBindings(loaded.draft.id,settings,{kind:'wallet',address:receiver},null,store)).toThrow(/wallet|payer/i)
  expect(()=>assertKitBindings(loaded.draft.id,settings,{kind:'wallet',address:receiver},payer,store)).not.toThrow()
  expect(()=>assertKitBindings(loaded.draft.id,{...settings,wallets:settings.wallets.map(row=>({...row,buySol:0}))},{kind:'wallet',address:receiver},payer,store)).toThrow(/budget/i)
  expect(()=>assertKitBindings(loaded.draft.id,{...settings,wallets:settings.wallets.map(row=>({...row,transferTo:undefined}))},{kind:'wallet',address:receiver},payer,store)).toThrow(/receiver/i)
 })
 it('rejects even an empty unknown private-key field nested in a legacy draft',async()=>{
  const source=draft() as unknown as {config:Record<string,unknown>};source.config.secretKey=''
  await expect(parseLaunchKit(JSON.stringify(source))).rejects.toThrow()
 })
 it('accepts an actual valid 5 MB raster export at the advertised limit',async()=>{
  const bytes=new Uint8Array(5*1024*1024);bytes.set([137,80,78,71,13,10,26,10])
  const encoded=await exportLaunchKit(draft(),new Blob([bytes],{type:'image/png'}))
  expect((await parseLaunchKit(encoded)).artwork?.size).toBe(5*1024*1024)
 })
 it('preserves still-unbound roles when a partially rebound imported kit is exported again',async()=>{
  const original=draft(),store=memory(),first=await importLaunchKit(await exportLaunchKit(original),store)
  const partial=createLaunchDraft({...first.draft,bundleSettings:{...original.bundleSettings!,wallets:original.bundleSettings!.wallets.map(row=>({...row,transferTo:undefined}))}},first.draft.id)
  const again=await parseLaunchKit(await exportLaunchKit(partial,undefined,readKitRequirements(store)[first.draft.id]))
  expect(again.kit.roles.map(row=>row.role)).toEqual(['deployer','creator-fee','buyer','receiver'])
 })
 it('rejects a sparse role position that could not map to an explicit buyer slot',async()=>{
  const value=JSON.parse(await exportLaunchKit(draft()));value.roles.find((row:{role:string})=>row.role==='buyer').slot='buyer-16'
  value.roles.find((row:{role:string})=>row.role==='receiver').sourceSlot='buyer-16'
  await expect(parseLaunchKit(JSON.stringify(value))).rejects.toThrow()
 })
})
