'use client'
import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react'
import {Download,Import,Loader2,LockKeyhole,Plus,ShieldCheck,Upload} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '@/components/ui/dialog'
import {useWalletLibraryStore,type WalletSummary} from '@/stores/walletLibraryStore'
import {useSniperPairStore} from '@/stores/sniperPairStore'
import {useBundlerStore} from '@/stores/bundlerStore'
import {useLaunchStore} from '@/stores/launchStore'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'
import {readPending} from '@/lib/launchHistory'
import {readTradePending} from '@/lib/venues/tradeHistory'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {buildSniperSessionBackup,parseSniperSessionBackup} from '@/lib/sniperPairs/sessionBackup'
import {generateSniperSession,restoreSniperSession,unlockSniperSessionWallets,type SniperSessionSetupPorts,type SniperSessionSetupResult} from '@/lib/sniperPairs/sessionSetup'
import type {ResolvedSniperPair} from '@/lib/sniperPairs/catalog'

const message=(error:unknown)=>error instanceof Error?error.message:'The session could not be prepared.'
const MAX_FILE_BYTES=131072
function assertSetupAvailable(current:()=>boolean){
 if(!current())throw new Error('Session setup stopped. Previously encrypted wallets remain in Wallets.')
 if(useBundlerStore.getState().isExecuting||useLaunchStore.getState().isLoading)throw new Error('Finish or cancel the current launch before changing its wallets.')
 assertNoPendingBundleReceipt();assertNoPendingWalletOperation();assertNoPendingGroupOperation()
 if(readPending()||readTradePending())throw new Error('A launch or sale needs confirmation. Check Activity before changing the session.')
}
const setupPorts=(current:()=>boolean):SniperSessionSetupPorts=>({readLibrary:useWalletLibraryStore.getState,readPairs:useSniperPairStore.getState,assertAvailable:()=>assertSetupAvailable(current)})
function useSetupLifecycle(busy:boolean,onBusyChange?:((busy:boolean)=>void)){
 const mountedRef=useRef(true),epochRef=useRef(0),callbackRef=useRef(onBusyChange);
 useEffect(()=>{callbackRef.current=onBusyChange},[onBusyChange])
 const unmount=useCallback(()=>{mountedRef.current=false;epochRef.current++;callbackRef.current?.(false)},[])
 useEffect(()=>{mountedRef.current=true;useWalletLibraryStore.getState().hydrate();useSniperPairStore.getState().hydrate();return unmount},[unmount])
 useEffect(()=>{callbackRef.current?.(busy)},[busy])
 return{mountedRef,epochRef}
}
const dialogClass='max-h-[90dvh] overflow-y-auto max-w-[min(35rem,calc(100vw-2rem))] rounded-xl'

export interface GenerateSniperSessionProps {maxPairs:number;includeDeployer:boolean;disabled?:boolean;onCreated:(result:{pairIds:string[];deployerId?:string})=>void;onBusyChange?:(busy:boolean)=>void}
/** The count represents pairs. A single submit creates and encrypts both
 * wallets in every pair, plus an optional separate deployer. */
