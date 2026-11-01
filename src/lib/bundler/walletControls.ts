import {Keypair,PublicKey} from '@solana/web3.js'
import type {WalletSummary} from '@/lib/walletLibrary/types'
import {validatePrivateKey} from './api'
import {RELAY_ROUTES_KEY,readRelayRoutes} from '@/lib/relay/routes'
import type {WalletOperationStorage} from '@/lib/walletOperations/history'
import type {RelayRoute} from '@/lib/relay/types'

export interface BundleControlLibrary {revision:number;storageUnavailable:boolean;wallets:WalletSummary[];groups:{id:string;walletIds:string[]}[];unlockedIds?:string[];getKeypair:(id:string)=>Keypair|null}
export interface BundleControlConfig {
 creatorPublicKey:string|null;creatorPrivateKey:string;managedGroupId?:string;managedCreatorWalletId?:string;isExecuting?:boolean
 bundleWallets:{id:number;publicKey:string|null;privateKey:string;libraryWalletId?:string;isValid:boolean;buyAmount:number;transferTo?:string}[]
 result?:{mintAddress?:string;submissions?:{payer:string}[];tokenTransfers?:{payer:string;recipient:string}[];creatorFeeRouting?:{payer:string}}|null
}
export interface LaunchControlConfig {usePlatformWallet:boolean;isLoading?:boolean;bundleSettings:{groupId?:string|null;wallets:{walletId:string;publicKey:string;name:string;transferTo?:string}[]};getMintKeypair?:()=>{publicKey:PublicKey}|null;receipt?:{mint:string;creatorFeeRouting?:{payer:string};bundleExecution?:{transfers?:{payer:string;recipient:string}[]}}|null}
export interface PlatformControlWallet {getSelectedAddress:()=>string|null;getKeypair:()=>Keypair|null}
export interface WalletControlScope {
 wallets:WalletSummary[];revision:string;roles:Record<string,'creator'|'buyer'|'recipient'>;readOnlyIds:string[]
 resolveWallet:(id:string)=>WalletSummary|null;getKeypair:(id:string)=>Keypair|null;assertCurrent:()=>void
}
export interface WalletControlScopeOptions {recipientIds?:readonly string[]}
export function bundleWalletRecipientIds(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))||new Set(value).size!==value.length)throw new Error('The bundle recipient selection cannot be read. Preserve this browser’s data.')
 return value
}
const recipientStorageKey=(context:string)=>`outsol-bundle-recipients-v1:${context}`
const routeStorageKey=(context:string)=>`outsol-bundle-routes-v1:${context}`
const routeAddressPrefix='bundle-address-'
function storedRecipients(context:string,storage:WalletOperationStorage):string[]{const raw=storage.getItem(recipientStorageKey(context));if(raw!==null&&raw.length>15000)throw new Error('Saved bundle recipients cannot be read.');return raw===null?[]:bundleWalletRecipientIds(JSON.parse(raw))}
function routeRows(raw:string|null):RelayRoute[]{return readRelayRoutes({getItem:()=>raw,setItem:()=>{throw new Error('Read only')},removeItem:()=>{throw new Error('Read only')}})}
function canonicalRoutes(rows:RelayRoute[],wallets:WalletSummary[]):RelayRoute[]{
 const canonical=(id:string)=>{if(id.startsWith(routeAddressPrefix)){const publicKey=address(id.slice(routeAddressPrefix.length));if(publicKey)return`${routeAddressPrefix}${publicKey}`;throw new Error('A saved Relay wallet address is invalid.')}
  const wallet=wallets.find(row=>row.id===id);if(!wallet||!address(wallet.publicKey))throw new Error('A saved Relay wallet is unavailable. Preserve browser data before continuing.');return`${routeAddressPrefix}${wallet.publicKey}`}
 return rows.map(row=>({...row,sourceWalletId:canonical(row.sourceWalletId),destinationWalletId:canonical(row.destinationWalletId)}))
}
export function launchWalletControlMint(launch:LaunchControlConfig):string|null{const mint=address(launch.receipt?.mint),current=launch.getMintKeypair?.()?.publicKey.toBase58();return mint&&(!current||current===mint)?mint:null}
/** Bind public recipient selections to a mint only while the exact configured
 * actor context is available. Cold reads never search other actor contexts. */
