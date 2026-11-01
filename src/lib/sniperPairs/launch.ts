import type {Keypair} from '@solana/web3.js'
import {PublicKey} from '@solana/web3.js'
import {resolveSniperPairs,type SniperPair,type ResolvedSniperPair} from './catalog'
import {mergeManagedBundleWallets} from '@/lib/bundler/walletSetup'
import type {BundleWallet} from '@/lib/bundler/types'
import type {BundleControlLibrary,WalletControlScope} from '@/lib/bundler/walletControls'
import type {WalletSummary} from '@/lib/walletLibrary/types'
import type {LaunchBundleSettings} from '@/lib/launchBundle/types'

const pairRecord=(pair:SniperPair):SniperPair=>({id:pair.id,name:pair.name,sniperWalletId:pair.sniperWalletId,sniperAddress:pair.sniperAddress,receiverWalletId:pair.receiverWalletId,receiverAddress:pair.receiverAddress,createdAt:pair.createdAt})
function checkedPairs(pairs:readonly ResolvedSniperPair[]):ResolvedSniperPair[]{
 if(pairs.length<1||pairs.length>16)throw new Error('Choose between one and 16 sniper pairs for a launch.')
 for(const pair of pairs)if(pair.sniper.publicKey!==pair.sniperAddress||pair.receiver.publicKey!==pair.receiverAddress)throw new Error('A sniper or receiver wallet changed. Select the pair again.')
 return resolveSniperPairs(pairs.map(pairRecord),pairs.flatMap(pair=>[pair.sniper,pair.receiver]))
}
function assertDeployer(pairs:readonly ResolvedSniperPair[],deployer:WalletSummary|string):void{
 const publicKey=typeof deployer==='string'?deployer:deployer.publicKey
 try{if(new PublicKey(publicKey).toBase58()!==publicKey||!PublicKey.isOnCurve(new PublicKey(publicKey).toBytes()))throw new Error()}catch{throw new Error('Choose a valid separate deployer wallet.')}
 if(pairs.some(pair=>pair.sniper.publicKey===publicKey||pair.receiver.publicKey===publicKey||(typeof deployer!=='string'&&(pair.sniper.id===deployer.id||pair.receiver.id===deployer.id))))throw new Error('The deployer must be separate from every sniper and token receiver.')
}

/** No receiver is ever an additional buyer. A source's identity, rather than
 * its position or old local ID, carries its existing budget and timing. */
export function mapSniperPairsToBundle(previous:readonly BundleWallet[],value:readonly ResolvedSniperPair[],deployer:WalletSummary):BundleWallet[]{
 const pairs=checkedPairs(value);assertDeployer(pairs,deployer)
 const previousByAddress=pairs.flatMap(pair=>{
  const matches=previous.filter(row=>row.publicKey===pair.sniper.publicKey)
  if(matches.length>1)throw new Error('A sniper appears in more than one buyer row. Review the existing launch.')
  return matches.map(row=>({...row,libraryWalletId:pair.sniper.id,privateKey:''}))
 })
 const rows=mergeManagedBundleWallets(previousByAddress,[deployer,...pairs.map(pair=>pair.sniper)],deployer.id)
 return rows.map((row,index)=>pairs[index]?{...row,transferTo:pairs[index].receiver.publicKey,sellEnabled:false}:row)
}
export function mapSniperPairsToLaunch(settings:LaunchBundleSettings,value:readonly ResolvedSniperPair[],groupId:string,deployerAddress?:string|null):LaunchBundleSettings{
 const pairs=checkedPairs(value)
 if(!deployerAddress)throw new Error('Choose a separate deployer wallet before using sniper pairs.')
 assertDeployer(pairs,deployerAddress)
 if(!groupId||groupId.length>100)throw new Error('Choose the source wallet group for these pairs.')
 const wallets=pairs.map(pair=>{
  const matches=settings.wallets.filter(row=>row.publicKey===pair.sniper.publicKey)
  if(matches.length>1)throw new Error('A sniper appears in more than one buyer row. Review the existing launch.')
  const old=matches[0]
  return{walletId:pair.sniper.id,publicKey:pair.sniper.publicKey,name:pair.sniper.name,buySol:old?.buySol??0,delaySeconds:old?.delaySeconds??0,transferTo:pair.receiver.publicKey}
 })
 return{...settings,groupId,wallets}
}

/** The scope exposes only these pairs. Every signer read checks the current
 * public pairing, library revision, unlock state and original Keypair object. */
