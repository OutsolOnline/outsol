import type {WalletSummary} from '../walletLibrary/types'
import type {WalletControlScope} from '../bundler/walletControls'
import type {RelayRoute} from '../relay/types'
import type {ResolvedSniperPair} from './catalog'

/** A pair operation never derives its sale targets from a generic wallet
 * selection. Public identities are copied and rechecked against the live scope
 * at review, quote refresh and signing boundaries. */
export function createSniperPairPolicy(pairs:readonly ResolvedSniperPair[],scope:WalletControlScope){
 if(pairs.length>50)throw new Error('Choose at most 50 sniper pairs.')
 const rows=pairs.map(pair=>({id:pair.id,name:pair.name,createdAt:pair.createdAt,sniper:{...pair.sniper},receiver:{...pair.receiver},sniperAddress:pair.sniperAddress,receiverAddress:pair.receiverAddress}))
 const ids=new Set<string>(),addresses=new Set<string>(),pairIds=new Set<string>()
 for(const row of rows){
  if(pairIds.has(row.id))throw new Error('Choose distinct sniper pairs.');pairIds.add(row.id)
  for(const wallet of [row.sniper,row.receiver]){if(ids.has(wallet.id)||addresses.has(wallet.publicKey))throw new Error('Each pair needs distinct sniper and receiver wallets.');ids.add(wallet.id);addresses.add(wallet.publicKey)}
  if(row.sniper.publicKey!==row.sniperAddress||row.receiver.publicKey!==row.receiverAddress)throw new Error('A resolved pair wallet address changed.')
 }
 const live=(wallet:WalletSummary,role:'buyer'|'recipient')=>{scope.assertCurrent();const current=scope.resolveWallet(wallet.id);if(!current||current.publicKey!==wallet.publicKey||scope.roles[wallet.id]!==role)throw new Error('The pair source or receiver changed. Review again.');return{...wallet}}
 const selected=(values?:readonly string[])=>{scope.assertCurrent();if(values&&(new Set(values).size!==values.length||values.some(id=>!pairIds.has(id))))throw new Error('A selected sniper pair changed.');return values?rows.filter(row=>values.includes(row.id)):rows}
 const receivers=(values?:readonly string[])=>selected(values).map(row=>live(row.receiver,'recipient'))
 const sources=(values?:readonly string[])=>selected(values).map(row=>live(row.sniper,'buyer'))
 const assertSaleRows=(sales:readonly {walletId:string;payer:string}[])=>{scope.assertCurrent();for(const sale of sales){const pair=rows.find(row=>row.receiver.id===sale.walletId&&row.receiver.publicKey===sale.payer);if(!pair)throw new Error('Pair sales can only spend from their token receiver wallets.');live(pair.receiver,'recipient')}}
 const assertTransfer=(sourceId:string,receiverId:string,sourceAddress:string,receiverAddress:string)=>{scope.assertCurrent();const pair=rows.find(row=>row.sniper.id===sourceId&&row.receiver.id===receiverId&&row.sniper.publicKey===sourceAddress&&row.receiver.publicKey===receiverAddress);if(!pair)throw new Error('The reviewed transfer must use the exact sniper and receiver in one pair.');live(pair.sniper,'buyer');live(pair.receiver,'recipient')}
 const routes=():RelayRoute[]=>{scope.assertCurrent();return rows.map(row=>{live(row.sniper,'buyer');live(row.receiver,'recipient');return{id:row.id,name:row.name,sourceWalletId:row.sniper.id,destinationWalletId:row.receiver.id,createdAt:row.createdAt,updatedAt:row.createdAt}})}
 receivers();sources()
 return{receivers,sources,assertSaleRows,assertTransfer,routes}
}
