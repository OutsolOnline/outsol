'use client'

import {useCallback,useEffect,useId,useRef,useState} from 'react'
import {Download,KeyRound} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '@/components/ui/dialog'
import {buildPrivateWalletBackup,type PrivateWalletBackupFormat,type WalletPrivateBackupSource} from '@/lib/walletLibrary/privateBackup'

export interface PrivateWalletBackupProps {
 wallets:readonly WalletPrivateBackupSource[]
 label?:string
 disabled?:boolean
 revision?:number|string
}
const short=(address:string)=>`${address.slice(0,6)}…${address.slice(-6)}`
function allAvailable(wallets:readonly WalletPrivateBackupSource[]):boolean {
 try{return wallets.length>0&&wallets.every(wallet=>wallet.readKeypair()?.publicKey.toBase58()===wallet.address)}catch{return false}
}

/** Only public selection and approval state enter React. Private export material
 * is derived synchronously inside the explicit download action and stays local. */
export function PrivateWalletBackup({wallets,label='Export private backup',disabled=false,revision=0}:PrivateWalletBackupProps){
 const id=useId(),opener=useRef<HTMLButtonElement>(null)
 const [open,setOpen]=useState(false),[format,setFormat]=useState<PrivateWalletBackupFormat>('keypair'),[approved,setApproved]=useState(false),[error,setError]=useState('')
 const identity=JSON.stringify(wallets.map(wallet=>({id:wallet.id,name:wallet.name,address:wallet.address})))
 const opened=useRef<{identity:string;revision:number|string}|null>(null)
 const close=useCallback(()=>{setOpen(false);setApproved(false);setFormat('keypair');setError('');opened.current=null},[])
 useEffect(()=>{
  if(!open)return
  const check=()=>{
   if(disabled||opened.current?.identity!==identity||opened.current?.revision!==revision||!allAvailable(wallets)){
    close();setError('The wallet selection was locked or changed. Nothing was exported.')
   }
  }
  check()
  const timer=window.setInterval(check,250)
  return()=>window.clearInterval(timer)
 },[open,identity,revision,disabled,wallets,close])
 const download=()=>{
  if(!approved||disabled||opened.current?.identity!==identity||opened.current?.revision!==revision)return
  setError('')
  try{
   const file=buildPrivateWalletBackup(wallets,format)
   // The object URL is an opaque local Blob handle, never a key-bearing URL.
   const url=URL.createObjectURL(new Blob([file.content],{type:file.mimeType})),anchor=document.createElement('a')
   try{anchor.href=url;anchor.download=file.filename;anchor.style.display='none';document.body.appendChild(anchor);anchor.click()}
   finally{anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),2000)}
   close()
  }catch(reason){setApproved(false);setError(reason instanceof Error?reason.message:'The private backup could not be prepared. Nothing was exported.')}
 }
 return <div className="min-w-0">
  <Dialog open={open} onOpenChange={next=>{
   if(!next){close();return}
   setApproved(false);setFormat('keypair');setError('')
   if(disabled||!allAvailable(wallets)){setError('Unlock every selected wallet in this bundle before exporting a private backup.');return}
   opened.current={identity,revision};setOpen(true)
  }}>
   <DialogTrigger asChild><Button ref={opener} variant="secondary" size="sm" type="button" disabled={disabled||!wallets.length}><Download size={14}/>{label}</Button></DialogTrigger>
   <DialogContent className="max-h-[90dvh] max-w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-xl" onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus()}}}>
    <DialogTitle className="text-xl flex items-center gap-2"><KeyRound size={19}/>Private wallet backup</DialogTitle>
    <DialogDescription className="text-sm text-muted leading-6">Download {wallets.length===1?'this wallet’s':`all ${wallets.length} wallets’`} signing material to this device. Anyone with the downloaded file can spend these wallets. Keep it offline and private.</DialogDescription>
    <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border" aria-label="Wallets included in the private backup">{wallets.map(wallet=><div className="px-4 py-3 flex items-start justify-between gap-3 text-sm" key={wallet.id}><span>{wallet.name}</span><span className="font-mono text-xs text-muted break-all" title={wallet.address}>{short(wallet.address)}</span></div>)}</div>
    <div><label className="field-label" htmlFor={`${id}-format`}>Download format</label><select id={`${id}-format`} className="w-full min-h-11 rounded-lg border border-border bg-background px-3 text-sm" value={format} onChange={event=>{setFormat(event.target.value as PrivateWalletBackupFormat);setApproved(false)}}><option value="keypair">Solana keypair JSON · 64-byte secret keys</option><option value="base58">Base58 private keys</option></select><p className="field-help">{wallets.length===1?'A single keypair download is a standard Solana CLI JSON array.':'The JSON backup includes every selected wallet name, public address and chosen private-key format. Import up to 20 wallets at a time when restoring.'}</p></div>
    <p className="field-help">The download is unencrypted. Your existing encrypted library remains protected by its passphrase. OutSol never uploads these private keys; keep the downloaded file on a private device.</p>
    <label className="text-sm text-muted leading-6 flex items-start gap-3"><input type="checkbox" checked={approved} onChange={event=>setApproved(event.target.checked)} className="mt-1 accent-[#A4DAC5] shrink-0"/>I understand this file grants full access to these wallets and will keep it private.</label>
    {error&&<p role="alert" className="notice notice-error">{error}</p>}
    <div className="flex flex-wrap gap-3 justify-end"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="button" disabled={!approved||disabled} onClick={download}><Download size={15}/>Download {wallets.length===1?'wallet':'all wallets'}</Button></div>
   </DialogContent>
  </Dialog>
  {!open&&error&&<p role="alert" className="text-xs text-red-200 mt-2 max-w-sm">{error}</p>}
 </div>
}
