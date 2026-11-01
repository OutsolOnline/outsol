import {PublicKey} from '@solana/web3.js'
import {MAX_BUNDLE_WALLETS,type BundleWallet} from './types'
import type {WalletSummary} from '../walletLibrary/types'
import type {LaunchBundleSettings} from '../launchBundle/types'

function distinct(wallets:readonly WalletSummary[]):void{
 if(new Set(wallets.map(value=>value.id)).size!==wallets.length||new Set(wallets.map(value=>value.publicKey)).size!==wallets.length)throw new Error('Choose distinct wallets; duplicate addresses are not allowed.')
 for(const wallet of wallets){const key=new PublicKey(wallet.publicKey);if(key.toBase58()!==wallet.publicKey||!PublicKey.isOnCurve(key.toBytes()))throw new Error('A generated wallet address is invalid.')}
}
/** Rebuilds slots from managed identities without resetting existing allocations. */
export function mergeManagedBundleWallets(previous:readonly BundleWallet[],members:readonly WalletSummary[],creatorId:string):BundleWallet[]{
 distinct(members)
 if(!members.some(wallet=>wallet.id===creatorId))throw new Error('Choose a creator from the selected group.')
 const buyers=members.filter(wallet=>wallet.id!==creatorId)
 if(buyers.length>MAX_BUNDLE_WALLETS)throw new Error('A bundle supports a creator and up to 16 buyers.')
 return Array.from({length:MAX_BUNDLE_WALLETS},(_,index)=>{
  const wallet=buyers[index],old=wallet?previous.find(value=>value.libraryWalletId===wallet.id):undefined
  if(old&&old.publicKey!==wallet.publicKey)throw new Error('A managed wallet address changed. Review the group again.')
  if(old)return {...old,id:index+1,privateKey:'',libraryWalletId:wallet.id,publicKey:wallet.publicKey,isValid:true}
  return {id:index+1,privateKey:'',...(wallet?{libraryWalletId:wallet.id}:{}),publicKey:wallet?.publicKey??null,balance:null,buyAmount:0,mode:'sniper',delaySeconds:5,isValid:!!wallet,sellEnabled:false,sellPercent:100,sellTriggerType:'time',sellDelaySeconds:60,sellProfitMultiplier:2}
 })
}
export function appendLaunchBundleWallets(settings:LaunchBundleSettings,groupId:string,added:readonly WalletSummary[],creatorAddress?:string|null):LaunchBundleSettings{
 distinct(added)
 if(settings.groupId&&settings.groupId!==groupId&&settings.wallets.length)throw new Error('Choose the new group explicitly before replacing the current wallet selection.')
 const next=settings.wallets.map(wallet=>({...wallet})),ids=new Set(next.map(wallet=>wallet.walletId)),addresses=new Set(next.map(wallet=>wallet.publicKey))
 for(const wallet of added){
  if(wallet.publicKey===creatorAddress)continue
  if(ids.has(wallet.id)){if(!next.some(row=>row.walletId===wallet.id&&row.publicKey===wallet.publicKey))throw new Error('A selected wallet address changed.');continue}
  if(addresses.has(wallet.publicKey))throw new Error('Choose distinct buyer addresses.')
  next.push({walletId:wallet.id,publicKey:wallet.publicKey,name:wallet.name,buySol:0,delaySeconds:0});ids.add(wallet.id);addresses.add(wallet.publicKey)
 }
 if(next.length>MAX_BUNDLE_WALLETS)throw new Error('A launch supports up to 16 buyer wallets.')
 return {...settings,groupId,wallets:next}
}
