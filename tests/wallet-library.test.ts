import {beforeEach,describe,expect,it,vi} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {parseWalletImport} from '../src/lib/walletLibrary/import'
import {createWalletLibraryStore} from '../src/stores/walletLibraryStore'
import {WALLET_LIBRARY_KEY,type WalletLibraryLocks} from '../src/lib/walletLibrary/types'
const passphrase='multi wallet test passphrase'
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}}
const locks:WalletLibraryLocks={request:async(_name,_options,callback)=>callback({})}
beforeEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}
describe('bulk wallet parsing',()=>{
 it('accepts Base58 lines, CLI arrays and arrays of named private exports',()=>{
  const a=Keypair.generate(),b=Keypair.generate()
  expect(parseWalletImport(`${bs58.encode(a.secretKey)}\n${bs58.encode(b.secretKey)}`).map(item=>item.publicKey)).toEqual([a.publicKey.toBase58(),b.publicKey.toBase58()])
  expect(parseWalletImport(JSON.stringify(Array.from(a.secretKey)))[0].publicKey).toBe(a.publicKey.toBase58())
  expect(parseWalletImport(JSON.stringify({wallets:[{secretKey:Array.from(a.secretKey),name:'One'},{privateKey:bs58.encode(b.secretKey)}]}))).toHaveLength(2)
 })
 it('rejects a malformed or duplicate batch without partial acceptance',()=>{
  const key=Keypair.generate(),secret=bs58.encode(key.secretKey)
  expect(()=>parseWalletImport(`${secret}\nbad-key`)).toThrow()
  expect(()=>parseWalletImport(`${secret}\n${secret}`)).toThrow(/duplicate/i)
  expect(()=>parseWalletImport(secret,[key.publicKey.toBase58()])).toThrow(/already|duplicate/i)
  expect(()=>parseWalletImport('x'.repeat(131073))).toThrow(/128/)
  const tooMany=Array.from({length:21},()=>bs58.encode(Keypair.generate().secretKey))
  expect(()=>parseWalletImport(JSON.stringify(tooMany))).toThrow(/20/)
  expect(()=>parseWalletImport(JSON.stringify({secretKey:Array.from(key.secretKey),publicKey:Keypair.generate().publicKey.toBase58()}))).toThrow(/match/)
 })
})
describe('encrypted wallet library',()=>{
 it('creates multiple encrypted wallets and groups, exports only unlocked keys and reloads locked',async()=>{
  const disk=storage(),store=createWalletLibraryStore({storage:disk,locks})
  const created=await store.getState().createWallets({count:2,prefix:'Team',passphrase})
  expect(created).toHaveLength(2);expect(store.getState().unlockedIds).toHaveLength(2)
  const group=await store.getState().createGroup('Launch team',created.map(item=>item.id))
  expect(store.getState().groups).toMatchObject([{id:group.id,name:'Launch team',walletIds:created.map(item=>item.id)}])
  const exported=store.getState().exportWallets(created.map(item=>item.id))
  expect(parseWalletImport(exported).map(value=>value.publicKey)).toEqual(created.map(value=>value.publicKey))
  expect(()=>store.getState().exportWallets(Array(21).fill(created[0].id))).toThrow(/20/)
  const secret=JSON.parse(exported).wallets[0].secretKey
  expect(disk.getItem(WALLET_LIBRARY_KEY)).not.toContain(bs58.encode(new Uint8Array(secret)))
  expect(disk.getItem(WALLET_LIBRARY_KEY)).not.toContain(JSON.stringify(secret))
  store.getState().lockAll();expect(()=>store.getState().exportWallets([created[0].id])).toThrow(/unlock/i)
  const reloaded=createWalletLibraryStore({storage:disk,locks});reloaded.getState().hydrate();await reloaded.getState().ready()
  expect(reloaded.getState().wallets).toEqual(created);expect(reloaded.getState().unlockedIds).toEqual([])
  await reloaded.getState().unlockWallets(created.map(item=>item.id),passphrase)
  expect(reloaded.getState().getKeypair(created[1].id)?.publicKey.toBase58()).toBe(created[1].publicKey)
 })
 it('does not save partial imports or overwrite another tab’s collection',async()=>{
  const disk=storage(),a=createWalletLibraryStore({storage:disk,locks}),b=createWalletLibraryStore({storage:disk,locks})
  await a.getState().ready();await b.getState().ready()
  const created=await a.getState().createWallets({count:1,prefix:'One',passphrase})
  const saved=disk.getItem(WALLET_LIBRARY_KEY)
  await expect(b.getState().createWallets({count:1,prefix:'Stale',passphrase})).rejects.toThrow(/changed|another tab/i)
  expect(disk.getItem(WALLET_LIBRARY_KEY)).toBe(saved)
  await expect(a.getState().importWallets({text:`${bs58.encode(Keypair.generate().secretKey)}\nbad-key`,prefix:'Import',passphrase})).rejects.toThrow()
  expect(a.getState().wallets).toEqual(created)
 })
 it('preserves an existing encrypted legacy vault and adopts it without decrypting',async()=>{
  const {encryptWalletSecret}=await import('../src/lib/walletVault'),key=Keypair.generate(),disk=storage()
  const vault=await encryptWalletSecret(bs58.encode(key.secretKey),passphrase,key.publicKey.toBase58())
  disk.setItem('platform-wallet-vault',JSON.stringify(vault));const original=disk.getItem('platform-wallet-vault')
  const store=createWalletLibraryStore({storage:disk,locks});await store.getState().ready()
  expect(store.getState().wallets[0].publicKey).toBe(key.publicKey.toBase58());expect(store.getState().unlockedIds).toEqual([])
  expect(disk.getItem('platform-wallet-vault')).toBe(original)
  await store.getState().unlockWallets([store.getState().wallets[0].id],passphrase)
  expect(store.getState().getActiveWallet()?.publicKey).toBe(key.publicKey.toBase58())
 })
 it('leaves ciphertext unchanged on quota failure and does not partially unlock with a wrong group password',async()=>{
  const disk=storage(),store=createWalletLibraryStore({storage:disk,locks})
  const a=await store.getState().createWallets({count:1,prefix:'A',passphrase}),b=await store.getState().createWallets({count:1,prefix:'B',passphrase:'a different long password'})
  store.getState().lockAll()
  await expect(store.getState().unlockWallets([a[0].id,b[0].id],passphrase)).rejects.toThrow()
  expect(store.getState().unlockedIds).toEqual([])
  const saved=disk.getItem(WALLET_LIBRARY_KEY);disk.setItem=()=>{throw new Error('quota')}
  await expect(store.getState().createWallets({count:1,prefix:'C',passphrase})).rejects.toThrow()
  expect(disk.getItem(WALLET_LIBRARY_KEY)).toBe(saved);expect(store.getState().wallets).toHaveLength(2)
 })
 it('cancels in-flight creation when locked before encryption finishes',async()=>{
  const vaultCrypto=await import('../src/lib/walletVault'),original=vaultCrypto.encryptWalletSecret,started=deferred(),gate=deferred(),disk=storage(),store=createWalletLibraryStore({storage:disk,locks})
  await store.getState().ready()
  vi.spyOn(vaultCrypto,'encryptWalletSecret').mockImplementation(async(...args)=>{started.resolve();await gate.promise;return original(...args)})
  const creating=store.getState().createWallets({count:1,prefix:'Interrupted',passphrase});await started.promise;store.getState().lockAll();gate.resolve()
  await expect(creating).rejects.toThrow(/locked/);expect(store.getState().wallets).toEqual([]);expect(disk.getItem(WALLET_LIBRARY_KEY)).toBeNull()
 })
 it('does not restore secrets when locked during an in-flight unlock',async()=>{
  const disk=storage(),store=createWalletLibraryStore({storage:disk,locks}),created=await store.getState().createWallets({count:1,prefix:'One',passphrase});store.getState().lockAll()
  const vaultCrypto=await import('../src/lib/walletVault'),original=vaultCrypto.decryptWalletSecret,started=deferred(),gate=deferred()
  vi.spyOn(vaultCrypto,'decryptWalletSecret').mockImplementation(async(...args)=>{started.resolve();await gate.promise;return original(...args)})
  const opening=store.getState().unlockWallets([created[0].id],passphrase);await started.promise;store.getState().lockAll();gate.resolve()
  await expect(opening).rejects.toThrow(/unlock/);expect(store.getState().getKeypair(created[0].id)).toBeNull();expect(store.getState().unlockedIds).toEqual([])
 })
 it('rejects stale changes made while encrypting and immediately invalidates old signing keys',async()=>{
  const disk=storage(),store=createWalletLibraryStore({storage:disk,locks}),created=await store.getState().createWallets({count:1,prefix:'Original',passphrase})
  const vaultCrypto=await import('../src/lib/walletVault'),original=vaultCrypto.encryptWalletSecret,started=deferred(),gate=deferred()
  vi.spyOn(vaultCrypto,'encryptWalletSecret').mockImplementation(async(...args)=>{started.resolve();await gate.promise;return original(...args)})
  const adding=store.getState().createWallets({count:1,prefix:'Stale',passphrase});await started.promise
  const replacement=JSON.parse(disk.getItem(WALLET_LIBRARY_KEY)!);replacement.revision++;disk.setItem(WALLET_LIBRARY_KEY,JSON.stringify(replacement));const saved=disk.getItem(WALLET_LIBRARY_KEY)
  expect(store.getState().getKeypair(created[0].id)).toBeNull();gate.resolve();await expect(adding).rejects.toThrow(/locked|changed/)
  expect(disk.getItem(WALLET_LIBRARY_KEY)).toBe(saved)
 })
 it('keeps wallets when groups are renamed, emptied and removed',async()=>{
  const store=createWalletLibraryStore({storage:storage(),locks}),created=await store.getState().createWallets({count:2,prefix:'Team',passphrase})
  const group=await store.getState().createGroup('First',created.map(value=>value.id));await store.getState().updateGroup(group.id,{name:'Second',walletIds:[]})
  expect(store.getState().groups).toMatchObject([{name:'Second',walletIds:[]}]);await store.getState().removeGroup(group.id)
  expect(store.getState().wallets).toEqual(created);expect(store.getState().getKeypair(created[0].id)).not.toBeNull()
 })
 it('refuses a busy cross-tab lock and preserves malformed data without saving',async()=>{
  const disk=storage(),busy:WalletLibraryLocks={request:async(_name,_options,callback)=>callback(null)},store=createWalletLibraryStore({storage:disk,locks:busy})
  await expect(store.getState().createWallets({count:1,prefix:'Blocked',passphrase})).rejects.toThrow(/another tab/i);expect(disk.getItem(WALLET_LIBRARY_KEY)).toBeNull()
  disk.setItem(WALLET_LIBRARY_KEY,'{');const bad=createWalletLibraryStore({storage:disk,locks});await expect(bad.getState().ready()).rejects.toThrow(/cannot be read/)
  expect(bad.getState().storageUnavailable).toBe(true);expect(disk.getItem(WALLET_LIBRARY_KEY)).toBe('{')
 })
 it('adopts a newly encrypted previous wallet after initialization without a nested write lock',async()=>{
  let held=false;const strict:WalletLibraryLocks={request:async(_name,_options,callback)=>{if(held)return callback(null);held=true;try{return await callback({})}finally{held=false}}}
  const disk=storage(),store=createWalletLibraryStore({storage:disk,locks:strict});await store.getState().ready()
  disk.setItem('platform-wallet',JSON.stringify({state:{secretKeyBase58:'preserve-unread-legacy'}}));const key=Keypair.generate(),{encryptWalletSecret}=await import('../src/lib/walletVault')
  disk.setItem('platform-wallet-vault',JSON.stringify(await encryptWalletSecret(bs58.encode(key.secretKey),passphrase,key.publicKey.toBase58())))
  await store.getState().adoptLegacyWallet();expect(store.getState().wallets[0].publicKey).toBe(key.publicKey.toBase58());expect(disk.getItem('platform-wallet')).toContain('preserve-unread-legacy')
 })
 it('locks memory and reloads public metadata on a browser storage change',async()=>{
  let storageListener:((event:{key:string;newValue:string})=>void)|undefined
  vi.stubGlobal('window',{addEventListener:(name:string,listener:typeof storageListener)=>{if(name==='storage')storageListener=listener}})
  const disk=storage(),store=createWalletLibraryStore({storage:disk,locks}),created=await store.getState().createWallets({count:1,prefix:'Before',passphrase})
  const changed=JSON.parse(disk.getItem(WALLET_LIBRARY_KEY)!);changed.revision++;changed.wallets[0].name='Changed in another tab';const raw=JSON.stringify(changed);disk.setItem(WALLET_LIBRARY_KEY,raw)
  storageListener!({key:WALLET_LIBRARY_KEY,newValue:raw})
  expect(store.getState().unlockedIds).toEqual([]);expect(store.getState().getKeypair(created[0].id)).toBeNull()
  await store.getState().ready();expect(store.getState().wallets[0].name).toBe('Changed in another tab')
 })
})
