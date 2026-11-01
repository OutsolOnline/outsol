import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {createSniperPairStore} from '../src/stores/sniperPairStore'
import {buildSniperSessionBackup,parseSniperSessionBackup} from '../src/lib/sniperPairs/sessionBackup'
import {generateSniperSession,restoreSniperSession,unlockSniperSessionWallets,type SniperSessionSetupPorts,type SniperSessionUnlockPorts} from '../src/lib/sniperPairs/sessionSetup'
import {resolveSniperPairs} from '../src/lib/sniperPairs/catalog'
import {parseWalletImport} from '../src/lib/walletLibrary/import'
import type {WalletLibraryState} from '../src/stores/walletLibraryStore'
import type {WalletSummary} from '../src/lib/walletLibrary/types'

const passphrase='Disposable session passphrase'
function harness(){
 const data=new Map<string,string>(),catalog=createSniperPairStore({storage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value)}},listen:false});catalog.getState().hydrate()
 const calls:number[]=[],imports:number[]=[],keys=new Map<string,Keypair>();let next=0,available=true
 const library={hydrated:true,storageUnavailable:false,revision:0,wallets:[] as WalletSummary[],createWallets:async(input:{count:number;prefix:string})=>{calls.push(input.count);const created=Array.from({length:input.count},(_,index)=>{const key=Keypair.generate(),id=`wallet-${++next}`;keys.set(id,key);return{id,name:`${input.prefix} ${index+1}`,publicKey:key.publicKey.toBase58(),createdAt:new Date().toISOString()}});library.wallets.push(...created);library.revision++;return structuredClone(created)},renameWallet:async(id:string,name:string)=>{library.wallets=library.wallets.map(wallet=>wallet.id===id?{...wallet,name}:wallet);library.revision++},importWallets:async(input:{text:string})=>{const rows=parseWalletImport(input.text,library.wallets.map(wallet=>wallet.publicKey));imports.push(rows.length);const created=rows.map((row,index)=>({id:`wallet-${++next}`,name:row.name||`Imported ${index+1}`,publicKey:row.publicKey,createdAt:new Date().toISOString()}));library.wallets.push(...created);library.revision++;return structuredClone(created)}}
 const ports:SniperSessionSetupPorts={readLibrary:()=>library as unknown as WalletLibraryState,readPairs:catalog.getState,assertAvailable:()=>{if(!available)throw new Error('Pending launch')}}
 return{library,catalog,ports,calls,imports,keys,setAvailable:(value:boolean)=>{available=value}}
}
async function exported(count=2){const h=harness(),result=await generateSniperSession({count,includeDeployer:true,passphrase},h.ports),pairs=resolveSniperPairs(h.catalog.getState().pairs,h.library.wallets),deployer=h.library.wallets.find(wallet=>wallet.id===result.deployerId)!;return parseSniperSessionBackup(buildSniperSessionBackup({name:'Saved session',pairs,deployer,readKeypair:id=>h.keys.get(id)??null}).content)}

