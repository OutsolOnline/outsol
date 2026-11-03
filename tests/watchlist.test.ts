import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {addWatchedWallet,exportWatchlist,importWatchlist,readWatchlist,removeWatchedWallet,updateWatchedWallet,WATCHLIST_KEY} from '../src/lib/watchlist'

const address=Keypair.fromSeed(new Uint8Array(32).fill(41)).publicKey.toBase58()
const other=Keypair.fromSeed(new Uint8Array(32).fill(42)).publicKey.toBase58()
const mint=Keypair.fromSeed(new Uint8Array(32).fill(43)).publicKey.toBase58()
function store(){const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}}

describe('public wallet watchlist',()=>{
 it('roundtrips names, markers and project associations without acquiring signing capability',()=>{
  const storage=store()
  addWatchedWallet({address,name:'Treasury',color:'mint',bookmarked:true,tags:['team'],projectMint:mint,secretKey:'never persist'} as never,storage)
  const text=exportWatchlist(readWatchlist(storage))
  expect(text).not.toContain('never persist')
  const destination=store();importWatchlist(text,destination)
  expect(readWatchlist(destination)).toMatchObject([{address,name:'Treasury',color:'mint',bookmarked:true,tags:['team'],projectMint:mint}])
  expect(Object.keys(readWatchlist(destination)[0])).not.toContain('secretKey')
 })
 it('updates one canonical address and merges duplicate imports without losing other entries',()=>{
  const storage=store();addWatchedWallet({address,name:'A'},storage);addWatchedWallet({address:other,name:'B'},storage)
  updateWatchedWallet(address,{name:'Renamed',bookmarked:true},storage)
  importWatchlist(exportWatchlist([{...readWatchlist(storage)[0],name:'Imported'}]),storage)
  expect(readWatchlist(storage)).toHaveLength(2)
  expect(readWatchlist(storage).find(row=>row.address===address)).toMatchObject({name:'Imported',bookmarked:true})
  removeWatchedWallet(address,storage)
  expect(readWatchlist(storage).map(row=>row.address)).toEqual([other])
 })
 it('rejects invalid imports atomically and preserves corrupt local records',()=>{
  const storage=store();addWatchedWallet({address,name:'A'},storage)
  const before=storage.getItem(WATCHLIST_KEY)
  expect(()=>importWatchlist(JSON.stringify({version:1,type:'outsol-watchlist',wallets:[{address,name:'A'},{address:'invalid',name:'B'}]}),storage)).toThrow()
  expect(storage.getItem(WATCHLIST_KEY)).toBe(before)
  storage.setItem(WATCHLIST_KEY,'{broken')
  expect(()=>addWatchedWallet({address:other,name:'B'},storage)).toThrow(/Preserve/)
  expect(storage.getItem(WATCHLIST_KEY)).toBe('{broken')
 })
 it('enforces address uniqueness and reports storage failures',()=>{
  const storage=store();addWatchedWallet({address,name:'A'},storage)
  expect(()=>addWatchedWallet({address,name:'Again'},storage)).toThrow(/already/)
  expect(()=>addWatchedWallet({address:other,name:'B'}, {getItem:()=>null,setItem:()=>{throw new Error('full')}})).toThrow(/full/)
 })
})
