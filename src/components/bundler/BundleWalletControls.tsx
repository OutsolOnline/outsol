'use client'
import {useEffect,useMemo,useState} from 'react'
import Link from 'next/link'
import {useWallet} from '@solana/wallet-adapter-react'
import {RelayWorkspace} from '@/components/relay/RelayWorkspace'
import {useBundlerStore} from '@/stores/bundlerStore'
import {useLaunchStore} from '@/stores/launchStore'
import {useWalletLibraryStore,type WalletSummary} from '@/stores/walletLibraryStore'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {createBundleWalletControlScope,createLaunchWalletControlScope,bundleWalletRecipientIds,bundleWalletRouteStorage,launchWalletControlMint,prepareBundleWalletControlStorage,type WalletControlScope} from '@/lib/bundler/walletControls'
import type {WalletOperationStorage} from '@/lib/walletOperations/history'

export interface BundleWalletControlsProps {mode:'standalone'|'launch';creatorAddress?:string|null;onBusyChange?:(busy:boolean)=>void}
const browserPublicStorage:WalletOperationStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)}
function walletControlReader(mode:BundleWalletControlsProps['mode'],externalAddress:()=>string|null){return(ids:readonly string[]=[])=>mode==='standalone'?createBundleWalletControlScope(useBundlerStore.getState,useWalletLibraryStore.getState,{recipientIds:ids}):createLaunchWalletControlScope(useLaunchStore.getState,useWalletLibraryStore.getState,usePlatformWalletStore.getState,externalAddress,{recipientIds:ids})}
function currentContext(mode:BundleWalletControlsProps['mode']){const bundle=useBundlerStore.getState(),launch=useLaunchStore.getState();return{mint:mode==='standalone'?bundle.result?.mintAddress:launchWalletControlMint(launch),groupId:mode==='standalone'?bundle.managedGroupId:launch.bundleSettings.groupId}}
/** Remains mounted while the launch tab/steps change. Record the exact live
 * actor-to-mint transition before session-only zero-budget buyers disappear. */
export function useBundleWalletControlPersistence(mode:BundleWalletControlsProps['mode']):string{
 const external=useWallet(),[error,setError]=useState('')
 useEffect(()=>{
  const sync=()=>{try{const {mint,groupId}=currentContext(mode);prepareBundleWalletControlStorage(mode,mint,walletControlReader(mode,()=>external.wallet?.adapter.publicKey?.toBase58()??null),localStorage,{groupId});setError('')}catch{setError('Bundle wallet selections or routes could not be preserved. Keep browser data and wallet backups before refreshing.')}}
  sync();const unsubscribe=mode==='standalone'?useBundlerStore.subscribe(sync):useLaunchStore.subscribe(sync)
  return unsubscribe
 },[mode,external.wallet])
 return error
}
/** Composes existing Relay/sale execution around the bundle's actual live
 * signers. Only public recipient IDs, addresses and routes enter local storage. */
export function BundleWalletControls({mode,creatorAddress,onBusyChange}:BundleWalletControlsProps){
 const bundle=useBundlerStore(),launch=useLaunchStore(),external=useWallet()
 useWalletLibraryStore();usePlatformWalletStore()
 const [attachments,setAttachments]=useState<{identity:string;context:string;ids:string[]}>({identity:'',context:'',ids:[]}),[error,setError]=useState('')
 const externalAddress=()=>external.wallet?.adapter.publicKey?.toBase58()??creatorAddress??null,readScope=walletControlReader(mode,externalAddress),base=readScope(),{mint,groupId}=currentContext(mode)
 const identity=JSON.stringify({mode,mint,groupId,actors:base.wallets.filter(wallet=>base.roles[wallet.id]!=='recipient').map(wallet=>`${base.roles[wallet.id]}-${wallet.publicKey}`).sort()})
 useEffect(()=>{
  try{const current=currentContext(mode),value=prepareBundleWalletControlStorage(mode,current.mint,walletControlReader(mode,()=>external.wallet?.adapter.publicKey?.toBase58()??creatorAddress??null),localStorage,{groupId:current.groupId});setAttachments({identity,...value});setError('')}
  catch{setAttachments({identity,context:'',ids:[]});setError('Saved bundle recipients or routes cannot be read. Preserve browser data; wallet keys remain in the encrypted library.')}
 },[mode,identity,external.wallet,creatorAddress])
 const ids=attachments.identity===identity?attachments.ids:[]
 // Revision binds the memo to live membership and unlock state, while keeping
 // an ongoing reviewed queue stable through unrelated parent renders.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const scope:WalletControlScope=useMemo(()=>walletControlReader(mode,()=>external.wallet?.adapter.publicKey?.toBase58()??creatorAddress??null)(ids),[mode,external.wallet,creatorAddress,ids,base.revision])
 const routeStorage=useMemo(()=>bundleWalletRouteStorage(attachments.context,scope,browserPublicStorage),[attachments.context,scope])
 const attached=(created:WalletSummary[])=>{
  const next=bundleWalletRecipientIds([...new Set([...ids,...created.map(wallet=>wallet.id)])])
  try{const key=`outsol-bundle-recipients-v1:${attachments.context}`,raw=JSON.stringify(next);localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error();setAttachments({...attachments,ids:next});setError('')}
  catch{setError('Wallets were encrypted and saved, but their bundle attachment could not be saved. Keep their backup and restore browser storage before continuing.');throw new Error('Recipient wallets are saved in the encrypted library. Their bundle attachment could not be saved.')}
 }
 return <section id="bundle-wallet-controls" aria-label="Bundle wallet controls">{error&&<p role="alert" className="notice notice-error mb-5">{error}</p>}{mode==='launch'&&mint&&<p className="field-help mb-5">Keep a backup of every controlled wallet. After a refresh, you can also select or import these wallets in <Link href="/bundler" className="text-accent underline">Bundles → Wallet controls</Link>.</p>}{attachments.identity===identity&&attachments.context?<RelayWorkspace embedded scope={scope} routeStorage={routeStorage} onRecipientCreated={attached} disabled={!!error||(mode==='standalone'?bundle.isExecuting:launch.isLoading)} onBusyChange={onBusyChange}/>:!error&&<p role="status" className="field-help">Restoring bundle wallet controls…</p>}</section>
}
