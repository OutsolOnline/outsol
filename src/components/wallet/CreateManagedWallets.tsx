'use client'

import {useId,useRef,useState} from 'react'
import {KeyRound,Loader2,Plus,ShieldCheck} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '@/components/ui/dialog'
import {useWalletLibraryStore,type WalletSummary} from '@/stores/walletLibraryStore'

export interface CreateManagedWalletsProps {
 onCreated:(wallets:WalletSummary[])=>void
 defaultPrefix?:string
 title?:string
 maxCount?:number
 disabled?:boolean
}

/** All generation and encryption use the existing browser wallet vault. */
export function CreateManagedWallets({onCreated,defaultPrefix='Wallet',title='Create wallet',maxCount=20,disabled=false}:CreateManagedWalletsProps){
 const library=useWalletLibraryStore(),id=useId(),opener=useRef<HTMLButtonElement>(null)
 const [open,setOpen]=useState(false),[name,setName]=useState(defaultPrefix),[count,setCount]=useState('1'),[passphrase,setPassphrase]=useState(''),[confirmation,setConfirmation]=useState(''),[creating,setCreating]=useState(false),[error,setError]=useState('')
 const capacity=Math.min(20,Number.isSafeInteger(maxCount)?Math.max(1,maxCount):20,Math.max(0,100-library.wallets.length))
 const busy=creating||library.busy,validCount=/^[1-9]\d*$/.test(count)&&Number(count)<=capacity
 const close=()=>{if(busy)return;setOpen(false);setPassphrase('');setConfirmation('');setError('')}
 const submit=async()=>{
  if(busy)return
  setError('')
  if(!validCount||passphrase.length<12||passphrase!==confirmation){setError('Choose a valid wallet count and matching passphrases of at least 12 characters.');return}
  setCreating(true)
  let created:WalletSummary[]
  try{created=await useWalletLibraryStore.getState().createWallets({count:Number(count),prefix:name.trim(),passphrase})}
  catch(reason){setError(reason instanceof Error?reason.message:'The encrypted wallets could not be created.');return}
  finally{setCreating(false)}
  setPassphrase('');setConfirmation('');setOpen(false);setError('');onCreated(created)
 }
 return <Dialog open={open} onOpenChange={value=>{if(!value){close();return}setName(defaultPrefix);setCount('1');setError('');setOpen(true)}}>
  <DialogTrigger asChild><Button ref={opener} type="button" variant="secondary" size="sm" disabled={disabled||busy||!library.hydrated||library.storageUnavailable||capacity<1}><Plus size={14}/>{title}</Button></DialogTrigger>
  <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-[min(32rem,calc(100vw-2rem))] rounded-xl" onEscapeKeyDown={event=>{if(busy)event.preventDefault()}} onInteractOutside={event=>{if(busy)event.preventDefault()}} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus()}}}>
   <DialogTitle className="text-xl">{title}</DialogTitle>
   <DialogDescription className="text-sm text-muted leading-6">Generate fresh Solana wallets on this device and encrypt them in your existing LaunchPier wallet library.</DialogDescription>
   <form className="space-y-5" onSubmit={event=>{event.preventDefault();void submit()}}>
    <fieldset disabled={busy} className="space-y-5">
     <div className="grid sm:grid-cols-2 gap-4"><div><label className="field-label" htmlFor={`${id}-name`}>Wallet name prefix</label><Input id={`${id}-name`} maxLength={45} required value={name} onChange={event=>setName(event.target.value)}/></div><div><label className="field-label" htmlFor={`${id}-count`}>Wallets to create · 1–{capacity}</label><Input id={`${id}-count`} type="number" min={1} max={capacity} step={1} required value={count} onChange={event=>setCount(event.target.value)}/></div></div>
     <div><label className="field-label" htmlFor={`${id}-passphrase`}>Encryption passphrase</label><Input id={`${id}-passphrase`} type="password" minLength={12} required autoComplete="new-password" value={passphrase} onChange={event=>setPassphrase(event.target.value)}/><p className="field-help">At least 12 characters. Keep this passphrase; LaunchPier cannot reset it.</p></div>
     <div><label className="field-label" htmlFor={`${id}-confirm`}>Confirm passphrase</label><Input id={`${id}-confirm`} type="password" required autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></div>
     <p className="field-help flex gap-2"><ShieldCheck size={16} className="shrink-0"/>Private keys stay in your encrypted browser library. Create a private backup from Wallets after saving.</p>
     {error&&<p role="alert" className="notice notice-error">{error}</p>}
     <Button type="submit" className="w-full" disabled={!validCount||!name.trim()||passphrase.length<12||passphrase!==confirmation}>{busy?<Loader2 size={16} className="animate-spin"/>:<KeyRound size={16}/>} {creating?'Encrypting wallets…':`Create and encrypt ${validCount?count:''} wallet${count==='1'?'':'s'}`}</Button>
    </fieldset>
   </form>
  </DialogContent>
 </Dialog>
}
