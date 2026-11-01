import {afterEach,describe,expect,it,vi} from 'vitest'
import {Keypair,PublicKey} from '@solana/web3.js'
import {SNIPER_PAIRS_KEY,parseSniperPairRecord,resolveSniperPairs,type SniperPair,type SniperPairInput} from '../src/lib/sniperPairs/catalog'
import {createSniperPairStore} from '../src/stores/sniperPairStore'
import type {WalletSummary} from '../src/lib/walletLibrary/types'

const time='2026-11-01T00:00:00.000Z'
function wallet(id:string):WalletSummary{return{id,name:id,publicKey:Keypair.generate().publicKey.toBase58(),createdAt:time}}
function input(name='A'):{pair:SniperPairInput;wallets:WalletSummary[]}{const a=wallet(`${name}-sniper`),b=wallet(`${name}-receiver`);return{pair:{name,sniperWalletId:a.id,sniperAddress:a.publicKey,receiverWalletId:b.id,receiverAddress:b.publicKey},wallets:[a,b]}}
const saved=(value:SniperPairInput,id='pair-a'):SniperPair=>({...value,id,createdAt:time})
function disk(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}}
afterEach(()=>vi.unstubAllGlobals())

describe('public reusable sniper pair catalog',()=>{
 it('persists only public pair data and reuses the same pair after refresh',()=>{
  const storage=disk(),value=input(),store=createSniperPairStore({storage,listen:false})
  const [pair]=store.getState().addPairs([value.pair]);expect(pair).toMatchObject(value.pair)
  expect(store.getState()).toMatchObject({hydrated:true,revision:1,storageUnavailable:false})
  const raw=storage.getItem(SNIPER_PAIRS_KEY)!;expect(Object.keys(JSON.parse(raw))).toEqual(['version','revision','pairs'])
  expect(Object.keys(JSON.parse(raw).pairs[0]).sort()).toEqual(['id','name','sniperWalletId','sniperAddress','receiverWalletId','receiverAddress','createdAt'].sort())
  const cold=createSniperPairStore({storage,listen:false});cold.getState().hydrate();expect(cold.getState().pairs).toEqual([pair]);cold.getState().hydrate();expect(cold.getState().revision).toBe(1)
  pair.name='Modified caller object';expect(cold.getState().pairs[0].name).toBe('A');expect(store.getState().pairs[0].name).toBe('A')
 })
 it('resolves restored source and receiver by exact public address after local IDs change',()=>{
  const value=input(),pair=saved(value.pair),wallets=value.wallets.map((row,index)=>({...row,id:`restored-${index}`}))
  const [resolved]=resolveSniperPairs([pair],wallets)
  expect(resolved.sniper.id).toBe('restored-0');expect(resolved.receiver.id).toBe('restored-1')
  expect(resolved.sniper.publicKey).toBe(pair.sniperAddress);expect(resolved.receiver.publicKey).toBe(pair.receiverAddress)
  expect(pair.sniperWalletId).toBe('A-sniper')
 })
 it('refuses missing wallets, an ID reassigned to another key and ambiguous public addresses',()=>{
  const value=input(),pair=saved(value.pair)
  expect(()=>resolveSniperPairs([pair],[value.wallets[0]])).toThrow(/restore|import|missing/i)
  expect(()=>resolveSniperPairs([pair],[{...wallet(value.pair.sniperWalletId)},value.wallets[1]])).toThrow(/changed|match/i)
  expect(()=>resolveSniperPairs([pair],[...value.wallets,{...value.wallets[1],id:'copy'}])).toThrow(/duplicate|ambiguous/i)
 })
 it('rejects cross-role reuse, duplicate pair names and malformed wallet identities atomically',()=>{
  const storage=disk(),store=createSniperPairStore({storage,listen:false}),a=input(),b=input('B')
  store.getState().addPairs([a.pair]);const before=storage.getItem(SNIPER_PAIRS_KEY)
  expect(()=>store.getState().addPairs([{...b.pair,sniperWalletId:a.pair.receiverWalletId,sniperAddress:a.pair.receiverAddress}])).toThrow(/distinct|already|duplicate/i)
  expect(()=>store.getState().addPairs([{...b.pair,name:' a '}])).toThrow(/name|already|duplicate/i)
  expect(()=>store.getState().addPairs([{...b.pair,receiverAddress:'bad address'}])).toThrow(/address/i)
  expect(storage.getItem(SNIPER_PAIRS_KEY)).toBe(before);expect(store.getState().pairs).toHaveLength(1)
 })
 it('rejects off-curve accounts and a same-wallet pair',()=>{
  const value=input(),program=Keypair.generate().publicKey,pda=PublicKey.findProgramAddressSync([Buffer.from('pair')],program)[0].toBase58()
  expect(()=>resolveSniperPairs([saved({...value.pair,receiverAddress:pda})],value.wallets)).toThrow(/address|wallet/i)
  expect(()=>resolveSniperPairs([saved({...value.pair,receiverAddress:value.pair.sniperAddress,receiverWalletId:value.pair.sniperWalletId})],value.wallets)).toThrow(/distinct|duplicate/i)
 })
 it('refuses unknown private fields in both public inputs and stored records',()=>{
  const value=input(),storage=disk(),store=createSniperPairStore({storage,listen:false})
  expect(()=>store.getState().addPairs([{...value.pair,privateKey:'must never persist'} as SniperPairInput])).toThrow(/public|field|invalid/i)
  expect(storage.getItem(SNIPER_PAIRS_KEY)).toBeNull()
  expect(()=>parseSniperPairRecord(JSON.stringify({version:1,revision:1,pairs:[{...saved(value.pair),secretKey:[1,2,3]}]}))).toThrow()
  expect(()=>parseSniperPairRecord(JSON.stringify({version:1,revision:1,pairs:[saved(value.pair)],vault:'private'}))).toThrow()
 })
 it('preserves corrupt and oversized records without overwriting them',()=>{
  for(const raw of ['{broken',JSON.stringify({version:1,revision:1,pairs:'wrong'}),' '.repeat(64001)]){
   const storage=disk();storage.setItem(SNIPER_PAIRS_KEY,raw);const store=createSniperPairStore({storage,listen:false});store.getState().hydrate()
   expect(store.getState().storageUnavailable).toBe(true);expect(()=>store.getState().addPairs([input().pair])).toThrow(/storage|preserve|read/i);expect(storage.getItem(SNIPER_PAIRS_KEY)).toBe(raw)
  }
 })
 it('refuses a stale tab write rather than deleting another tab’s pairs',()=>{
  const storage=disk(),a=createSniperPairStore({storage,listen:false}),b=createSniperPairStore({storage,listen:false});a.getState().hydrate();b.getState().hydrate()
  a.getState().addPairs([input().pair]);const before=storage.getItem(SNIPER_PAIRS_KEY)
  expect(()=>b.getState().addPairs([input('B').pair])).toThrow(/another tab|changed|reload/i);expect(storage.getItem(SNIPER_PAIRS_KEY)).toBe(before);expect(b.getState().pairs).toEqual([])
 })
 it('keeps state and saved records intact when storage throws or silently rejects a write',()=>{
  const storage=disk(),store=createSniperPairStore({storage,listen:false});store.getState().addPairs([input().pair]);const before=storage.getItem(SNIPER_PAIRS_KEY)
  storage.setItem=()=>{throw new Error('quota')};expect(()=>store.getState().addPairs([input('B').pair])).toThrow();expect(store.getState().pairs).toHaveLength(1);expect(storage.getItem(SNIPER_PAIRS_KEY)).toBe(before)
  const cold=createSniperPairStore({storage:{...storage,setItem:()=>{}},listen:false});cold.getState().hydrate();expect(()=>cold.getState().renamePair(cold.getState().pairs[0].id,'Renamed')).toThrow(/saved|storage/i);expect(cold.getState().pairs[0].name).toBe('A')
 })
 it('renames and removes a pair without touching wallet storage',()=>{
  const storage=disk();storage.setItem('outsol-wallet-library-v1','preserved');const store=createSniperPairStore({storage,listen:false}),[pair]=store.getState().addPairs([input().pair]);store.getState().renamePair(pair.id,'Moon launch')
  expect(store.getState().pairs[0].name).toBe('Moon launch');expect(store.getState().revision).toBe(2);store.getState().removePair(pair.id);expect(store.getState().pairs).toEqual([]);expect(store.getState().revision).toBe(3);expect(storage.getItem('outsol-wallet-library-v1')).toBe('preserved')
 })
 it('bounds the catalog and rejects an empty or oversized batch without saving',()=>{
  const storage=disk(),store=createSniperPairStore({storage,listen:false});expect(()=>store.getState().addPairs([])).toThrow()
  const fifty=Array.from({length:50},(_,i)=>input(`Pair-${i}`).pair);expect(store.getState().addPairs(fifty)).toHaveLength(50)
  expect(()=>store.getState().addPairs([input('Extra').pair])).toThrow(/50/);expect(store.getState().pairs).toHaveLength(50)
 })
 it('reloads public pairs on a storage event and fails closed on a corrupt change',()=>{
  let handler:((event:StorageEvent)=>void)|undefined
  vi.stubGlobal('window',{addEventListener:(_name:string,listener:(event:StorageEvent)=>void)=>{handler=listener}})
  const storage=disk(),watcher=createSniperPairStore({storage}),writer=createSniperPairStore({storage,listen:false});watcher.getState().hydrate();writer.getState().addPairs([input().pair]);handler!({key:SNIPER_PAIRS_KEY} as StorageEvent)
  expect(watcher.getState().pairs).toEqual(writer.getState().pairs);expect(watcher.getState().revision).toBe(1)
  storage.setItem(SNIPER_PAIRS_KEY,'corrupt');handler!({key:SNIPER_PAIRS_KEY} as StorageEvent);expect(watcher.getState().storageUnavailable).toBe(true);expect(watcher.getState().pairs).toHaveLength(1)
 })
})
