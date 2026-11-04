import type {BundleWallet,BundleResult} from '@/lib/bundler/types'
import {parseLaunchBundleSettings,type LaunchBundleSettings} from '@/lib/launchBundle/types'
import {sniperPairAddress,sniperPairId,validateSniperPairs,type SniperPair} from './catalog'

export type SniperSessionMode='standalone'|'launch'
export const DEFAULT_SNIPER_SESSION_NAME='My sniper session'
export const sniperSessionSelectionKey=(mode:SniperSessionMode)=>`outsol-sniper-session-selection-v1:${mode}`
export const sniperSessionProfileKey=(mode:SniperSessionMode)=>`outsol-sniper-session-profile-v1:${mode}`
interface SessionStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
interface BundleSnapshot {isExecuting:boolean;result:Pick<BundleResult,'status'|'createSignature'|'bundleId'|'submittedSignatures'>|null;bundleWallets:readonly BundleWallet[];creatorPublicKey?:string|null;managedGroupId?:string;managedCreatorWalletId?:string}
interface LaunchSnapshot {isLoading:boolean;receipt?:unknown;transactionSignature?:string|null;bundleSettings:LaunchBundleSettings;usePlatformWallet?:boolean}
export interface SniperSessionLifecyclePorts {
 storage:SessionStorage
 readPairs():readonly SniperPair[]
 readBundle():BundleSnapshot
 readLaunch():LaunchSnapshot
 assertAvailable():void
 commitStandalone(patch:{bundleWallets:BundleWallet[];statusMessage:string}):void
 commitInline(patch:{bundleSettings:LaunchBundleSettings}):void
}
function ids(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>16)throw new Error('The saved session selection cannot be read. Preserve browser data.')
 const result=value.map(sniperPairId)
 if(new Set(result).size!==result.length)throw new Error('The saved session contains duplicate pairs.')
 return result
}
export interface SniperSessionPublicProfile {version:1;name:string;deployerAddress:string}
function profile(raw:string|null):SniperSessionPublicProfile|null{
 if(raw===null)return null
 if(raw.length>2000)throw new Error('The saved session profile cannot be read.')
 const row:unknown=JSON.parse(raw)
 if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==3||Object.keys(row).some(key=>!['version','name','deployerAddress'].includes(key)))throw new Error('Only public session profile fields can be cleared here.')
 const value=row as {version:unknown;name:unknown;deployerAddress:unknown}
 if(value.version!==1||typeof value.name!=='string'||value.name.length>60||/[\u0000-\u001f\u007f]/.test(value.name)||typeof value.deployerAddress!=='string')throw new Error('The saved session profile cannot be read.')
 if(value.deployerAddress)sniperPairAddress(value.deployerAddress)
 return {version:1,name:value.name,deployerAddress:value.deployerAddress}
}
/** A corrupt profile must never be converted into defaults and written back. */
export function readSniperSessionPublicState(storage:Pick<SessionStorage,'getItem'>,mode:SniperSessionMode):{selection:string[];profile:SniperSessionPublicProfile|null}{
 const selection=storage.getItem(sniperSessionSelectionKey(mode)),savedProfile=storage.getItem(sniperSessionProfileKey(mode))
 if(selection!==null&&selection.length>10000)throw new Error('The saved session selection cannot be read. Preserve browser data.')
 return {selection:ids(selection===null?[]:JSON.parse(selection)),profile:profile(savedProfile)}
}
function assertIdle(mode:SniperSessionMode,bundle:BundleSnapshot,launch:LaunchSnapshot):void{
 if(bundle.isExecuting||launch.isLoading)throw new Error('Finish or cancel the running launch before removing its session.')
 if(bundle.result?.status==='unknown'||bundle.result?.submittedSignatures?.length&&!['confirmed','failed','partial'].includes(bundle.result.status??'')||launch.transactionSignature&&!launch.receipt)throw new Error('An original transaction needs confirmation. Check Activity before changing the session.')
 if(mode==='standalone'&&(bundle.result?.createSignature||bundle.result?.bundleId)||mode==='launch'&&(launch.receipt||launch.transactionSignature))throw new Error('This launch already has execution evidence. Start a new launch to use another session.')
}
const bundleIdentity=(value:BundleSnapshot)=>JSON.stringify({isExecuting:value.isExecuting,result:value.result,creator:value.creatorPublicKey,group:value.managedGroupId,creatorId:value.managedCreatorWalletId,wallets:value.bundleWallets})
const launchIdentity=(value:LaunchSnapshot)=>JSON.stringify({isLoading:value.isLoading,receipt:value.receipt,signature:value.transactionSignature,platform:value.usePlatformWallet,bundleSettings:value.bundleSettings})
function emptyBuyer(id:number):BundleWallet{
 return{id,privateKey:'',publicKey:null,balance:null,buyAmount:0,mode:'sniper',delaySeconds:5,isValid:false,sellEnabled:false,sellPercent:100,sellTriggerType:'time',sellDelaySeconds:60,sellProfitMultiplier:2}
}
async function defaultPorts():Promise<SniperSessionLifecyclePorts>{
 const [{useSniperPairStore},{useBundlerStore},{useLaunchStore},{assertNoPendingWalletOperation},{assertNoPendingGroupOperation},{assertNoPendingBundleReceipt},{readPending},{readTradePending}]=await Promise.all([
  import('@/stores/sniperPairStore'),import('@/stores/bundlerStore'),import('@/stores/launchStore'),import('@/lib/walletOperations/history'),import('@/lib/walletGroups/history'),import('@/lib/bundler/pending'),import('@/lib/launchHistory'),import('@/lib/venues/tradeHistory'),
 ])
 if(typeof localStorage==='undefined')throw new Error('Browser session storage is unavailable.')
 useSniperPairStore.getState().hydrate()
 return{
  storage:localStorage,
  readPairs:()=>{const current=useSniperPairStore.getState();if(!current.hydrated||current.storageUnavailable)throw new Error('The reusable pair catalog is unavailable. Preserve browser data.');return current.pairs},
  readBundle:useBundlerStore.getState,readLaunch:useLaunchStore.getState,
  assertAvailable:()=>{assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt();if(readPending()||readTradePending())throw new Error('A launch or trade is pending. Check its original signature in Activity before removing the session.')},
  commitStandalone:patch=>useBundlerStore.setState(patch),commitInline:patch=>useLaunchStore.setState(patch),
 }
}
/** Clear only public session references. Wallet encryption, reusable pair
 * records, saved plans, groups and original transaction histories are untouched. */
