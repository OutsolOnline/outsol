'use client'
import {useState} from 'react'
import {ShieldCheck} from 'lucide-react'
import {Input} from '@/components/ui/input'
import {CreateManagedWallets} from '@/components/wallet/CreateManagedWallets'
import {ImportManagedWallets} from '@/components/wallet/ImportManagedWallets'
import {useWalletLibraryStore,type WalletSummary} from '@/stores/walletLibraryStore'
import {useBundlerStore} from '@/stores/bundlerStore'
import {useLaunchStore} from '@/stores/launchStore'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {mergeManagedBundleWallets,appendLaunchBundleWallets} from '@/lib/bundler/walletSetup'

export function BundleWalletSetup({mode,creatorAddress,disabled=false}:{mode:'standalone'|'launch';creatorAddress?:string|null;disabled?:boolean}){
 const bundle=useBundlerStore(),launch=useLaunchStore(),library=useWalletLibraryStore()
 const groupId=mode==='standalone'?bundle.managedGroupId:launch.bundleSettings.groupId,group=library.groups.find(item=>item.id===groupId)
 const [name,setName]=useState('Bundle wallets'),[replace,setReplace]=useState(false),[asCreator,setAsCreator]=useState(mode==='launch'&&!creatorAddress),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const manualKeys=mode==='standalone'&&!bundle.managedGroupId&&!!(bundle.creatorPrivateKey||bundle.bundleWallets.some(wallet=>wallet.privateKey))
 const remaining=mode==='standalone'?17-(group?.walletIds.length||0):Math.min(16-launch.bundleSettings.wallets.length+(asCreator?1:0),20-(group?.walletIds.length||0))
 const launched=mode==='standalone'&&!!bundle.result?.createSignature
 const active=disabled||bundle.isExecuting||launch.isLoading
 const blocked=active||(manualKeys&&!replace)||remaining<=0
 const attach=async(added:WalletSummary[])=>{
  setError('');setNotice('')
  try{
   const currentBundle=useBundlerStore.getState(),currentLaunch=useLaunchStore.getState(),currentLibrary=useWalletLibraryStore.getState()
   if(currentBundle.isExecuting||currentLaunch.isLoading)throw new Error('The bundle is running. The new wallets remain in your encrypted library.')
   if(mode==='standalone'&&currentBundle.result?.createSignature){
    const expected=new Set([currentBundle.creatorPublicKey,...currentBundle.bundleWallets.map(wallet=>wallet.publicKey),...(currentBundle.result.submissions||[]).map(row=>row.payer),...(currentBundle.result.tokenTransfers||[]).map(row=>row.recipient)])
    const matches=added.filter(wallet=>expected.has(wallet.publicKey)).length
    setNotice(`${matches} matching bundle wallet${matches===1?'':'s'} restored. The launch receipt and configuration were kept; other imported wallets remain in your library.`);return
   }
   if(mode==='standalone'&&!currentBundle.managedGroupId&&(currentBundle.creatorPrivateKey||currentBundle.bundleWallets.some(wallet=>wallet.privateKey))&&!replace)throw new Error('Approve replacing the manual session selection after downloading its backup.')
   const currentGroupId=mode==='standalone'?currentBundle.managedGroupId:currentLaunch.bundleSettings.groupId,currentGroup=currentLibrary.groups.find(value=>value.id===currentGroupId)
   let nextGroup
   if(currentGroup){await currentLibrary.updateGroup(currentGroup.id,{walletIds:[...currentGroup.walletIds,...added.map(wallet=>wallet.id)]});nextGroup=useWalletLibraryStore.getState().groups.find(value=>value.id===currentGroup.id)!}
   else nextGroup=await currentLibrary.createGroup(name,added.map(wallet=>wallet.id))
   if(useBundlerStore.getState().isExecuting||useLaunchStore.getState().isLoading)throw new Error('The bundle started while saving its group. Review the wallet selection again after it stops.')
   if(mode==='standalone'){
    const previous=useBundlerStore.getState(),creatorId=previous.managedCreatorWalletId&&nextGroup.walletIds.includes(previous.managedCreatorWalletId)?previous.managedCreatorWalletId:nextGroup.walletIds[0]
    const live=useWalletLibraryStore.getState(),members=nextGroup.walletIds.map(id=>live.wallets.find(wallet=>wallet.id===id)).filter((wallet):wallet is WalletSummary=>!!wallet)
    const rows=mergeManagedBundleWallets(previous.managedGroupId===nextGroup.id?previous.bundleWallets:[],members,creatorId)
    previous.selectManagedGroup(nextGroup.id,creatorId)
    if(useBundlerStore.getState().managedGroupId!==nextGroup.id)throw new Error('The group was saved but the bundle changed before selection.')
    useBundlerStore.setState({bundleWallets:rows})
   }else{
    const current=useLaunchStore.getState();let payer=current.usePlatformWallet?usePlatformWalletStore.getState().getPublicKey():creatorAddress
    if(asCreator&&added[0]){useWalletLibraryStore.getState().selectWallet(added[0].id);current.setUsePlatformWallet(true);payer=added[0].publicKey}
    current.setBundleSettings(appendLaunchBundleWallets(current.bundleSettings,nextGroup.id,added,payer))
   }
   setAsCreator(false);setReplace(false)
   setNotice(`${added.length} encrypted wallet${added.length===1?'':'s'} added to ${nextGroup.name}. Existing buy amounts are preserved; new buyer budgets start at 0 SOL.`)
  }catch(reason){setError(`Wallets were saved in your encrypted library. ${reason instanceof Error?reason.message:'Could not attach them to this bundle.'}`)}
 }
 return <section className="rounded-xl border border-border bg-surface p-4 space-y-4" aria-label="Create or import bundle wallets"><div><h3 className="text-base font-medium">Generate or import bundle wallets</h3><p className="field-help">Create encrypted wallets here and keep them with this bundle. Download individual private keys or keypair files from Wallet controls below.</p></div>
  {!group&&!launched&&<label className="block text-sm">Group name<Input className="mt-2" value={name} maxLength={60} disabled={disabled} onChange={event=>setName(event.target.value)}/></label>}
  {group&&<p className="text-sm text-muted">Adding to <strong className="text-foreground">{group.name}</strong> · {Math.max(0,remaining)} available slots</p>}
  {manualKeys&&!launched&&<label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 accent-accent" checked={replace} disabled={disabled} onChange={event=>setReplace(event.target.checked)}/><span>Replace my manual session wallet selection with this encrypted group. <a href="#bundle-wallet-controls" className="underline">Download the current wallet backups first.</a></span></label>}
  {mode==='launch'&&<label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 accent-accent" checked={asCreator} disabled={disabled} onChange={event=>setAsCreator(event.target.checked)}/><span>Use the first new wallet as the creator. Other new wallets become buyers.</span></label>}
  <div className="flex flex-wrap gap-3">{!launched&&<CreateManagedWallets title="Generate bundle wallets" defaultPrefix="Bundle" maxCount={Math.max(1,remaining)} disabled={blocked||(!group&&!name.trim())} onCreated={added=>{void attach(added)}}/>}<ImportManagedWallets label={launched?'Restore bundle wallet keys':'Import bundle wallets'} maxCount={launched?20:Math.max(1,remaining)} disabled={launched?active:blocked||(!group&&!name.trim())} onImported={attach}/></div>
  <p className="field-help flex gap-2"><ShieldCheck size={14} className="shrink-0 mt-1"/>Generated and imported keys are encrypted in this browser. Nothing is funded or submitted by creating a wallet.</p>
  {notice&&<p className="notice" role="status">{notice}</p>}{error&&<p className="notice notice-error" role="alert">{error}</p>}
 </section>
}
