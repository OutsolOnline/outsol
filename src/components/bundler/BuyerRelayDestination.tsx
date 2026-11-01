'use client'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {CreateManagedWallets} from '@/components/wallet/CreateManagedWallets'
import {LaunchTransferDestination} from '@/components/launch/steps/LaunchTokenTransfers'

export function BuyerRelayDestination({id,buyerName,buyerAddress,value,disabled,onChange}:{id:string;buyerName:string;buyerAddress?:string|null;value:string;disabled:boolean;onChange:(address:string)=>void}){
 const library=useWalletLibraryStore(),chosen=library.wallets.find(wallet=>wallet.publicKey===value)
 return <div className="min-w-0 rounded-lg border border-border bg-background/30 p-3 space-y-3"><div><label className="field-label" htmlFor={`${id}-saved`}>Relay recipient for {buyerName}</label><select id={`${id}-saved`} className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={chosen?.id||''} disabled={disabled} onChange={event=>onChange(library.wallets.find(wallet=>wallet.id===event.target.value)?.publicKey||'')}><option value="">{value&&!chosen?'Custom public address':'Keep purchased tokens in buyer'}</option>{library.wallets.filter(wallet=>wallet.publicKey!==buyerAddress).map(wallet=><option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.publicKey.slice(0,6)}…{wallet.publicKey.slice(-4)}</option>)}</select></div>
  <LaunchTransferDestination id={id} buyerName={buyerName} value={value} disabled={disabled} onChange={onChange}/>
  <CreateManagedWallets title={`Generate recipient for ${buyerName}`} defaultPrefix={`${buyerName} recipient`.slice(0,45)} maxCount={1} disabled={disabled} onCreated={created=>{if(created[0])onChange(created[0].publicKey)}}/>
  {chosen&&<p className="field-help">You control this recipient through the encrypted wallet library. Its keypair and sales are available in Bundle wallet controls.</p>}
 </div>
}