export function GenerateSniperSession({maxPairs,includeDeployer,disabled=false,onCreated,onBusyChange}:GenerateSniperSessionProps){
 const library=useWalletLibraryStore(),catalog=useSniperPairStore(),id=useId(),opener=useRef<HTMLButtonElement>(null),operation=useRef(false)
 const [open,setOpen]=useState(false),[count,setCount]=useState('1'),[withDeployer,setWithDeployer]=useState(includeDeployer),[passphrase,setPassphrase]=useState(''),[confirmation,setConfirmation]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const {mountedRef,epochRef}=useSetupLifecycle(working,onBusyChange),openLimit=Math.max(0,Math.min(16,Number.isInteger(maxPairs)?maxPairs:16,50-catalog.pairs.length,Math.floor((100-library.wallets.length)/2))),limit=Math.max(0,Math.min(openLimit,Math.floor((100-library.wallets.length-Number(withDeployer))/2))),validCount=/^[1-9]\d*$/.test(count)&&Number(count)<=limit,busy=working||library.busy
 const clear=()=>{epochRef.current++;setPassphrase('');setConfirmation('')}
 const close=()=>{if(operation.current)return;clear();setOpen(false);setError('')}
 const submit=async()=>{
  if(operation.current||busy||disabled)return
  if(!validCount||passphrase.length<12||passphrase!==confirmation){setError('Choose a valid number of pairs and matching passphrases of at least 12 characters.');return}
  const encryptionPassphrase=passphrase,total=Number(count),createDeployer=withDeployer;clear();const revision=epochRef.current
  operation.current=true;setWorking(true);setError('');setNotice('')
  let result:SniperSessionSetupResult
  try{result=await generateSniperSession({count:total,includeDeployer:createDeployer,passphrase:encryptionPassphrase},setupPorts(()=>mountedRef.current&&epochRef.current===revision))}
  catch(reason){if(mountedRef.current)setError(message(reason));return}
  finally{operation.current=false;if(mountedRef.current)setWorking(false)}
  if(!mountedRef.current)return
  setOpen(false);setNotice(`${total} reusable pair${total===1?'':'s'} saved${result.deployerId?' with a separate deployer':''}. Back up the session before funding its addresses.`)
  try{onCreated(result)}catch{setError('The encrypted wallets and reusable pairs were saved. Select them again from your saved pairs to continue.')}
 }
 return <div className="min-w-0"><Dialog open={open} onOpenChange={next=>{if(!next){close();return}if(disabled||busy)return;clear();setWithDeployer(includeDeployer&&library.wallets.length+3<=100);setCount('1');setError('');setNotice('');setOpen(true)}}>
  <DialogTrigger asChild><Button ref={opener} type="button" size="sm" disabled={disabled||busy||!library.hydrated||library.storageUnavailable||catalog.storageUnavailable||openLimit<1}><Plus size={15}/>Generate sniper session</Button></DialogTrigger>
  <DialogContent className={dialogClass} onEscapeKeyDown={event=>{if(working)event.preventDefault()}} onInteractOutside={event=>{if(working)event.preventDefault()}} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus()}}}>
   <DialogTitle className="text-xl">Generate sniper session</DialogTitle><DialogDescription className="text-sm text-muted leading-6">One action creates every Sniper → Token Receiver pair. The deployer is a separate wallet. You fund the addresses yourself when you are ready.</DialogDescription>
   <form className="space-y-5" onSubmit={event=>{event.preventDefault();void submit()}}><fieldset disabled={busy} className="space-y-5">
    <div><label className="field-label" htmlFor={`${id}-count`}>Number of pairs · 1–{limit}</label><Input id={`${id}-count`} type="number" min={1} max={limit} step={1} required value={count} onChange={event=>setCount(event.target.value)}/><p className="field-help">{validCount?`${Number(count)*2} pair wallets${withDeployer?' + 1 deployer':''}. Named A Sniper / A Token Receiver, then B, C and onward. Existing names are skipped.`:'Choose how many complete pairs to create.'}</p></div>
    <label className="flex gap-3 items-start text-sm leading-6"><input type="checkbox" className="mt-1 accent-accent" checked={withDeployer} disabled={library.wallets.length+3>100} onChange={event=>setWithDeployer(event.target.checked)}/>Create a separate deployer wallet</label>
    <div><label className="field-label" htmlFor={`${id}-pass`}>Encryption passphrase</label><Input id={`${id}-pass`} type="password" autoComplete="new-password" minLength={12} required value={passphrase} onChange={event=>setPassphrase(event.target.value)}/><p className="field-help">At least 12 characters. Keep it with your private backup; OutSol cannot recover it.</p></div>
    <div><label className="field-label" htmlFor={`${id}-confirm`}>Confirm passphrase</label><Input id={`${id}-confirm`} type="password" autoComplete="new-password" required value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></div>
    <p className="field-help flex gap-2"><ShieldCheck size={15} className="shrink-0"/>Keys are generated and encrypted locally. Creating a session sends no funds and places no trades.</p>{error&&<p role="alert" className="notice notice-error">{error}</p>}
    <Button type="submit" className="w-full" disabled={busy||disabled||!validCount||passphrase.length<12||passphrase!==confirmation}>{working?<Loader2 size={15} className="animate-spin"/>:<Plus size={15}/>} {working?'Generating and encrypting session…':`Generate ${validCount?count:''} pair${count==='1'?'':'s'}${withDeployer?' + deployer':''}`}</Button>
   </fieldset></form>
  </DialogContent></Dialog>{notice&&<p role="status" className="field-help mt-3">{notice}</p>}{!open&&error&&<p role="alert" className="notice notice-error mt-3">{error}</p>}</div>
}

