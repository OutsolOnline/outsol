import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {readRelayRoutes,saveRelayRoute,removeRelayRoute,RELAY_ROUTES_KEY} from '../src/lib/relay/routes'
function memory(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
const wallets=Array.from({length:4},(_,index)=>({id:`wallet-${index}`,publicKey:Keypair.generate().publicKey.toBase58()}))
describe('public encrypted-library Relay route references',()=>{
 it('saves only named wallet references, updates and removes without serializing private material',()=>{
  const storage=memory(),route=saveRelayRoute({name:'Sniper → treasury',sourceWalletId:wallets[0].id,destinationWalletId:wallets[1].id,secretKey:'never-persist'} as Parameters<typeof saveRelayRoute>[0],wallets,storage)
  expect(readRelayRoutes(storage)).toEqual([route]);expect(storage.getItem(RELAY_ROUTES_KEY)).not.toMatch(/secretKey|never-persist|publicKey/)
  const updated=saveRelayRoute({...route,name:'Primary → Relay'},wallets,storage);expect(updated.createdAt).toBe(route.createdAt);expect(readRelayRoutes(storage)[0].name).toBe('Primary → Relay')
  removeRelayRoute(route.id,storage);expect(readRelayRoutes(storage)).toEqual([])
 })
 it('rejects self routes, cycles, chained overlap, duplicate sources and missing library wallets',()=>{
  const storage=memory(),base={name:'First',sourceWalletId:wallets[0].id,destinationWalletId:wallets[1].id}
  saveRelayRoute(base,wallets,storage)
  for(const input of [{...base,sourceWalletId:wallets[1].id},{...base,destinationWalletId:wallets[2].id},{...base,sourceWalletId:wallets[1].id,destinationWalletId:wallets[0].id},{...base,sourceWalletId:wallets[1].id,destinationWalletId:wallets[2].id},{...base,sourceWalletId:'missing'}])expect(()=>saveRelayRoute(input,wallets,storage)).toThrow()
  expect(readRelayRoutes(storage)).toHaveLength(1)
 })
 it('allows multiple independent sources to share a receiver but compares actual addresses too',()=>{
  const storage=memory();saveRelayRoute({name:'A',sourceWalletId:wallets[0].id,destinationWalletId:wallets[1].id},wallets,storage)
  saveRelayRoute({name:'B',sourceWalletId:wallets[2].id,destinationWalletId:wallets[1].id},wallets,storage)
  expect(readRelayRoutes(storage)).toHaveLength(2)
  expect(()=>saveRelayRoute({name:'Alias',sourceWalletId:wallets[3].id,destinationWalletId:wallets[1].id},[...wallets.slice(0,3),{...wallets[3],publicKey:wallets[0].publicKey}],storage)).toThrow(/source/)
 })
 it('preserves malformed route storage instead of resetting it or silently discarding routes',()=>{
  const storage=memory();storage.setItem(RELAY_ROUTES_KEY,'broken')
  expect(()=>readRelayRoutes(storage)).toThrow(/storage|routes/);expect(()=>saveRelayRoute({name:'Keep',sourceWalletId:wallets[0].id,destinationWalletId:wallets[1].id},wallets,storage)).toThrow()
  expect(storage.getItem(RELAY_ROUTES_KEY)).toBe('broken')
 })
})
