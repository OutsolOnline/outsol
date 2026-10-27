import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {MAX_WALLET_BATCH} from './types'
export interface ParsedWalletImport {secretKeyBase58:string;publicKey:string;name?:string}
/** Private return values are transient import material, never a persistence format. */
export function parseWalletImport(text:string,existingPublicKeys:string[]=[]):ParsedWalletImport[]{
 if(typeof text!=='string'||text.length>131072||new TextEncoder().encode(text).length>131072)throw new Error('Wallet import must be no larger than 128 KB.')
 const input=text.replace(/^\uFEFF/,'').trim();if(!input)throw new Error('Paste at least one private key or choose a keypair JSON file.')
 let items:unknown[]
 if(input.startsWith('[')||input.startsWith('{')){
  let value:unknown;try{value=JSON.parse(input)}catch{throw new Error('The wallet JSON could not be parsed.')}
  if(Array.isArray(value))items=value.every(item=>typeof item==='number')?[value]:value
  else if(value&&typeof value==='object'&&Array.isArray((value as {wallets?:unknown}).wallets)){
   const record=value as {wallets:unknown[];creator?:unknown};items=[...(record.creator!==undefined?[record.creator]:[]),...record.wallets]
  }else items=[value]
 }else items=input.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)
 if(!items.length||items.length>MAX_WALLET_BATCH)throw new Error(`Import between one and ${MAX_WALLET_BATCH} wallets at a time.`)
 const seen=new Set(existingPublicKeys)
 return items.map((value,index)=>{
  let secret:unknown=value,expected:unknown,name:unknown
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   const object=value as Record<string,unknown>;secret=object.secretKey??object.privateKey;expected=object.publicKey;name=object.name
  }
  let key:Keypair
  try{
   let bytes:Uint8Array
   if(Array.isArray(secret)){
    if(secret.length!==64||secret.some(item=>typeof item!=='number'||!Number.isInteger(item)||item<0||item>255))throw new Error()
    bytes=new Uint8Array(secret)
   }else{if(typeof secret!=='string'||secret.length>100)throw new Error();bytes=bs58.decode(secret.trim());if(bytes.length!==64)throw new Error()}
   key=Keypair.fromSecretKey(bytes)
  }catch{throw new Error(`Wallet ${index+1} is invalid. Use a Base58 private key or a 64-byte keypair JSON export.`)}
  const publicKey=key.publicKey.toBase58()
  if(expected!==undefined&&(typeof expected!=='string'||expected!==publicKey))throw new Error(`Wallet ${index+1} does not match its exported public address.`)
  if(seen.has(publicKey))throw new Error(`Wallet ${index+1} is a duplicate or is already in your wallet library.`)
  seen.add(publicKey)
  if(name!==undefined&&(typeof name!=='string'||!name.trim()||name.trim().length>60||/[\u0000-\u001f\u007f]/.test(name)))throw new Error(`Wallet ${index+1} has an invalid name.`)
  return {secretKeyBase58:bs58.encode(key.secretKey),publicKey,...(typeof name==='string'?{name:name.trim()}:{})}
 })
}
