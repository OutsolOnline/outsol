import {PublicKey} from '@solana/web3.js'
import type {WalletVault} from '../walletVault'
import {MAX_GROUP_WALLETS,MAX_LIBRARY_WALLETS,WALLET_LIBRARY_KEY,type WalletLibraryRecord,type WalletLibraryStorage,type StoredLibraryWallet,type WalletLibraryGroup,type WalletSummary} from './types'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function libraryId(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw new Error('Invalid wallet library identifier.');return value}
export function libraryName(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.trim().length>60||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Use a name between one and 60 characters.');return value.trim()}
function address(value:unknown):string{if(typeof value!=='string'||value.length>44)throw new Error('Invalid wallet address.');const key=new PublicKey(value);if(key.toBase58()!==value||!PublicKey.isOnCurve(key.toBytes()))throw new Error('Invalid wallet address.');return value}
function date(value:unknown):string{if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw new Error('Invalid library date.');return new Date(value).toISOString()}
export function safeWalletVault(value:unknown):WalletVault{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid encrypted wallet.')
 const item=value as WalletVault
 const decode=(value:unknown,max:number,length?:number)=>{if(typeof value!=='string'||value.length>max||!value||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error('Invalid encrypted wallet.');const decoded=atob(value);if(length!==undefined&&decoded.length!==length)throw new Error('Invalid encrypted wallet.');return value}
 if(item.version!==1||item.iterations!==600000)throw new Error('Unsupported encrypted wallet.')
 return {version:1,publicKey:address(item.publicKey),iterations:600000,salt:decode(item.salt,64,16),iv:decode(item.iv,64,12),ciphertext:decode(item.ciphertext,4096)}
}
export function publicWalletSummary(value:StoredLibraryWallet):WalletSummary{return {id:value.id,name:value.name,publicKey:value.publicKey,createdAt:value.createdAt}}
export function emptyWalletLibrary():WalletLibraryRecord{return {version:1,revision:0,wallets:[],groups:[],legacyImported:false}}
export function safeWalletLibrary(value:unknown):WalletLibraryRecord{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid wallet library.')
 const item=value as WalletLibraryRecord
 if(item.version!==1||!Number.isSafeInteger(item.revision)||item.revision<0||typeof item.legacyImported!=='boolean'||!Array.isArray(item.wallets)||item.wallets.length>MAX_LIBRARY_WALLETS||!Array.isArray(item.groups)||item.groups.length>50)throw new Error('Invalid wallet library.')
 const wallets:StoredLibraryWallet[]=item.wallets.map(value=>{
  if(!value||Object.keys(value).some(key=>!['id','name','publicKey','createdAt','vault'].includes(key)))throw new Error('Invalid encrypted wallet record.')
  const vault=safeWalletVault(value.vault),publicKey=address(value.publicKey)
  if(publicKey!==vault.publicKey)throw new Error('The encrypted wallet address changed.')
  return {id:libraryId(value.id),name:libraryName(value.name),publicKey,createdAt:date(value.createdAt),vault}
 })
 if(new Set(wallets.map(value=>value.id)).size!==wallets.length||new Set(wallets.map(value=>value.publicKey)).size!==wallets.length)throw new Error('Duplicate wallet records.')
 const walletIds=new Set(wallets.map(value=>value.id))
 const groups:WalletLibraryGroup[]=item.groups.map(value=>{
  if(!value||!Array.isArray(value.walletIds)||value.walletIds.length>MAX_GROUP_WALLETS)throw new Error('Groups support up to 20 managed wallets.')
  const ids=value.walletIds.map(libraryId)
  if(new Set(ids).size!==ids.length||ids.some(id=>!walletIds.has(id)))throw new Error('A group contains missing or duplicate wallets.')
  return {id:libraryId(value.id),name:libraryName(value.name),walletIds:ids,createdAt:date(value.createdAt),updatedAt:date(value.updatedAt)}
 })
 if(new Set(groups.map(value=>value.id)).size!==groups.length)throw new Error('Duplicate wallet groups.')
 return {version:1,revision:item.revision,wallets,groups,legacyImported:item.legacyImported}
}
export function readWalletLibrary(storage:WalletLibraryStorage):{raw:string|null;record:WalletLibraryRecord}{
 try{const raw=storage.getItem(WALLET_LIBRARY_KEY);if(raw===null)return {raw,record:emptyWalletLibrary()};if(raw.length>700000)throw new Error();return {raw,record:safeWalletLibrary(JSON.parse(raw))}}
 catch{throw new Error('Wallet library storage cannot be read. Preserve this browser’s data and restore a backup before making changes.')}
}
export function commitWalletLibrary(storage:WalletLibraryStorage,expectedRaw:string|null,input:WalletLibraryRecord):{raw:string;record:WalletLibraryRecord}{
 if(storage.getItem(WALLET_LIBRARY_KEY)!==expectedRaw)throw new Error('The wallet library changed in another tab. Reload it before making changes.')
 const record=safeWalletLibrary(input),raw=JSON.stringify(record)
 storage.setItem(WALLET_LIBRARY_KEY,raw)
 if(storage.getItem(WALLET_LIBRARY_KEY)!==raw)throw new Error('The encrypted library could not be verified. Preserve browser data and reload before continuing.')
 return {raw,record}
}