export function createSniperPairScope(readPairs:()=>readonly SniperPair[],readLibrary:()=>BundleControlLibrary):WalletControlScope{
 const project=()=>{
  const library=readLibrary(),records=readPairs(),pairs=resolveSniperPairs(records,library.wallets),wallets=pairs.flatMap(pair=>[{...pair.sniper},{...pair.receiver}])
  const roles:WalletControlScope['roles']=Object.fromEntries(pairs.flatMap(pair=>[[pair.sniper.id,'buyer'],[pair.receiver.id,'recipient']]))
  const revision=JSON.stringify({pairs:records.map(pairRecord),wallets,libraryRevision:library.revision,unlockedIds:[...(library.unlockedIds??[])].sort(),storageUnavailable:library.storageUnavailable})
  return{wallets,roles,revision,unavailable:library.storageUnavailable}
 }
 const initial=project(),expected=new Map<string,Keypair>()
 const assertCurrent=()=>{const current=project();if(initial.unavailable||current.unavailable)throw new Error('Wallet storage is unavailable. Preserve your wallet backups.');if(current.revision!==initial.revision)throw new Error('The sniper pairs or wallet unlock state changed. Review again.')}
 const resolveWallet=(id:string)=>{try{assertCurrent();const value=initial.wallets.find(wallet=>wallet.id===id);return value?{...value}:null}catch{return null}}
 const getKeypair=(id:string)=>{
  try{assertCurrent();const wallet=initial.wallets.find(value=>value.id===id);if(!wallet)return null
   const key=readLibrary().getKeypair(id);if(!key||key.publicKey.toBase58()!==wallet.publicKey)return null
   const original=expected.get(id);if(original&&original!==key)return null;expected.set(id,key);return key
  }catch{return null}
 }
 return{wallets:initial.wallets.map(wallet=>({...wallet})),roles:{...initial.roles},revision:initial.revision,readOnlyIds:[],assertCurrent,resolveWallet,getKeypair}
}

interface PairBundleConfig {isExecuting:boolean;result?:{createSignature?:string;bundleId?:string}|null;bundleWallets:BundleWallet[];managedGroupId?:string;managedCreatorWalletId?:string;creatorPublicKey:string|null;creatorPrivateKey?:string}
interface PairLaunchConfig {isLoading:boolean;receipt?:unknown;transactionSignature?:string|null;usePlatformWallet:boolean;bundleSettings:LaunchBundleSettings}
export interface SniperPairStandalonePatch {managedGroupId:string;managedCreatorWalletId:string;creatorPublicKey:string;creatorPrivateKey:string;creatorBalance:null;bundleWallets:BundleWallet[];statusMessage:string}
export interface SniperPairInlinePatch {usePlatformWallet:true;bundleSettings:LaunchBundleSettings}
export interface SniperPairApplyPorts {
 ready():Promise<void>;readLibrary():BundleControlLibrary;readPairs():readonly SniperPair[];readBundle():PairBundleConfig;readLaunch():PairLaunchConfig
 platformAddress():string|null;assertAvailable():void;createGroup(name:string,ids:string[]):Promise<{id:string;walletIds:string[]}>;selectDeployer(id:string):void
 commitStandalone(patch:SniperPairStandalonePatch):void;commitInline(patch:SniperPairInlinePatch):void
}
async function defaultPorts():Promise<SniperPairApplyPorts>{
 const [{useWalletLibraryStore},{useSniperPairStore},{useBundlerStore},{useLaunchStore},{usePlatformWalletStore},{assertNoPendingWalletOperation},{assertNoPendingGroupOperation},{assertNoPendingBundleReceipt},{readPending},{readTradePending}]=await Promise.all([
  import('@/stores/walletLibraryStore'),import('@/stores/sniperPairStore'),import('@/stores/bundlerStore'),import('@/stores/launchStore'),import('@/stores/walletStore'),import('@/lib/walletOperations/history'),import('@/lib/walletGroups/history'),import('@/lib/bundler/pending'),import('@/lib/launchHistory'),import('@/lib/venues/tradeHistory'),
 ])
 return{
  ready:async()=>{await useWalletLibraryStore.getState().ready();useSniperPairStore.getState().hydrate()},readLibrary:useWalletLibraryStore.getState,
  readPairs:()=>{const state=useSniperPairStore.getState();if(!state.hydrated||state.storageUnavailable)throw new Error('Saved sniper pairs are unavailable. Preserve browser data.');return state.pairs},
  readBundle:useBundlerStore.getState,readLaunch:useLaunchStore.getState,platformAddress:()=>usePlatformWalletStore.getState().getSelectedAddress(),
  assertAvailable:()=>{assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt();if(readPending()||readTradePending())throw new Error('Check the saved transaction in Activity before changing launch wallets.')},
  createGroup:(name,ids)=>useWalletLibraryStore.getState().createGroup(name,ids),selectDeployer:id=>useWalletLibraryStore.getState().selectWallet(id),
  commitStandalone:patch=>useBundlerStore.setState(patch),commitInline:patch=>useLaunchStore.setState(patch),
 }
}
function bundleFingerprint(value:PairBundleConfig):string{return JSON.stringify({isExecuting:value.isExecuting,result:value.result,groupId:value.managedGroupId,creatorId:value.managedCreatorWalletId,creator:value.creatorPublicKey,wallets:value.bundleWallets.map(({id,publicKey,libraryWalletId,buyAmount,mode,delaySeconds,sellEnabled,transferTo})=>({id,publicKey,libraryWalletId,buyAmount,mode,delaySeconds,sellEnabled,transferTo}))})}
function launchFingerprint(value:PairLaunchConfig):string{return JSON.stringify({isLoading:value.isLoading,receipt:value.receipt,transactionSignature:value.transactionSignature,usePlatformWallet:value.usePlatformWallet,bundleSettings:value.bundleSettings})}