export interface SniperSessionToolsProps {pairs:readonly ResolvedSniperPair[];deployer?:WalletSummary;name:string;disabled?:boolean;onRestored:(result:{pairIds:string[];deployerId?:string;name:string})=>void;onBusyChange?:(busy:boolean)=>void}
/** Session exports are an explicit one-click local action. Import keeps private
 * material only in masked transient input, then in the encrypted wallet vault. */
export function SniperSessionTools({pairs,deployer,name,disabled=false,onRestored,onBusyChange}:SniperSessionToolsProps){
 const library=useWalletLibraryStore(),catalog=useSniperPairStore(),id=useId(),opener=useRef<HTMLButtonElement>(null),unlockOpener=useRef<HTMLButtonElement>(null),fileInput=useRef<HTMLInputElement>(null),operation=useRef(false),selectionRef=useRef('')
 const [open,setOpen]=useState(false),[text,setText]=useState(''),[passphrase,setPassphrase]=useState(''),[confirmation,setConfirmation]=useState(''),[working,setWorking]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [unlockOpen,setUnlockOpen]=useState(false),[unlockPassphrase,setUnlockPassphrase]=useState('')
 const {mountedRef,epochRef}=useSetupLifecycle(working||reading,onBusyChange),busy=working||library.busy
 const sessionWallets=Array.from(new Map([...pairs.flatMap(pair=>[pair.sniper,pair.receiver]),...(deployer?[deployer]:[])].map(wallet=>[`${wallet.id}:${wallet.publicKey}`,wallet])).values()),selection=JSON.stringify(sessionWallets.map(wallet=>({id:wallet.id,address:wallet.publicKey})))
 useEffect(()=>{selectionRef.current=selection},[selection])
 const preview=useMemo(()=>{if(!text)return{valid:false,name:'',pairs:0,wallets:0,error:''};try{const parsed=parseSniperSessionBackup(text);return{valid:true,name:parsed.name,pairs:parsed.pairs.length,wallets:parsed.wallets.length,error:''}}catch(reason){return{valid:false,name:'',pairs:0,wallets:0,error:message(reason)}}},[text])
 const clear=()=>{epochRef.current++;setText('');setPassphrase('');setConfirmation('');setReading(false);if(fileInput.current)fileInput.current.value=''}
 const close=()=>{if(operation.current)return;clear();setOpen(false);setError('')}
 const closeUnlock=()=>{if(operation.current)return;epochRef.current++;setUnlockPassphrase('');setUnlockOpen(false)}
 const unlock=async()=>{
  if(operation.current||disabled||busy||reading||!unlockPassphrase)return
  const encryptionPassphrase=unlockPassphrase,expected=selection,wallets=sessionWallets.map(wallet=>({...wallet})),revision=++epochRef.current;setUnlockPassphrase('');operation.current=true;setWorking(true);setError('');setNotice('')
  try{
   const total=await unlockSniperSessionWallets(wallets,encryptionPassphrase,{readLibrary:useWalletLibraryStore.getState,assertAvailable:()=>{assertSetupAvailable(()=>mountedRef.current&&epochRef.current===revision);if(selectionRef.current!==expected)throw new Error('The selected pairs or deployer changed. Review and unlock this session again.')}})
   if(mountedRef.current){setUnlockOpen(false);setNotice(`All ${total} session wallets are unlocked in this browser${deployer?', including the deployer':''}. You can download the complete backup now.`)}
  }catch(reason){if(mountedRef.current)setError(message(reason))}finally{operation.current=false;if(mountedRef.current)setWorking(false)}
 }
 const download=()=>{
  if(disabled||busy||reading||!pairs.length)return
  setError('');setNotice('')
  try{
   const file=buildSniperSessionBackup({name,pairs,deployer,readKeypair:walletId=>useWalletLibraryStore.getState().getKeypair(walletId)}),url=URL.createObjectURL(new Blob([file.content],{type:file.mimeType})),anchor=document.createElement('a')
   try{anchor.href=url;anchor.download=file.filename;anchor.style.display='none';document.body.appendChild(anchor);anchor.click()}finally{anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),2000)}
   setNotice(`Private backup downloaded for ${pairs.length} pair${pairs.length===1?'':'s'}${deployer?' and the deployer':''}. Keep this unencrypted file offline.`)
  }catch(reason){setError(message(reason))}
 }
 const readFile=async(file:File|undefined)=>{
  if(!file||busy||disabled)return
  const revision=++epochRef.current;setReading(true);setText('');setError('')
  try{if(file.size>MAX_FILE_BYTES)throw new Error('Choose a session backup no larger than 128 KB.');const value=await file.text();if(!mountedRef.current||epochRef.current!==revision)return;parseSniperSessionBackup(value);setText(value)}
  catch(reason){if(mountedRef.current&&epochRef.current===revision)setError(message(reason))}
  finally{if(mountedRef.current&&epochRef.current===revision)setReading(false)}
 }
 const submit=async()=>{
  if(operation.current||busy||reading||disabled)return
  if(!preview.valid||passphrase.length<12||passphrase!==confirmation){setError('Choose a valid session backup and matching passphrases of at least 12 characters.');return}
  let parsed:ReturnType<typeof parseSniperSessionBackup>
  try{parsed=parseSniperSessionBackup(text)}catch(reason){setError(message(reason));return}
  const encryptionPassphrase=passphrase;clear();const revision=epochRef.current;operation.current=true;setWorking(true);setError('');setNotice('')
  let result:SniperSessionSetupResult
  try{result=await restoreSniperSession(parsed,encryptionPassphrase,setupPorts(()=>mountedRef.current&&epochRef.current===revision))}
  catch(reason){if(mountedRef.current)setError(message(reason));return}
  finally{parsed.wallets.forEach(wallet=>{wallet.privateKey=''});operation.current=false;if(mountedRef.current)setWorking(false)}
  if(!mountedRef.current)return
  setOpen(false);setNotice(`${result.pairIds.length} reusable pair${result.pairIds.length===1?'':'s'} restored. Existing wallets kept their original encryption and passphrases.`)
  try{onRestored(result)}catch{setError('The session and encrypted wallets were saved. Select the restored pairs again to continue.')}
 }
 return <div className="min-w-0"><div className="flex flex-wrap gap-3 items-center"><Button type="button" size="sm" variant="secondary" disabled={disabled||busy||reading||!pairs.length} onClick={download}><Download size={15}/>Download session backup</Button>
  <Dialog open={unlockOpen} onOpenChange={next=>{if(!next){closeUnlock();return}if(disabled||busy||reading)return;epochRef.current++;setUnlockPassphrase('');setError('');setUnlockOpen(true)}}><DialogTrigger asChild><Button ref={unlockOpener} type="button" size="sm" variant="secondary" disabled={disabled||busy||reading||!sessionWallets.length||library.storageUnavailable}><LockKeyhole size={15}/>Unlock session</Button></DialogTrigger><DialogContent className={dialogClass} onEscapeKeyDown={event=>{if(working)event.preventDefault()}} onInteractOutside={event=>{if(working)event.preventDefault()}} onCloseAutoFocus={event=>{if(unlockOpener.current?.isConnected){event.preventDefault();unlockOpener.current.focus()}}}><DialogTitle className="text-xl">Unlock session wallets</DialogTitle><DialogDescription className="text-sm text-muted leading-6">Unlock all {sessionWallets.length} session wallets: Snipers, Token Receivers{deployer?' and the deployer':''}. Use their encryption passphrase. Keys stay in this browser session; this sends no funds.</DialogDescription><form className="space-y-5" onSubmit={event=>{event.preventDefault();void unlock()}}><label className="block field-label" htmlFor={`${id}-unlock`}>Session passphrase</label><Input id={`${id}-unlock`} type="password" autoComplete="current-password" required disabled={working} value={unlockPassphrase} onChange={event=>setUnlockPassphrase(event.target.value)}/><p className="field-help">Existing wallets can have different passphrases. Already unlocked keys are kept; use wallet-level unlock for a wallet with another passphrase.</p>{error&&<p role="alert" className="notice notice-error">{error}</p>}<Button type="submit" className="w-full" disabled={working||disabled||!unlockPassphrase}>{working?<Loader2 size={15} className="animate-spin"/>:<LockKeyhole size={15}/>} {working?'Unlocking session…':'Unlock all session wallets'}</Button></form></DialogContent></Dialog>
  <Dialog open={open} onOpenChange={next=>{if(!next){close();return}if(disabled||busy)return;clear();setError('');setNotice('');setOpen(true)}}><DialogTrigger asChild><Button ref={opener} type="button" variant="secondary" size="sm" disabled={disabled||busy||!library.hydrated||library.storageUnavailable||catalog.storageUnavailable}><Import size={15}/>Import session backup</Button></DialogTrigger>
   <DialogContent className={dialogClass} onEscapeKeyDown={event=>{if(working)event.preventDefault()}} onInteractOutside={event=>{if(working)event.preventDefault()}} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus()}}}>
    <DialogTitle className="text-xl">Restore sniper session</DialogTitle><DialogDescription className="text-sm text-muted leading-6">Restore the complete private file, including Sniper → Token Receiver pairings and the optional deployer. Existing wallets are kept; missing keys are encrypted on this device.</DialogDescription>
    <form className="space-y-5" onSubmit={event=>{event.preventDefault();void submit()}}><fieldset disabled={busy||reading} className="space-y-5">
     <div><label className="field-label" htmlFor={`${id}-private`}>Private session JSON</label><Input id={`${id}-private`} type="password" autoComplete="off" spellCheck={false} maxLength={MAX_FILE_BYTES} placeholder="Paste your OutSol session backup" value={text.replace(/\r?\n/g,' ')} onPaste={event=>{event.preventDefault();epochRef.current++;setText(event.clipboardData.getData('text'));setError('')}} onChange={event=>{epochRef.current++;setText(event.target.value);setError('')}}/><div className="mt-3 flex flex-wrap gap-3"><Button type="button" variant="secondary" onClick={()=>fileInput.current?.click()}><Upload size={14}/>Choose session file</Button><Button type="button" variant="ghost" disabled={!text} onClick={()=>{epochRef.current++;setText('');setError('')}}>Clear private input</Button></div><input ref={fileInput} type="file" className="hidden" accept=".json,application/json" aria-label="Private sniper session backup file" onChange={event=>{void readFile(event.currentTarget.files?.[0]);event.currentTarget.value=''}}/><p className="field-help">Read locally · up to 128 KB · private keys are never uploaded.</p></div>
    </fieldset>{reading?<p role="status" className="field-help flex items-center gap-2"><Loader2 size={15} className="animate-spin"/>Reading private session locally…</p>:text&&<div className="rounded-lg border border-border p-4">{preview.error?<p role="alert" className="text-sm text-red-200">{preview.error}</p>:<><p className="text-sm font-medium">{preview.name}</p><p className="field-help">{preview.pairs} pair{preview.pairs===1?'':'s'} · {preview.wallets} verified wallets · roles preserved</p></>}</div>}
    <fieldset disabled={busy||reading} className="space-y-5"><div><label className="field-label" htmlFor={`${id}-pass`}>New encryption passphrase</label><Input id={`${id}-pass`} type="password" autoComplete="new-password" required minLength={12} value={passphrase} onChange={event=>setPassphrase(event.target.value)}/><p className="field-help">At least 12 characters. Applies to newly imported wallets; existing wallets keep their current passphrases.</p></div><div><label className="field-label" htmlFor={`${id}-confirm`}>Confirm passphrase</label><Input id={`${id}-confirm`} type="password" autoComplete="new-password" required value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></div><p className="field-help flex gap-2"><ShieldCheck size={15} className="shrink-0"/>Private input clears before encryption begins. Refresh locks the saved keys; keep your backup and passphrase.</p>{error&&<p role="alert" className="notice notice-error">{error}</p>}<Button type="submit" className="w-full" disabled={busy||reading||disabled||!preview.valid||passphrase.length<12||passphrase!==confirmation}>{working?<Loader2 size={15} className="animate-spin"/>:<Import size={15}/>} {working?'Encrypting and restoring session…':`Restore ${preview.valid?preview.pairs:''} pair${preview.pairs===1?'':'s'}`}</Button></fieldset>
    </form>
   </DialogContent>
  </Dialog></div><p className="field-help mt-3">The session backup is unencrypted and grants full access to every included wallet. Keep it private and offline.</p>{notice&&<p role="status" className="field-help mt-3">{notice}</p>}{!open&&!unlockOpen&&error&&<p role="alert" className="notice notice-error mt-3">{error}</p>}</div>
}
