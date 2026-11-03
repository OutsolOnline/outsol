import {PublicKey} from '@solana/web3.js'
import {parseCreatorFeeSelection} from '../creatorFeeRouting'

export interface CreatorShare {address:string;shareBps:number}
interface BaseInput {version:1;mint:string;payer:string;priorityFeeLamports:string;lookupTable?:string}
export type CreatorOperationInput = BaseInput & (
 {kind:'collect'}|{kind:'distribute'}|{kind:'shares';shares:CreatorShare[]}|{kind:'lookup';addresses:string[]}
)
export interface CreatorOperationIntent {version:1;input:CreatorOperationInput;scope:'wallet-wide'|'mint';lookupAddress?:string;lookupRecentSlot?:number}
export interface CreatorSharingState {address:string;version:number;admin:string;adminRevoked:boolean;shareholders:CreatorShare[]}
export interface CreatorState {
 mint:string;slot:number;checkedAt:number;creator:string;complete:boolean;holderReward:boolean;cashback:boolean;curveFeeLamports:string
 pool?:{address:string;creator:string;feeLamports:string};sharing?:CreatorSharingState;vaultBalanceLamports:string
}
export interface CreatorOperationPreview {
 payerBeforeLamports:string;payerAfterLamports:string;networkFeeLamports:string;maxDebitLamports:string
 existingWrappedSolLamports:string;recipientChanges:{address:string;changeLamports:string}[];lookupRentLamports:string
}
export interface CreatorStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export interface CreatorLocks {request<T>(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>):Promise<T>}

export function exactObject(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Invalid public creator operation.')
 const row=value as Record<string,unknown>
 if(required.some(key=>!Object.hasOwn(row,key))||Object.keys(row).some(key=>![...required,...optional].includes(key)))throw new Error('Unexpected or missing public creator operation field.')
 return row
}
export function creatorAddress(value:unknown,ordinary=false):string{
 if(typeof value!=='string'||value.length>44)throw new Error('Choose a valid Solana address.')
 const key=new PublicKey(value);if(key.toBase58()!==value)throw new Error('Choose a canonical Solana address.')
 if(ordinary)parseCreatorFeeSelection({kind:'wallet',address:value})
 return value
}
export function creatorAmount(value:unknown):string{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,19})$/.test(value)||BigInt(value)>18446744073709551615n)throw new Error('Invalid exact creator operation amount.')
 return value
}
/** Percentages are integers in basis points; names never establish charity identity. */
export function parseCreatorShares(value:unknown,ordinary=true):CreatorShare[]{
 if(!Array.isArray(value)||value.length<1||value.length>10)throw new Error('Choose between one and ten fee recipients.')
 const rows=value.map(item=>{const row=exactObject(item,['address','shareBps']);if(typeof row.shareBps!=='number'||!Number.isInteger(row.shareBps)||row.shareBps<1||row.shareBps>10000)throw new Error('Every share must be a positive whole basis point.');return{address:creatorAddress(row.address,ordinary),shareBps:row.shareBps}})
 if(new Set(rows.map(row=>row.address)).size!==rows.length)throw new Error('Each fee recipient must be distinct.')
 if(rows.reduce((sum,row)=>sum+row.shareBps,0)!==10000)throw new Error('Fee shares must total exactly 100%.')
 return rows
}
export function normalizeCreatorInput(value:unknown):CreatorOperationInput{
 const row=exactObject(value,['version','kind','mint','payer','priorityFeeLamports'],['lookupTable','shares','addresses'])
 if(row.version!==1||!['collect','distribute','shares','lookup'].includes(String(row.kind)))throw new Error('Choose a supported creator operation.')
 const base:BaseInput={version:1,mint:creatorAddress(row.mint),payer:creatorAddress(row.payer,true),priorityFeeLamports:creatorAmount(row.priorityFeeLamports)}
 if(BigInt(base.priorityFeeLamports)>10000000n)throw new Error('Priority fee must be at most 0.01 SOL.')
 if(row.lookupTable!==undefined)base.lookupTable=creatorAddress(row.lookupTable)
 if(row.kind==='shares'){if(Object.hasOwn(row,'addresses'))throw new Error('Unexpected lookup addresses.');return{...base,kind:'shares',shares:parseCreatorShares(row.shares)}}
 if(Object.hasOwn(row,'shares'))throw new Error('Fee shares apply only to a share update.')
 if(row.kind==='lookup'){
  if(base.lookupTable||!Array.isArray(row.addresses)||row.addresses.length<1||row.addresses.length>20)throw new Error('A lookup setup needs one to twenty public accounts.')
  const addresses=row.addresses.map(value=>creatorAddress(value));if(new Set(addresses).size!==addresses.length)throw new Error('Lookup accounts must be distinct.')
  return{...base,kind:'lookup',addresses}
 }
 if(Object.hasOwn(row,'addresses'))throw new Error('Unexpected lookup addresses.')
 return{...base,kind:row.kind as 'collect'|'distribute'}
}
export function creatorOperationScope(input:{kind:string}):'wallet-wide'|'mint'{return input.kind==='collect'?'wallet-wide':'mint'}
export function creatorPercentBps(value:string):number{
 if(!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(value))throw new Error('Use a percentage with at most two decimal places.')
 const [whole,fraction='']=value.split('.'),bps=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 if(bps<1||bps>10000)throw new Error('Each fee share must be above 0% and at most 100%.')
 return bps
}
export function parseCreatorIntent(value:unknown):CreatorOperationIntent{
 const row=exactObject(value,['version','input','scope'],['lookupAddress','lookupRecentSlot']),input=normalizeCreatorInput(row.input)
 if(row.version!==1||row.scope!==creatorOperationScope(input))throw new Error('The creator operation scope changed.')
 const intent:CreatorOperationIntent={version:1,input,scope:creatorOperationScope(input)}
 if(input.kind==='lookup'){
  if(typeof row.lookupRecentSlot!=='number'||!Number.isSafeInteger(row.lookupRecentSlot)||row.lookupRecentSlot<1)throw new Error('Invalid lookup setup slot.')
  intent.lookupAddress=creatorAddress(row.lookupAddress);intent.lookupRecentSlot=row.lookupRecentSlot
 }else if(row.lookupAddress!==undefined||row.lookupRecentSlot!==undefined)throw new Error('Unexpected lookup setup intent.')
 return intent
}
export function creatorStateBinding(state:CreatorState):string{
 return JSON.stringify({mint:state.mint,creator:state.creator,complete:state.complete,holderReward:state.holderReward,cashback:state.cashback,pool:state.pool?{address:state.pool.address,creator:state.pool.creator}:null,sharing:state.sharing??null})
}