export async function clearSniperSession(mode:SniperSessionMode,expectedPairIds:readonly string[],options:{locked?:boolean;ports?:SniperSessionLifecyclePorts;isCurrent?:()=>boolean}={}):Promise<{detachedBuyers:number}>{
 if(mode!=='standalone'&&mode!=='launch')throw new Error('Choose a supported sniper session view.')
 if(options.locked)throw new Error('This receipt fixes its original sniper pairs. Start a new launch to use another session.')
 const assertView=()=>{if(options.isCurrent&&!options.isCurrent())throw new Error('The session view closed or changed. Nothing further was removed.')}
 assertView()
 const expected=ids(expectedPairIds),ports=options.ports??await defaultPorts(),disk=ports.storage,selectionKey=sniperSessionSelectionKey(mode),profileKey=sniperSessionProfileKey(mode)
 assertView()
 ports.assertAvailable()
 const selectionBefore=disk.getItem(selectionKey),profileBefore=disk.getItem(profileKey)
 if(selectionBefore!==null&&selectionBefore.length>10000)throw new Error('The saved session selection cannot be read.')
 if(JSON.stringify(ids(selectionBefore===null?[]:JSON.parse(selectionBefore)))!==JSON.stringify(expected))throw new Error('The selected session changed. Reload it before removing it.')
 profile(profileBefore)
 const catalog=validateSniperPairs(ports.readPairs()),selected=expected.map(id=>{const row=catalog.find(pair=>pair.id===id);if(!row)throw new Error('A selected pair is missing. Preserve your backup and review the session.');return row}),pairsBefore=JSON.stringify(catalog)
 const bundle=ports.readBundle(),launch=ports.readLaunch(),bundleBefore=bundleIdentity(bundle),launchBefore=launchIdentity(launch)
 assertIdle(mode,bundle,launch)
 const matches=(source:string|null,receiver:string|undefined)=>selected.some(pair=>pair.sniperAddress===source&&pair.receiverAddress===receiver)
 let detachedBuyers=0,standalonePatch:{bundleWallets:BundleWallet[];statusMessage:string}|undefined,inlinePatch:{bundleSettings:LaunchBundleSettings}|undefined
 if(mode==='standalone'){
  if(bundle.bundleWallets.length>16||new Set(bundle.bundleWallets.map(row=>row.id)).size!==bundle.bundleWallets.length||bundle.bundleWallets.some(row=>!Number.isInteger(row.id)||row.id<1||row.id>16))throw new Error('The current buyer slots cannot be changed safely. Review the launch.')
  const wallets=bundle.bundleWallets.map(row=>{if(!matches(row.publicKey,row.transferTo))return{...row};if(row.privateKey)throw new Error('Back up and remove the matching manual key explicitly before clearing this managed session.');detachedBuyers++;return emptyBuyer(row.id)})
  if(detachedBuyers)standalonePatch={bundleWallets:wallets,statusMessage:'Sniper session removed from this launch. Its wallets and reusable pairs are still saved.'}
 }else{
  const settings=parseLaunchBundleSettings(launch.bundleSettings),wallets=settings.wallets.filter(row=>!matches(row.publicKey,row.transferTo));detachedBuyers=settings.wallets.length-wallets.length
  if(detachedBuyers){const next={...settings,wallets,groupId:wallets.length?settings.groupId:null};delete next.stagedPlanId;inlinePatch={bundleSettings:next}}
 }
 const selectionAfter='[]',profileAfter=JSON.stringify({version:1,name:DEFAULT_SNIPER_SESSION_NAME,deployerAddress:''})
 const assertCurrent=(selection:string|null,savedProfile:string|null)=>{
  assertView()
  if(disk.getItem(selectionKey)!==selection||disk.getItem(profileKey)!==savedProfile)throw new Error('The public session changed in another tab. Its current data was preserved.')
  ports.assertAvailable();assertIdle(mode,ports.readBundle(),ports.readLaunch())
  if(JSON.stringify(validateSniperPairs(ports.readPairs()))!==pairsBefore||bundleIdentity(ports.readBundle())!==bundleBefore||launchIdentity(ports.readLaunch())!==launchBefore)throw new Error('The pair catalog or launch configuration changed. Review the session again.')
 }
 const attempted=new Set<string>()
 const rollback=(key:string,before:string|null,after:string):boolean=>{
  if(!attempted.has(key))return true
  try{const current=disk.getItem(key);if(current!==after)return true;if(before===null)disk.removeItem(key);else disk.setItem(key,before);return disk.getItem(key)===before}catch{return false}
 }
 try{
  assertCurrent(selectionBefore,profileBefore)
  attempted.add(selectionKey);disk.setItem(selectionKey,selectionAfter)
  if(disk.getItem(selectionKey)!==selectionAfter)throw new Error('The cleared session selection could not be saved.')
  assertCurrent(selectionAfter,profileBefore)
  attempted.add(profileKey);disk.setItem(profileKey,profileAfter)
  if(disk.getItem(profileKey)!==profileAfter)throw new Error('The cleared session profile could not be saved.')
  assertCurrent(selectionAfter,profileAfter)
  if(standalonePatch)ports.commitStandalone(standalonePatch)
  if(inlinePatch)ports.commitInline(inlinePatch)
  return{detachedBuyers}
 }catch(reason){
  const restoredProfile=rollback(profileKey,profileBefore,profileAfter),restoredSelection=rollback(selectionKey,selectionBefore,selectionAfter),message=reason instanceof Error?reason.message:'The session could not be removed.'
  throw new Error(`${message}${restoredProfile&&restoredSelection?'':' Public session recovery could not be fully restored. Preserve browser data and review the saved selection before continuing.'}`)
 }
}
