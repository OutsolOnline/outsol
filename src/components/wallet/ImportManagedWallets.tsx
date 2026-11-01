'use client'

import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react'
import {Import,Loader2,ShieldCheck,Upload} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '@/components/ui/dialog'
import {parseWalletImport} from '@/lib/walletLibrary/import'
import {useWalletLibraryStore,type WalletSummary} from '@/stores/walletLibraryStore'

export interface ImportManagedWalletsProps {
 onImported:(wallets:WalletSummary[])=>void|Promise<void>
 maxCount?:number
 disabled?:boolean
 label?:string
}
const IMPORT_BYTES=131072
const publicError=(value:unknown,fallback:string)=>value instanceof Error?value.message:fallback

/** Private input is session-only. Existing library parsing and encryption own
 * validation/persistence; this dialog never uploads a file or signing key. */
export function ImportManagedWallets({onImported,maxCount=20,disabled=false,label='Import wallets'}:ImportManagedWalletsProps){
 const library=useWalletLibraryStore(),id=useId(),opener=useRef<HTMLButtonElement>(null),fileInput=useRef<HTMLInputElement>(null),readEpoch=useRef(0),mounted=useRef(true),operation=useRef(false)
 const [open,setOpen]=useState(false),[name,setName]=useState('Imported bundle'),[text,setText]=useState(''),[passphrase,setPassphrase]=useState(''),[confirmation,setConfirmation]=useState(''),[working,setWorking]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState('')
 const capacity=Math.min(20,Number.isSafeInteger(maxCount)?Math.max(0,maxCount):20,Math.max(0,100-library.wallets.length)),busy=working||library.busy
 const invalidateReads=useCallback(()=>{readEpoch.current++},[])
 useEffect(()=>{mounted.current=true;useWalletLibraryStore.getState().hydrate();return()=>{mounted.current=false;invalidateReads()}},[invalidateReads])
 const clearSecrets=()=>{readEpoch.current++;setText('');setPassphrase('');setConfirmation('');setReading(false);if(fileInput.current)fileInput.current.value=''}
 const close=()=>{if(busy)return;clearSecrets();setOpen(false);setError('')}
 const preview=useMemo(()=>{
  if(!text)return{addresses:[] as string[],error:''}
  try{const parsed=parseWalletImport(text,library.wallets.map(wallet=>wallet.publicKey));if(parsed.length>capacity)throw new Error(`Import at most ${capacity} wallets into the current bundle selection.`);return{addresses:parsed.map(wallet=>wallet.publicKey),error:''}}
  catch(reason){return{addresses:[] as string[],error:publicError(reason,'The private wallet input could not be validated.')}}
 },[text,library.wallets,capacity])
 const readFiles=async(values:FileList|null)=>{
  if(!values||busy||disabled)return
  const files=Array.from(values),epoch=++readEpoch.current
  setReading(true);setError('');setText('')
  try{
   if(!files.length||files.length>20||files.some(file=>file.size>IMPORT_BYTES)||files.reduce((sum,file)=>sum+file.size,0)>IMPORT_BYTES)throw new Error('Choose up to 20 local keypair files, no larger than 128 KB in total.')
   const collected:{name?:string;publicKey:string;privateKey:string}[]=[],existing=useWalletLibraryStore.getState().wallets.map(wallet=>wallet.publicKey)
   for(const file of files){
    const value=await file.text();if(!mounted.current||readEpoch.current!==epoch)return
    const parsed=parseWalletImport(value,[...existing,...collected.map(wallet=>wallet.publicKey)])
    collected.push(...parsed.map(wallet=>({...(wallet.name?{name:wallet.name}:{}),publicKey:wallet.publicKey,privateKey:wallet.secretKeyBase58})))
    if(collected.length>capacity)throw new Error(`Import at most ${capacity} wallets into the current bundle selection.`)
   }
   const combined=JSON.stringify({wallets:collected})
   if(new TextEncoder().encode(combined).length>IMPORT_BYTES)throw new Error('The combined wallet import exceeds 128 KB.')
   if(mounted.current&&readEpoch.current===epoch)setText(combined)
  }catch(reason){if(mounted.current&&readEpoch.current===epoch){setText('');setError(publicError(reason,'The local keypair files could not be read.'))}}
  finally{if(mounted.current&&readEpoch.current===epoch)setReading(false)}
 }
 const submit=async()=>{
  if(operation.current||busy||reading||disabled)return
  setError('')
  if(!preview.addresses.length||preview.error||!name.trim()||name.trim().length>45||passphrase.length<12||passphrase!==confirmation){setError('Validate the wallet input and enter matching passphrases of at least 12 characters.');return}
  // Resolve again against the live collection before handing private input to
  // the library. An intervening import must not become a duplicate or partial save.
  try{if(parseWalletImport(text,useWalletLibraryStore.getState().wallets.map(wallet=>wallet.publicKey)).length>capacity)throw new Error('The import exceeds the current bundle capacity.')}
  catch(reason){setError(publicError(reason,'Review the wallet input again.'));return}
  const privateInput=text,encryptionPassphrase=passphrase,prefix=name.trim()
  clearSecrets();operation.current=true;setWorking(true)
  let created:WalletSummary[]
  try{created=await useWalletLibraryStore.getState().importWallets({text:privateInput,prefix,passphrase:encryptionPassphrase})}
  catch(reason){if(mounted.current)setError(publicError(reason,'The encrypted wallets could not be saved.'));return}
  finally{operation.current=false;if(mounted.current)setWorking(false)}
  if(mounted.current){setOpen(false);setError('')}
  try{await onImported(created)}
  catch{if(mounted.current)setError('The wallets were saved in your encrypted library, but could not be attached to this bundle. Choose them from the wallet group before continuing.')}
 }
 return <div className="min-w-0">
  <Dialog open={open} onOpenChange={next=>{if(!next){close();return}clearSecrets();setName('Imported bundle');setError('');setOpen(true)}}>
   <DialogTrigger asChild><Button ref={opener} type="button" size="sm" variant="secondary" disabled={disabled||busy||!library.hydrated||library.storageUnavailable||capacity<1}><Import size={14}/>{label}</Button></DialogTrigger>
   <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-[min(34rem,calc(100vw-2rem))] rounded-xl" onEscapeKeyDown={event=>{if(busy)event.preventDefault()}} onInteractOutside={event=>{if(busy)event.preventDefault()}} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus()}}}>
    <DialogTitle className="text-xl">Import bundle wallets</DialogTitle>
    <DialogDescription className="text-sm text-muted leading-6">Import up to {capacity} Solana wallets here and encrypt them in your existing wallet library. Private keys and files are read only on this device.</DialogDescription>
    <form className="space-y-5" onSubmit={event=>{event.preventDefault();void submit()}}>
     <fieldset disabled={busy||reading} className="space-y-5">
      <div><label className="field-label" htmlFor={`${id}-name`}>Wallet name prefix</label><Input id={`${id}-name`} required maxLength={45} value={name} onChange={event=>setName(event.target.value)}/></div>
      <div><label className="field-label" htmlFor={`${id}-private`}>Private keys or wallet JSON</label><Input id={`${id}-private`} type="password" value={text.replace(/\r?\n/g,' ')} autoComplete="off" spellCheck={false} maxLength={IMPORT_BYTES} placeholder="Paste one Base58 key per line or keypair JSON" onPaste={event=>{event.preventDefault();readEpoch.current++;setReading(false);setText(event.clipboardData.getData('text'));setError('')}} onChange={event=>{readEpoch.current++;setText(event.target.value);setError('')}}/><div className="mt-3 flex flex-wrap gap-3"><Button variant="secondary" type="button" onClick={()=>fileInput.current?.click()}><Upload size={14}/>Choose keypair files</Button><Button variant="ghost" type="button" onClick={()=>{readEpoch.current++;setText('');setError('')}} disabled={!text}>Clear private input</Button></div><input ref={fileInput} type="file" multiple accept=".json,.txt,application/json,text/plain" className="hidden" aria-label="Bundle wallet keypair files" onChange={event=>{void readFiles(event.currentTarget.files);event.currentTarget.value=''}}/><p className="field-help">Base58 private keys, 64-byte Solana keypair arrays and OutSol private backups. Maximum 128 KB total. Seed phrases are not supported.</p></div>
     </fieldset>
     {reading?<p role="status" className="text-sm text-muted flex items-center gap-2"><Loader2 size={15} className="animate-spin"/>Reading keypair files locally…</p>:text&&<div className="rounded-lg border border-border bg-background/30 p-4">{preview.error?<p role="alert" className="text-sm text-red-200">{preview.error}</p>:<><p className="text-sm">{preview.addresses.length} valid, distinct wallet{preview.addresses.length===1?'':'s'}</p><div className="max-h-32 overflow-y-auto mt-3 space-y-2">{preview.addresses.map((address,index)=><p key={address} className="font-mono text-xs text-muted break-all">{index+1}. {address}</p>)}</div></>}</div>}
     <fieldset disabled={busy||reading} className="space-y-5"><div><label className="field-label" htmlFor={`${id}-passphrase`}>Encryption passphrase</label><Input id={`${id}-passphrase`} type="password" autoComplete="new-password" minLength={12} required value={passphrase} onChange={event=>setPassphrase(event.target.value)}/><p className="field-help">At least 12 characters. Keep this passphrase and a private backup; OutSol cannot reset it.</p></div><div><label className="field-label" htmlFor={`${id}-confirmation`}>Confirm passphrase</label><Input id={`${id}-confirmation`} type="password" autoComplete="new-password" required value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></div><p className="field-help flex gap-2"><ShieldCheck size={15} className="shrink-0"/>Private input clears before encryption begins. Saved keys use the existing encrypted library and lock after refresh.</p>{error&&<p role="alert" className="notice notice-error">{error}</p>}<Button type="submit" className="w-full" disabled={busy||reading||disabled||!preview.addresses.length||!!preview.error||!name.trim()||passphrase.length<12||passphrase!==confirmation}>{working?<Loader2 size={15} className="animate-spin"/>:<Import size={15}/>} {working?'Encrypting wallets…':`Import and encrypt ${preview.addresses.length} wallet${preview.addresses.length===1?'':'s'}`}</Button></fieldset>
    </form>
   </DialogContent>
  </Dialog>
  {!open&&error&&<p role="alert" className="text-xs text-red-200 mt-2 max-w-sm">{error}</p>}
 </div>
}
