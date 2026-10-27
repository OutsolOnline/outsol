import type {Keypair} from '@solana/web3.js'
import type {WalletLibraryGroup,WalletSummary} from '@/lib/walletLibrary/types'
export interface BundleSigners {creator:Keypair;wallets:ReadonlyMap<number,Keypair>}
interface LibrarySource {revision:number;storageUnavailable:boolean;groups:WalletLibraryGroup[];wallets:WalletSummary[];getKeypair(id:string):Keypair|null}
/** Holds references only in a runtime closure. Every signing/broadcast check
 * rereads the encrypted library's live unlocked map. */
export function createManagedBundleSource(read:()=>LibrarySource,groupId:string,creatorId:string,buyers:Array<{id:number;libraryWalletId:string;publicKey:string|null}>):()=>BundleSigners {
 const initial=read(),group=initial.groups.find(group=>group.id===groupId),revision=initial.revision
 if(!group||!group.walletIds.includes(creatorId)||buyers.some(buyer=>!group.walletIds.includes(buyer.libraryWalletId)))throw new Error('Choose creator and buyers from the current wallet group.')
 const members=JSON.stringify(group.walletIds),expected=new Map<string,Keypair>(),addresses=new Map(initial.wallets.map(wallet=>[wallet.id,wallet.publicKey]))
 const resolve=():BundleSigners=>{
  const current=read(),liveGroup=current.groups.find(group=>group.id===groupId)
  if(current.storageUnavailable||current.revision!==revision||!liveGroup||JSON.stringify(liveGroup.walletIds)!==members)throw new Error('The wallet library or group changed. Review the group and prepare again.')
  const key=(id:string)=>{
   const value=current.getKeypair(id)
   if(!value||value.publicKey.toBase58()!==addresses.get(id))throw new Error('A selected wallet is locked or changed. Unlock the group and prepare again.')
   const original=expected.get(id)
   if(original&&original!==value)throw new Error('A selected wallet signer changed. Prepare this launch again.')
   expected.set(id,value)
   return value
  }
  const creator=key(creatorId),wallets=new Map(buyers.map(buyer=>{
   const value=key(buyer.libraryWalletId)
   if(value.publicKey.toBase58()!==buyer.publicKey)throw new Error('A selected buyer changed. Prepare this launch again.')
   return [buyer.id,value] as const
  }))
  return {creator,wallets}
 }
 resolve()
 return resolve
}
