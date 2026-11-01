import {PublicKey} from '@solana/web3.js'
import type {WalletSummary} from '@/lib/walletLibrary/types'

export const SNIPER_PAIRS_KEY='outsol-sniper-pairs-v1'
export const MAX_SNIPER_PAIRS=50
export const MAX_SNIPER_PAIR_RECORD_BYTES=64000
export interface SniperPairInput {name:string;sniperWalletId:string;sniperAddress:string;receiverWalletId:string;receiverAddress:string}
export interface SniperPair extends SniperPairInput {id:string;createdAt:string}
export interface ResolvedSniperPair extends SniperPair {sniper:WalletSummary;receiver:WalletSummary}
export interface SniperPairRecord {version:1;revision:number;pairs:SniperPair[]}
export interface SniperPairStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}

function object(value:unknown,fields:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key))||Object.keys(value).length!==fields.length)throw new Error('Only the specified public pair fields are allowed.')
 return value as Record<string,unknown>
}
export function sniperPairId(value:unknown):string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('Choose wallets with valid public library identities.');return value}
export function sniperPairName(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.trim().length>60||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Use a pair name from 1 to 60 characters.');return value.trim()}
export function sniperPairAddress(value:unknown):string{
 try{if(typeof value!=='string')throw new Error();const key=new PublicKey(value);if(key.toBase58()!==value||!PublicKey.isOnCurve(key.toBytes()))throw new Error();return value}
 catch{throw new Error('Use a canonical Solana wallet address for each pair role.')}
}
const inputFields=['name','sniperWalletId','sniperAddress','receiverWalletId','receiverAddress'] as const
export function validateSniperPairInput(value:unknown):SniperPairInput{
 const row=object(value,inputFields)
 return{name:sniperPairName(row.name),sniperWalletId:sniperPairId(row.sniperWalletId),sniperAddress:sniperPairAddress(row.sniperAddress),receiverWalletId:sniperPairId(row.receiverWalletId),receiverAddress:sniperPairAddress(row.receiverAddress)}
}
export function validateSniperPairs(value:unknown):SniperPair[]{
 if(!Array.isArray(value)||value.length>MAX_SNIPER_PAIRS)throw new Error('Save at most 50 reusable sniper pairs.')
 const rows=value.map(value=>{
  const row=object(value,[...inputFields,'id','createdAt']),input=validateSniperPairInput(Object.fromEntries(inputFields.map(key=>[key,row[key]])))
  if(typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||new Date(row.createdAt).toISOString()!==row.createdAt)throw new Error('A saved pair has an invalid creation time.')
  return{...input,id:sniperPairId(row.id),createdAt:row.createdAt}
 })
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Every pair must have a distinct identity.')
 if(new Set(rows.map(row=>row.name.toLocaleLowerCase('en-US'))).size!==rows.length)throw new Error('Each pair needs a distinct name.')
 const ids=rows.flatMap(row=>[row.sniperWalletId,row.receiverWalletId]),addresses=rows.flatMap(row=>[row.sniperAddress,row.receiverAddress])
 if(new Set(ids).size!==ids.length||new Set(addresses).size!==addresses.length)throw new Error('Every sniper and receiver must be a distinct wallet; a wallet is already used by another pair.')
 return rows
}
export function parseSniperPairRecord(raw:string|null):SniperPairRecord{
 if(raw===null)return{version:1,revision:0,pairs:[]}
 try{
  if(raw.length>MAX_SNIPER_PAIR_RECORD_BYTES)throw new Error()
  const row=object(JSON.parse(raw),['version','revision','pairs'])
  if(row.version!==1||!Number.isSafeInteger(row.revision)||Number(row.revision)<0)throw new Error()
  return{version:1,revision:Number(row.revision),pairs:validateSniperPairs(row.pairs)}
 }catch{throw new Error('Saved sniper pairs cannot be read. Preserve browser storage and wallet backups before continuing.')}
}
/** Pair records remain public. A restored wallet may receive a new local ID;
 * only an exact, unambiguous public-address match can bind that record again. */
export function resolveSniperPairs(pairs:readonly SniperPair[],wallets:readonly WalletSummary[]):ResolvedSniperPair[]{
 const rows=validateSniperPairs(pairs),resolve=(id:string,expected:string):WalletSummary=>{
  const exact=wallets.filter(wallet=>wallet.id===id),matching=wallets.filter(wallet=>wallet.publicKey===expected)
  if(exact.length>1||matching.length>1)throw new Error('Duplicate or ambiguous wallet identities exist. Review the encrypted library.')
  if(exact[0]&&exact[0].publicKey!==expected)throw new Error('A paired wallet identity changed and no longer matches its saved address.')
  const wallet=exact[0]??matching[0]
  if(!wallet)throw new Error('A paired wallet is missing. Import or restore its private backup in Wallets before continuing.')
  sniperPairId(wallet.id);sniperPairAddress(wallet.publicKey)
  return{...wallet}
 }
 const resolved=rows.map(pair=>({...pair,sniper:resolve(pair.sniperWalletId,pair.sniperAddress),receiver:resolve(pair.receiverWalletId,pair.receiverAddress)}))
 const ids=resolved.flatMap(pair=>[pair.sniper.id,pair.receiver.id])
 if(new Set(ids).size!==ids.length)throw new Error('Resolved pair wallets must have distinct identities across every role.')
 return resolved
}
