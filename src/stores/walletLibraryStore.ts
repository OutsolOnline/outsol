'use client'
import {create} from 'zustand'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {decryptWalletSecret,encryptWalletSecret} from '@/lib/walletVault'
import {parseWalletImport} from '@/lib/walletLibrary/import'
import {commitWalletLibrary,emptyWalletLibrary,libraryId,libraryName,publicWalletSummary,readWalletLibrary,safeWalletVault} from '@/lib/walletLibrary/storage'
import {MAX_GROUP_WALLETS,MAX_LIBRARY_WALLETS,MAX_WALLET_BATCH,WALLET_LIBRARY_KEY,WALLET_LIBRARY_LOCK,type StoredLibraryWallet,type WalletBatchInput,type WalletLibraryGroup,type WalletLibraryLocks,type WalletLibraryRecord,type WalletLibraryStorage,type WalletSummary} from '@/lib/walletLibrary/types'
export type {WalletSummary,WalletLibraryGroup} from '@/lib/walletLibrary/types'
export interface WalletLibraryState{
 wallets:WalletSummary[];groups:WalletLibraryGroup[];activeId:string|null;hydrated:boolean;busy:boolean;error:string|null;storageUnavailable:boolean;legacyMigrationNeeded:boolean;unlockedIds:string[];revision:number
 hydrate():void;ready():Promise<void>;reload():Promise<void>;adoptLegacyWallet():Promise<void>
 createWallets(input:WalletBatchInput&{count:number}):Promise<WalletSummary[]>;importWallets(input:WalletBatchInput&{text:string}):Promise<WalletSummary[]>
 unlockWallets(ids:string[],passphrase:string):Promise<void>;lockAll():void;lockWallets(ids:string[]):void;selectWallet(id:string|null):void
 getKeypair(id:string):Keypair|null;getActiveWallet():WalletSummary|null
 createGroup(name:string,walletIds?:string[]):Promise<WalletLibraryGroup>;updateGroup(id:string,patch:{name?:string;walletIds?:string[]}):Promise<void>;removeGroup(id:string):Promise<void>;renameWallet(id:string,name:string):Promise<void>;exportWallets(ids:string[]):string
}
interface Options{storage?:WalletLibraryStorage;locks?:WalletLibraryLocks;listen?:boolean}
async function mapBounded<T,R>(items:T[],operation:(item:T,index:number)=>Promise<R>):Promise<R[]>{const result=new Array<R>(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(2,items.length)},async()=>{while(cursor<items.length){const index=cursor++;result[index]=await operation(items[index],index)}}));return result}
export function createWalletLibraryStore(options:Options={}){
 let record:WalletLibraryRecord=emptyWalletLibrary(),raw:string|null=null,epoch=0,operation=false,initializing:Promise<void>|undefined
 const keys=new Map<string,Keypair>()
 const destination=()=>{if(options.storage)return options.storage;if(typeof localStorage==='undefined')throw new Error('Wallet library storage is unavailable.');return localStorage}
 const locks=()=>{const result=options.locks??(typeof navigator!=='undefined'?navigator.locks:undefined);if(!result)throw new Error('Use a current browser with secure cross-tab wallet coordination.');return result as WalletLibraryLocks}
 const store=create<WalletLibraryState>((set,get)=>{
  const apply=(next:WalletLibraryRecord)=>{record=next;const current=get().activeId;set({wallets:next.wallets.map(publicWalletSummary),groups:structuredClone(next.groups),activeId:next.wallets.some(value=>value.id===current)?current:next.wallets[0]?.id??null,revision:next.revision,unlockedIds:[...keys.keys()].filter(id=>next.wallets.some(value=>value.id===id))})}
  const fail=(error:unknown)=>{const message=error instanceof Error?error.message:'Wallet library operation failed.';set({error:message});return error instanceof Error?error:new Error(message)}
  const lockedWrite=async<T,>(action:()=>Promise<T>)=>locks().request(WALLET_LIBRARY_LOCK,{ifAvailable:true},async lock=>{if(!lock)throw new Error('Another tab is updating the wallet library. Try again when it finishes.');if(destination().getItem(WALLET_LIBRARY_KEY)!==raw)throw new Error('The wallet library changed in another tab. Reload it before making changes.');return action()})
  const persist=(next:WalletLibraryRecord)=>{const committed=commitWalletLibrary(destination(),raw,{...next,revision:record.revision+1});raw=committed.raw;apply(committed.record)}
  const addLegacy=async(force=false,alreadyLocked=false)=>{
   const disk=destination(),legacy=disk.getItem('platform-wallet-vault')
   set({legacyMigrationNeeded:!!disk.getItem('platform-wallet')})
   if(!legacy||(!force&&record.legacyImported))return
   if(legacy.length>10000)throw new Error('The previous encrypted wallet cannot be read safely. Preserve its backup.')
   const vault=safeWalletVault(JSON.parse(legacy)),exists=record.wallets.some(value=>value.publicKey===vault.publicKey)
   if(!exists&&record.wallets.length>=MAX_LIBRARY_WALLETS)throw new Error('The wallet library is full. The previous encrypted wallet remains preserved.')
   const save=async()=>persist({...record,legacyImported:true,wallets:exists?record.wallets:[...record.wallets,{id:crypto.randomUUID(),name:'Previous wallet',publicKey:vault.publicKey,createdAt:new Date().toISOString(),vault}]})
   if(alreadyLocked)await save();else await lockedWrite(save)
  }
  const load=async()=>{const current=readWalletLibrary(destination());raw=current.raw;apply(current.record);await addLegacy();set({hydrated:true,storageUnavailable:false,error:null})}
  const ready=async()=>{if(!initializing){initializing=load().catch(error=>{epoch++;keys.clear();set({hydrated:true,storageUnavailable:true,unlockedIds:[],error:error instanceof Error?error.message:'Wallet library storage is unavailable.'});throw error})}return initializing}
  const mutate=async<T,>(action:()=>Promise<T>)=>{await ready();if(get().storageUnavailable)throw new Error('Wallet storage is unavailable. Preserve browser data before continuing.');if(operation)throw new Error('Finish the current wallet-library operation first.');operation=true;set({busy:true,error:null});try{return await lockedWrite(action)}catch(error){throw fail(error)}finally{operation=false;set({busy:false})}}
  const ids=(values:string[],max=MAX_GROUP_WALLETS)=>{if(!Array.isArray(values)||!values.length||values.length>max)throw new Error(`Choose between one and ${max} wallets.`);const result=values.map(libraryId);if(new Set(result).size!==result.length||result.some(id=>!record.wallets.some(value=>value.id===id)))throw new Error('Choose distinct wallets that exist in this library.');return result}
  const append=async(input:WalletBatchInput,material:{publicKey:string;secretKeyBase58:string;name?:string}[])=>{
   if(input.passphrase.length<12)throw new Error('Use a passphrase of at least 12 characters.')
   const prefix=libraryName(input.prefix),initialEpoch=epoch
   if(record.wallets.length+material.length>MAX_LIBRARY_WALLETS)throw new Error('The wallet library supports at most 100 wallets.')
   const group=input.groupId?record.groups.find(value=>value.id===input.groupId):undefined
   if(input.groupId&&!group)throw new Error('The selected group no longer exists.')
   if(group&&group.walletIds.length+material.length>MAX_GROUP_WALLETS)throw new Error('A group supports at most 20 wallets.')
   const existing=new Set(record.wallets.map(value=>value.publicKey));if(material.some(value=>existing.has(value.publicKey)))throw new Error('An imported wallet is already in this library.')
   const created=await mapBounded(material,async(value,index):Promise<StoredLibraryWallet>=>({id:crypto.randomUUID(),name:value.name||`${prefix.slice(0,56)} ${index+1}`,publicKey:value.publicKey,createdAt:new Date().toISOString(),vault:await encryptWalletSecret(value.secretKeyBase58,input.passphrase,value.publicKey)}))
   if(initialEpoch!==epoch)throw new Error('The wallet library was locked while preparing wallets. Nothing was saved.')
   persist({...record,wallets:[...record.wallets,...created],groups:record.groups.map(value=>value.id===input.groupId?{...value,walletIds:[...value.walletIds,...created.map(wallet=>wallet.id)],updatedAt:new Date().toISOString()}:value)})
   if(initialEpoch===epoch){created.forEach((value,index)=>keys.set(value.id,Keypair.fromSecretKey(bs58.decode(material[index].secretKeyBase58))));set({unlockedIds:[...keys.keys()]})}
   return created.map(publicWalletSummary)
  }
  return {
   wallets:[],groups:[],activeId:null,hydrated:false,busy:false,error:null,storageUnavailable:false,legacyMigrationNeeded:false,unlockedIds:[],revision:0,
   hydrate:()=>{void ready().catch(()=>{})},ready,
   reload:async()=>{epoch++;keys.clear();set({unlockedIds:[]});if(operation)throw new Error('Finish the current wallet-library operation first.');initializing=undefined;await ready()},
   adoptLegacyWallet:()=>mutate(()=>addLegacy(true,true)),
   createWallets:input=>mutate(async()=>{if(!Number.isInteger(input.count)||input.count<1||input.count>MAX_WALLET_BATCH)throw new Error('Create between one and 20 wallets at a time.');const material=Array.from({length:input.count},()=>{const key=Keypair.generate();return {publicKey:key.publicKey.toBase58(),secretKeyBase58:bs58.encode(key.secretKey)}});return append(input,material)}),
   importWallets:input=>mutate(()=>append(input,parseWalletImport(input.text,record.wallets.map(value=>value.publicKey)))),
   unlockWallets:async(values,passphrase)=>{await ready();if(get().storageUnavailable)throw new Error('Wallet storage is unavailable.');if(operation)throw new Error('Finish the current wallet-library operation first.');operation=true;set({busy:true,error:null});try{
    const chosen=ids(values),initialEpoch=epoch,initialRaw=raw
    const opened=await mapBounded(chosen,async id=>{const value=record.wallets.find(value=>value.id===id)!;const secret=await decryptWalletSecret(value.vault,passphrase);const key=Keypair.fromSecretKey(bs58.decode(secret));if(key.publicKey.toBase58()!==value.publicKey)throw new Error('The unlocked key does not match its wallet address.');return {id,key}})
    if(initialEpoch!==epoch||destination().getItem(WALLET_LIBRARY_KEY)!==initialRaw)throw new Error('The wallet library changed or was locked. Unlock again after reloading.')
    opened.forEach(value=>keys.set(value.id,value.key));set({unlockedIds:[...keys.keys()]})
   }catch{throw fail(new Error('Could not unlock every selected wallet. Check the passphrase; no additional wallets were unlocked.'))}finally{operation=false;set({busy:false})}},
   lockAll:()=>{epoch++;keys.clear();set({unlockedIds:[]})},
   lockWallets:values=>{epoch++;values.forEach(id=>keys.delete(id));set({unlockedIds:[...keys.keys()]})},
   selectWallet:id=>{if(id!==null&&!record.wallets.some(value=>value.id===id))throw new Error('Choose a wallet from this library.');set({activeId:id})},
   getKeypair:id=>{if(get().storageUnavailable)return null;try{if(destination().getItem(WALLET_LIBRARY_KEY)!==raw){epoch++;keys.clear();return null}}catch{epoch++;keys.clear();return null}return keys.get(id)||null},
   getActiveWallet:()=>get().wallets.find(value=>value.id===get().activeId)||null,
   createGroup:(name,values=[])=>mutate(async()=>{if(record.groups.length>=50)throw new Error('The library supports at most 50 named groups.');const chosen=values.length?ids(values):[],now=new Date().toISOString(),group={id:crypto.randomUUID(),name:libraryName(name),walletIds:chosen,createdAt:now,updatedAt:now};persist({...record,groups:[...record.groups,group]});return structuredClone(group)}),
   updateGroup:(id,patch)=>mutate(async()=>{if(!record.groups.some(value=>value.id===id))throw new Error('This group no longer exists.');const chosen=patch.walletIds===undefined?undefined:patch.walletIds.length?ids(patch.walletIds):[];persist({...record,groups:record.groups.map(value=>value.id===id?{...value,...(patch.name!==undefined?{name:libraryName(patch.name)}:{}),...(chosen?{walletIds:chosen}:{}),updatedAt:new Date().toISOString()}:value)})}),
   removeGroup:id=>mutate(async()=>{if(!record.groups.some(value=>value.id===id))throw new Error('This group no longer exists.');persist({...record,groups:record.groups.filter(value=>value.id!==id)})}),
   renameWallet:(id,name)=>mutate(async()=>{if(!record.wallets.some(value=>value.id===id))throw new Error('This wallet no longer exists.');persist({...record,wallets:record.wallets.map(value=>value.id===id?{...value,name:libraryName(name)}:value)})}),
   exportWallets:values=>{const chosen=ids(values,MAX_WALLET_BATCH);return JSON.stringify({version:1,warning:'Private wallet backup. Anyone with this file can spend these wallets. Keep it offline and private.',wallets:chosen.map(id=>{const value=record.wallets.find(value=>value.id===id)!,key=get().getKeypair(id);if(!key)throw new Error('Unlock every selected wallet before exporting its private backup.');return {name:value.name,publicKey:value.publicKey,secretKey:Array.from(key.secretKey)}})},null,2)},
  }
 })
 if(options.listen!==false&&typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('storage',event=>{if(event.key!==null&&event.key!==WALLET_LIBRARY_KEY)return;if(event.key===WALLET_LIBRARY_KEY&&event.newValue===raw)return;store.getState().lockAll();void store.getState().reload().catch(()=>{})})
 }
 return store
}
export const useWalletLibraryStore=createWalletLibraryStore()