export function prepareBundleWalletControlStorage(mode:'standalone'|'launch',mint:string|null|undefined,readScope:(ids?:readonly string[])=>WalletControlScope,storage:WalletOperationStorage,options:{groupId?:string|null}={}):{context:string;ids:string[]}{
 const base=readScope(),actorContext=`${mode}:${base.wallets.filter(wallet=>base.roles[wallet.id]!=='recipient').map(wallet=>`${base.roles[wallet.id]}-${wallet.publicKey}`).sort().join(',')||'empty'}`,validMint=address(mint),groupId=options.groupId&&/^[A-Za-z0-9_-]{1,100}$/.test(options.groupId)?options.groupId:null,groupContext=groupId?`${mode}:group-${groupId}`:actorContext,context=validMint?`bundle:mint-${validMint}`:groupContext
 const migrate=(source:string,target:string)=>{
  if(source===target)return
  const markerKey=`outsol-bundle-bound-v1:${target}`,marker=storage.getItem(markerKey);if(marker!==null){if(marker.length>20000||! /^(standalone|launch):/.test(marker))throw new Error('Saved bundle context cannot be read.');return}
  const sourceIds=storedRecipients(source,storage),targetIds=storedRecipients(target,storage),sourceRaw=storage.getItem(routeStorageKey(source)),targetRaw=storage.getItem(routeStorageKey(target))
  if(!sourceIds.length&&sourceRaw===null)return
  const ids=bundleWalletRecipientIds([...new Set([...targetIds,...sourceIds])]),scope=readScope(ids),routes=canonicalRoutes(routeRows(targetRaw),scope.wallets),sourceRoutes=canonicalRoutes(routeRows(sourceRaw),scope.wallets)
  for(const row of sourceRoutes){const previous=routes.find(value=>value.id===row.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new Error('Saved bundle routes conflict. Preserve browser data before continuing.');if(!previous)routes.push(row)}
  const encodedIds=JSON.stringify(ids),encodedRoutes=JSON.stringify(routeRows(JSON.stringify(routes)))
  storage.setItem(recipientStorageKey(target),encodedIds);if(storage.getItem(recipientStorageKey(target))!==encodedIds)throw new Error('Bundle recipient storage could not be saved.')
  storage.setItem(routeStorageKey(target),encodedRoutes);if(storage.getItem(routeStorageKey(target))!==encodedRoutes)throw new Error('Bundle route storage could not be saved.')
  storage.setItem(markerKey,source);if(storage.getItem(markerKey)!==source)throw new Error('Bundle context storage could not be saved.')
 }
 migrate(actorContext,groupContext);migrate(groupContext,context)
 return{context,ids:storedRecipients(context,storage)}
}
/** Routes use public addresses on disk, then resolve only against this scope.
 * Restored library IDs can change without changing a route's ownership. */
export function bundleWalletRouteStorage(context:string,scope:WalletControlScope,storage:WalletOperationStorage):WalletOperationStorage{
 const guard=(key:string)=>{if(key!==RELAY_ROUTES_KEY)throw new Error('Only public bundle routes use this storage.')}
 return{
  getItem:key=>{guard(key);const raw=storage.getItem(routeStorageKey(context));if(raw===null)return null;const resolve=(id:string)=>id.startsWith(routeAddressPrefix)?scope.wallets.find(wallet=>wallet.publicKey===id.slice(routeAddressPrefix.length))?.id??id:id;return JSON.stringify(routeRows(raw).map(row=>({...row,sourceWalletId:resolve(row.sourceWalletId),destinationWalletId:resolve(row.destinationWalletId)})))},
  setItem:(key,value)=>{guard(key);storage.setItem(routeStorageKey(context),JSON.stringify(canonicalRoutes(routeRows(value),scope.wallets)))},
  removeItem:key=>{guard(key);storage.removeItem(routeStorageKey(context))},
 }
}
interface Row {wallet:WalletSummary;role:'creator'|'buyer'|'recipient';managedId?:string;readOnly?:boolean;manual?:()=>string;platform?:()=>Keypair|null}
interface Projection {rows:Row[];revision:string;busy:boolean}
const createdAt='1970-01-01T00:00:00.000Z'
function address(value:unknown):string|null{try{if(typeof value!=='string')return null;const key=new PublicKey(value);return key.toBase58()===value&&PublicKey.isOnCurve(key.toBytes())?value:null}catch{return null}}
function fromManual(value:string,expected:string):Keypair|null{try{const key=validatePrivateKey(value).keypair;return key?.publicKey.toBase58()===expected?key:null}catch{return null}}
function fingerprint(rows:Row[],library:BundleControlLibrary,busy:boolean,context:unknown):string{return JSON.stringify({context,busy,libraryRevision:library.revision,storageUnavailable:library.storageUnavailable,rows:rows.map(row=>({id:row.wallet.id,address:row.wallet.publicKey,name:row.wallet.name,role:row.role,managed:row.managedId??null,readOnly:!!row.readOnly,unlocked:row.managedId?(library.unlockedIds??[]).includes(row.managedId):!row.readOnly}))})}
function append(rows:Row[],row:Row):void{if(rows.some(value=>value.wallet.publicKey===row.wallet.publicKey))return;if(rows.some(value=>value.wallet.id===row.wallet.id))throw new Error('Bundle wallet identities conflict. Review the selected wallets.');rows.push(row)}
function recipient(rows:Row[],destination:unknown,library:BundleControlLibrary){const value=address(destination);if(!value)return;const wallet=library.wallets.find(item=>item.publicKey===value);append(rows,wallet?{wallet:{...wallet},role:'recipient',managedId:wallet.id}:{wallet:{id:`bundle-recipient-${value}`,name:'External recipient',publicKey:value,createdAt},role:'recipient',readOnly:true})}
function extras(rows:Row[],library:BundleControlLibrary,options:WalletControlScopeOptions){for(const id of [...new Set(options.recipientIds??[])].slice(0,100)){const wallet=library.wallets.find(value=>value.id===id);if(wallet&&address(wallet.publicKey))append(rows,{wallet:{...wallet},role:'recipient',managedId:id})}}
function historicalActor(rows:Row[],value:unknown,role:Row['role'],library:BundleControlLibrary){
 const publicKey=address(value);if(!publicKey)return
 const managed=library.wallets.find(wallet=>wallet.publicKey===publicKey),existing=rows.find(row=>row.wallet.publicKey===publicKey)
 if(existing){if(managed&&(existing.readOnly||existing.manual&&!existing.manual())){existing.wallet={...managed};existing.managedId=managed.id;existing.readOnly=false;existing.manual=undefined}return}
 append(rows,managed?{wallet:{...managed},role,managedId:managed.id}:{wallet:{id:`bundle-${role}-${publicKey}`,name:role==='creator'?'Recorded creator':role==='buyer'?'Recorded buyer':'External recipient',publicKey,createdAt},role,readOnly:true})
}
function scope(project:()=>Projection,readLibrary:()=>BundleControlLibrary):WalletControlScope{
 const initial=project(),expected=new Map<string,Keypair>(),assertCurrent=()=>{if(project().revision!==initial.revision)throw new Error('The bundle wallets, recipient or unlock state changed. Review the operation again.');if(initial.busy)throw new Error('Finish the bundle launch before using wallet controls.')}
 const resolveWallet=(id:string)=>{try{assertCurrent();const row=initial.rows.find(value=>value.wallet.id===id);return row?{...row.wallet}:null}catch{return null}}
 const getKeypair=(id:string)=>{
  try{
   assertCurrent();const row=initial.rows.find(value=>value.wallet.id===id),library=readLibrary();if(!row||row.readOnly||library.storageUnavailable)return null
   const current=row.managedId?library.getKeypair(row.managedId):row.platform?row.platform():row.manual?fromManual(row.manual(),row.wallet.publicKey):null
   if(!current||current.publicKey.toBase58()!==row.wallet.publicKey)return null
   const previous=expected.get(id)
   if(previous){if(row.managedId){if(previous!==current)return null}else if(!Buffer.from(previous.secretKey).equals(Buffer.from(current.secretKey)))return null;return previous}
   expected.set(id,current);return current
  }catch{return null}
 }
 return {wallets:initial.rows.map(row=>({...row.wallet})),revision:initial.revision,roles:Object.fromEntries(initial.rows.map(row=>[row.wallet.id,row.role])),readOnlyIds:initial.rows.filter(row=>row.readOnly).map(row=>row.wallet.id),resolveWallet,getKeypair,assertCurrent}
}

/** Public projection only. Private session material stays in its original store
 * and is decoded only when a caller explicitly resolves a live signer. */
export function createBundleWalletControlScope(readBundle:()=>BundleControlConfig,readLibrary:()=>BundleControlLibrary,options:WalletControlScopeOptions={}):WalletControlScope{
 const project=():Projection=>{
  const config=readBundle(),library=readLibrary(),rows:Row[]=[],creator=address(config.creatorPublicKey),group=config.managedGroupId?library.groups.find(row=>row.id===config.managedGroupId):undefined
  if(creator){const managed=config.managedGroupId&&config.managedCreatorWalletId?library.wallets.find(row=>row.id===config.managedCreatorWalletId&&row.publicKey===creator&&group?.walletIds.includes(row.id)):undefined
   append(rows,managed?{wallet:{...managed},role:'creator',managedId:managed.id}:{wallet:{id:`bundle-creator-${creator}`,name:'Creator wallet',publicKey:creator,createdAt},role:'creator',...(config.managedGroupId?{readOnly:true}:{manual:()=>readBundle().creatorPrivateKey})})}
  for(const buyer of config.bundleWallets){const value=address(buyer.publicKey);if(!value||!buyer.isValid)continue
   const managed=config.managedGroupId&&buyer.libraryWalletId?library.wallets.find(row=>row.id===buyer.libraryWalletId&&row.publicKey===value&&group?.walletIds.includes(row.id)):undefined
   append(rows,managed?{wallet:{...managed},role:'buyer',managedId:managed.id}:{wallet:{id:`bundle-buyer-${buyer.id}-${value}`,name:`Buyer ${buyer.id+1}`,publicKey:value,createdAt},role:'buyer',...(config.managedGroupId?{readOnly:true}:{manual:()=>readBundle().bundleWallets.find(row=>row.id===buyer.id&&row.publicKey===value)?.privateKey??''})})
  }
  for(const buyer of config.bundleWallets)recipient(rows,buyer.transferTo,library)
  const actors=[...new Set((config.result?.submissions??[]).slice(0,100).map(row=>row.payer))]
  if(!actors.length&&config.result?.creatorFeeRouting?.payer)actors.push(config.result.creatorFeeRouting.payer)
  actors.forEach((value,index)=>historicalActor(rows,value,index===0?'creator':'buyer',library))
  for(const transfer of (config.result?.tokenTransfers??[]).slice(0,16)){historicalActor(rows,transfer.payer,'buyer',library);historicalActor(rows,transfer.recipient,'recipient',library)}
  extras(rows,library,options)
  return {rows,revision:fingerprint(rows,library,!!config.isExecuting,{groupId:config.managedGroupId??null,creatorId:config.managedCreatorWalletId??null,groupMembers:group?.walletIds??[]}),busy:!!config.isExecuting}
 }
 return scope(project,readLibrary)
}

export function createLaunchWalletControlScope(readLaunch:()=>LaunchControlConfig,readLibrary:()=>BundleControlLibrary,readPlatform:()=>PlatformControlWallet,readExternalAddress:()=>string|null=()=>null,options:WalletControlScopeOptions={}):WalletControlScope{
 const project=():Projection=>{
  const launch=readLaunch(),library=readLibrary(),rows:Row[]=[],creator=address(launch.usePlatformWallet?readPlatform().getSelectedAddress():readExternalAddress())
  if(creator){const managed=launch.usePlatformWallet?library.wallets.find(row=>row.publicKey===creator):undefined
   append(rows,managed?{wallet:{...managed},role:'creator',managedId:managed.id}:{wallet:{id:`bundle-creator-${creator}`,name:launch.usePlatformWallet?'Creator wallet':'Connected creator',publicKey:creator,createdAt},role:'creator',...(launch.usePlatformWallet?{platform:()=>readPlatform().getKeypair()}:{readOnly:true})})}
  for(const buyer of launch.bundleSettings.wallets){const value=address(buyer.publicKey);if(!value)continue;const managed=library.wallets.find(row=>row.id===buyer.walletId&&row.publicKey===value)
   append(rows,managed?{wallet:{...managed},role:'buyer',managedId:managed.id}:{wallet:{id:buyer.walletId,name:buyer.name||'Buyer wallet',publicKey:value,createdAt},role:'buyer',readOnly:true})}
  for(const buyer of launch.bundleSettings.wallets)recipient(rows,buyer.transferTo,library)
  const currentMint=launch.getMintKeypair?.()?.publicKey.toBase58(),receipt=launch.receipt&&(!currentMint||launch.receipt.mint===currentMint)?launch.receipt:null
  if(receipt){historicalActor(rows,receipt.creatorFeeRouting?.payer,'creator',library);for(const transfer of (receipt.bundleExecution?.transfers??[]).slice(0,16)){historicalActor(rows,transfer.payer,'buyer',library);historicalActor(rows,transfer.recipient,'recipient',library)}}
  extras(rows,library,options)
  return {rows,revision:fingerprint(rows,library,!!launch.isLoading,{usePlatformWallet:launch.usePlatformWallet,mint:currentMint??null,receiptMint:receipt?.mint??null}),busy:!!launch.isLoading}
 }
 return scope(project,readLibrary)
}