/** Changes public launch references only. Group creation never moves funds or
 * extracts private keys; failed attachment preserves every encrypted wallet. */
export async function applySniperPairsToLaunch(mode:'standalone'|'launch',value:readonly ResolvedSniperPair[],deployerId?:string,providedPorts?:SniperPairApplyPorts):Promise<void>{
 const ports=providedPorts??await defaultPorts();await ports.ready()
 let created=false
 try{
  const originalPairs=value.map(pairRecord),pairIdentity=JSON.stringify(originalPairs),assertPairRecords=()=>{
   const catalog=ports.readPairs(),current=originalPairs.map(pair=>catalog.find(row=>row.id===pair.id))
   if(current.some(pair=>!pair)||JSON.stringify(current.map(pair=>pairRecord(pair!)))!==pairIdentity)throw new Error('A selected sniper pair changed. Choose it again.')
  }
  const assertIdle=()=>{ports.assertAvailable();const bundle=ports.readBundle(),launch=ports.readLaunch();if(bundle.isExecuting||launch.isLoading)throw new Error('Finish the running launch before changing sniper pairs.');if(mode==='standalone'&&(bundle.result?.createSignature||bundle.result?.bundleId)||mode==='launch'&&(launch.receipt||launch.transactionSignature))throw new Error('This launch is completed. Start a new launch to reuse the pairs.');if(mode==='standalone'&&(bundle.creatorPrivateKey||bundle.bundleWallets.some(wallet=>wallet.privateKey)))throw new Error('Export the existing manual wallet backup, then switch to an encrypted group before using sniper pairs.');assertPairRecords()}
  assertIdle()
  const library=ports.readLibrary();if(library.storageUnavailable)throw new Error('The encrypted wallet library is unavailable.')
  const pairs=checkedPairs(resolveSniperPairs(originalPairs,library.wallets))
  const selectedAddress=mode==='launch'&&ports.readLaunch().usePlatformWallet?ports.platformAddress():mode==='standalone'?ports.readBundle().creatorPublicKey:null
  const deployer=library.wallets.find(wallet=>deployerId?wallet.id===deployerId:wallet.publicKey===selectedAddress)
  if(!deployer)throw new Error('Choose a separate deployer from your encrypted wallet library.')
  assertDeployer(pairs,deployer)
  const bundleBefore=ports.readBundle(),launchBefore=ports.readLaunch(),intent=mode==='standalone'?bundleFingerprint(bundleBefore):launchFingerprint(launchBefore),walletSnapshot=JSON.stringify(library.wallets),unlockSnapshot=JSON.stringify([...(library.unlockedIds??[])].sort()),revision=library.revision
  const members=mode==='standalone'?[deployer.id,...pairs.map(pair=>pair.sniper.id)]:pairs.map(pair=>pair.sniper.id)
  const sameMembers=(ids:string[])=>ids.length===members.length&&ids.every(id=>members.includes(id))
  let group=library.groups.find(row=>sameMembers(row.walletIds))
  if(!group){group=await ports.createGroup('Sniper pair sources',members);created=true}
  assertIdle()
  const current=ports.readLibrary(),liveGroup=current.groups.find(row=>row.id===group!.id)
  if(current.storageUnavailable||current.revision!==revision+Number(created)||JSON.stringify(current.wallets)!==walletSnapshot||JSON.stringify([...(current.unlockedIds??[])].sort())!==unlockSnapshot||!liveGroup||!sameMembers(liveGroup.walletIds)||(mode==='standalone'?bundleFingerprint(ports.readBundle()):launchFingerprint(ports.readLaunch()))!==intent)throw new Error('The wallets or launch changed while saving its source group. Review the selection again.')
  if(mode==='standalone')ports.commitStandalone({managedGroupId:group.id,managedCreatorWalletId:deployer.id,creatorPublicKey:deployer.publicKey,creatorPrivateKey:'',creatorBalance:null,bundleWallets:mapSniperPairsToBundle(bundleBefore.bundleWallets,pairs,deployer),statusMessage:'Sniper pairs selected. Each sniper forwards its new purchase to its token receiver. Review and fund both wallet roles before launching.'})
  else{const settings=mapSniperPairsToLaunch(launchBefore.bundleSettings,pairs,group.id,deployer.publicKey);ports.selectDeployer(deployer.id);ports.commitInline({usePlatformWallet:true,bundleSettings:settings})}
 }catch(reason){const message=reason instanceof Error?reason.message:'The selected pairs could not be attached.';throw new Error(created?`The encrypted wallets and source group are saved. ${message}`:message)}
}