describe('sniper session setup orchestration',()=>{
 it('creates every pair plus a distinct deployer with one action and exact role names',async()=>{
  const h=harness(),result=await generateSniperSession({count:2,includeDeployer:true,passphrase},h.ports)
  expect(h.calls).toEqual([5]);expect(result.pairIds).toHaveLength(2);expect(h.library.wallets.map(wallet=>wallet.name)).toEqual(['Session deployer','A Sniper','A Token Receiver','B Sniper','B Token Receiver'])
  const pairs=resolveSniperPairs(h.catalog.getState().pairs,h.library.wallets);expect(pairs.map(pair=>pair.name)).toEqual(['A','B']);expect(pairs.flatMap(pair=>[pair.sniper.id,pair.receiver.id])).not.toContain(result.deployerId)
 })
 it('generates all 16 pairs in bounded encrypted chunks and never repeats used labels',async()=>{
  const h=harness();await generateSniperSession({count:1,includeDeployer:false,passphrase},h.ports);h.calls.length=0
  await generateSniperSession({count:16,includeDeployer:true,passphrase},h.ports)
  expect(h.calls).toEqual([20,13]);expect(h.catalog.getState().pairs.at(-1)?.name).toBe('Q');expect(h.library.wallets).toHaveLength(35)
 })
 it('refuses invalid counts, insufficient capacity and pending work before creating any keys',async()=>{
  const h=harness();await expect(generateSniperSession({count:17,includeDeployer:false,passphrase},h.ports)).rejects.toThrow(/16/);h.setAvailable(false)
  await expect(generateSniperSession({count:1,includeDeployer:false,passphrase},h.ports)).rejects.toThrow(/Pending/);expect(h.calls).toEqual([])
 })
 it('preserves encrypted wallets when work is interrupted after its first batch',async()=>{
  const h=harness(),create=h.library.createWallets;h.library.createWallets=async input=>{const created=await create(input);h.setAvailable(false);return created}
  await expect(generateSniperSession({count:16,includeDeployer:true,passphrase},h.ports)).rejects.toThrow(/20.*saved|saved.*20/);expect(h.library.wallets).toHaveLength(20);expect(h.catalog.getState().pairs).toEqual([])
 })
 it('restores pair roles and deployer from one file in chunks of at most 20',async()=>{
  const parsed=await exported(16),h=harness(),restored=await restoreSniperSession(parsed,passphrase,h.ports)
  expect(h.imports).toEqual([20,13]);expect(restored.pairIds).toHaveLength(16);expect(restored.name).toBe('Saved session');expect(h.library.wallets.find(wallet=>wallet.id===restored.deployerId)?.publicKey).toBe(parsed.deployerAddress)
  const pairs=resolveSniperPairs(h.catalog.getState().pairs,h.library.wallets);expect(pairs.map(pair=>[pair.sniper.publicKey,pair.receiver.publicKey])).toEqual(parsed.pairs.map(pair=>[pair.sniperAddress,pair.receiverAddress]))
 })
 it('reuses matching wallets and existing pair records without duplicate import or overwrite',async()=>{
  const parsed=await exported(),h=harness();await restoreSniperSession(parsed,passphrase,h.ports);const pairs=structuredClone(h.catalog.getState().pairs),wallets=structuredClone(h.library.wallets);h.imports.length=0
  const restored=await restoreSniperSession(parsed,passphrase,h.ports);expect(h.imports).toEqual([]);expect(h.catalog.getState().pairs).toEqual(pairs);expect(h.library.wallets).toEqual(wallets);expect(restored.pairIds).toEqual(pairs.map(pair=>pair.id))
 })
 it('preflights conflicting pair names and cross-role reuse before importing any wallet',async()=>{
  const parsed=await exported(),h=harness();await generateSniperSession({count:1,includeDeployer:false,passphrase},h.ports);h.imports.length=0
  await expect(restoreSniperSession(parsed,passphrase,h.ports)).rejects.toThrow(/name|different|conflict/i);expect(h.imports).toEqual([])
 })
 it('does not roll back encrypted keys after a later import batch fails',async()=>{
  const parsed=await exported(16),h=harness(),importer=h.library.importWallets;let count=0;h.library.importWallets=async input=>{if(++count===2)throw new Error('Storage quota');return importer(input)}
  await expect(restoreSniperSession(parsed,passphrase,h.ports)).rejects.toThrow(/20.*saved|saved.*20/);expect(h.library.wallets).toHaveLength(20);expect(h.catalog.getState().pairs).toEqual([])
 })
 it('preserves every encrypted wallet when public pair persistence fails after generation',async()=>{
  const h=harness();h.catalog.setState({addPairs:()=>{throw new Error('Pair storage quota')}})
  await expect(generateSniperSession({count:2,includeDeployer:false,passphrase},h.ports)).rejects.toThrow(/4.*saved|saved.*4/)
  expect(h.library.wallets.map(wallet=>wallet.name)).toEqual(['A Sniper','A Token Receiver','B Sniper','B Token Receiver']);expect(h.catalog.getState().pairs).toEqual([])
 })
 it('restores existing pair references by address when imported local wallet IDs change',async()=>{
  const parsed=await exported(),h=harness();const original=await restoreSniperSession(parsed,passphrase,h.ports);h.imports.length=0
  h.library.wallets=h.library.wallets.map(wallet=>({...wallet,id:`restored-${wallet.id}`}));h.library.revision++
  const restored=await restoreSniperSession(parsed,passphrase,h.ports);expect(restored.pairIds).toEqual(original.pairIds);expect(h.imports).toEqual([])
  expect(resolveSniperPairs(h.catalog.getState().pairs,h.library.wallets).every(pair=>pair.sniper.id.startsWith('restored-')&&pair.receiver.id.startsWith('restored-'))).toBe(true)
 })
 it('checks even an existing wallet’s supplied backup key before skipping duplicate import',async()=>{
  const parsed=await exported(),h=harness();await restoreSniperSession(parsed,passphrase,h.ports);h.imports.length=0
  parsed.wallets[0].privateKey=parsed.wallets[1].privateKey
  await expect(restoreSniperSession(parsed,passphrase,h.ports)).rejects.toThrow(/match/i);expect(h.imports).toEqual([])
 })
 it('allows only one generation or restore operation in the same session at a time',async()=>{
  const h=harness(),original=h.library.createWallets;let release!:()=>void,started!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}),opening=new Promise<void>(resolve=>{started=resolve})
  h.library.createWallets=async input=>{started();await gate;return original(input)}
  const active=generateSniperSession({count:1,includeDeployer:false,passphrase},h.ports);await opening
  await expect(generateSniperSession({count:1,includeDeployer:false,passphrase},h.ports)).rejects.toThrow(/Finish.*session/i)
  release();expect((await active).pairIds).toHaveLength(1);expect(h.calls).toEqual([2])
 })
 it('unlocks every source, receiver and separate deployer in batches of at most 20',async()=>{
  const h=harness();await generateSniperSession({count:16,includeDeployer:true,passphrase},h.ports)
  const unlocked=new Set<string>(),batches:number[]=[],ports:SniperSessionUnlockPorts={readLibrary:()=>({...h.library,getKeypair:id=>unlocked.has(id)?h.keys.get(id)??null:null,unlockWallets:async ids=>{batches.push(ids.length);ids.forEach(id=>unlocked.add(id))}}),assertAvailable:()=>{}}
  expect(await unlockSniperSessionWallets(h.library.wallets,passphrase,ports)).toBe(33);expect(batches).toEqual([20,13]);expect(unlocked.size).toBe(33)
 })
 it('stops later unlock batches when the selection guard changes and reports the completed batch',async()=>{
  const h=harness();await generateSniperSession({count:16,includeDeployer:true,passphrase},h.ports)
  const unlocked=new Set<string>(),batches:number[]=[];let changed=false
  const ports:SniperSessionUnlockPorts={readLibrary:()=>({...h.library,getKeypair:id=>unlocked.has(id)?h.keys.get(id)??null:null,unlockWallets:async ids=>{batches.push(ids.length);ids.forEach(id=>unlocked.add(id));changed=true}}),assertAvailable:()=>{if(changed)throw new Error('Selected pairs changed')}}
  await expect(unlockSniperSessionWallets(h.library.wallets,passphrase,ports)).rejects.toThrow(/20.*unlocked.*changed/i);expect(batches).toEqual([20]);expect(unlocked.size).toBe(20)
 })
 it('refuses unlocking changed wallet addresses even when the local IDs still exist',async()=>{
  const h=harness();await generateSniperSession({count:1,includeDeployer:true,passphrase},h.ports);const selected=structuredClone(h.library.wallets);h.library.wallets[0].publicKey=Keypair.generate().publicKey.toBase58();let called=false
  const ports:SniperSessionUnlockPorts={readLibrary:()=>({...h.library,getKeypair:()=>null,unlockWallets:async()=>{called=true}}),assertAvailable:()=>{}}
  await expect(unlockSniperSessionWallets(selected,passphrase,ports)).rejects.toThrow(/changed/i);expect(called).toBe(false)
 })
})
