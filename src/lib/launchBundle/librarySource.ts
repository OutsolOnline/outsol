import type {Keypair} from '@solana/web3.js'
import {parseLaunchBundleSettings,type LaunchBundleSettings} from './types'

interface BuyerLibrary {
 revision:number
 storageUnavailable:boolean
 groups:readonly {id:string;walletIds:readonly string[]}[]
 wallets:readonly {id:string;publicKey:string}[]
 getKeypair:(id:string)=>Keypair|null
}

/** Captures only runtime references. No key is copied into public launch settings. */
export function createLaunchBuyerSource(read:()=>BuyerLibrary,settings:LaunchBundleSettings):(walletId:string)=>Keypair|null{
 const approved=parseLaunchBundleSettings(settings).wallets.filter(wallet=>wallet.buySol>0)
 const initial=read(),revision=initial.revision,group=initial.groups.find(value=>value.id===settings.groupId)
 if(approved.length&&(initial.storageUnavailable||!group||approved.some(wallet=>!group.walletIds.includes(wallet.walletId))))throw new Error('The selected wallet group is unavailable or changed. Review the buyer wallets.')
 const members=JSON.stringify(group?.walletIds),keys=new Map<string,Keypair>()
 const resolve=(id:string):Keypair=>{
  const row=approved.find(wallet=>wallet.walletId===id)
  if(!row)throw new Error('This buyer was not selected in the approved launch plan.')
  const current=read(),liveGroup=current.groups.find(value=>value.id===settings.groupId)
  if(current.storageUnavailable||current.revision!==revision||!liveGroup||JSON.stringify(liveGroup.walletIds)!==members)throw new Error('The wallet library or selected group changed. Prepare the launch again.')
  const key=current.getKeypair(id),wallet=current.wallets.find(value=>value.id===id),original=keys.get(id)
  if(!key||wallet?.publicKey!==row.publicKey||key.publicKey.toBase58()!==row.publicKey||(original&&original!==key))throw new Error('A selected buyer wallet is locked or changed. Unlock and prepare again.')
  keys.set(id,key)
  return key
 }
 approved.forEach(wallet=>resolve(wallet.walletId))
 return resolve
}
