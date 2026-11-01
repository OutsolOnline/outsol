import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {buildPrivateWalletBackup} from '@/lib/walletLibrary/privateBackup'
import type {WalletSummary} from '@/lib/walletLibrary/types'
import {resolveSniperPairs,sniperPairAddress,sniperPairName,validateSniperPairs,type ResolvedSniperPair} from './catalog'

const MAX_BYTES=131072
const warning='Unencrypted private session backup. Anyone with this file can spend every included wallet. Keep it offline and private.'
export interface SniperSessionPair {name:string;sniperAddress:string;receiverAddress:string}
export interface SniperSessionBackupInput {name:string;pairs:readonly ResolvedSniperPair[];deployer?:WalletSummary;readKeypair:(id:string)=>Keypair|null}
export interface ParsedSniperSessionBackup {name:string;pairs:SniperSessionPair[];deployerAddress?:string;wallets:{name:string;publicKey:string;privateKey:string}[]}
export interface SniperSessionBackupFile {filename:string;mimeType:'application/json';content:string}

function strict(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.prototype.hasOwnProperty.call(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw new Error('The session backup has unknown or missing fields.')
 return value as Record<string,unknown>
}
function publicPairs(value:unknown):SniperSessionPair[]{
 if(!Array.isArray(value)||!value.length||value.length>50)throw new Error('A session contains between one and 50 distinct sniper pairs.')
 const pairs=value.map(row=>{const input=strict(row,['name','sniperAddress','receiverAddress']);return{name:sniperPairName(input.name),sniperAddress:sniperPairAddress(input.sniperAddress),receiverAddress:sniperPairAddress(input.receiverAddress)}})
 validateSniperPairs(pairs.map((pair,index)=>({...pair,id:`session-pair-${index}`,sniperWalletId:pair.sniperAddress,receiverWalletId:pair.receiverAddress,createdAt:'1970-01-01T00:00:00.000Z'})))
 return pairs
}
function references(pairs:SniperSessionPair[],deployerAddress?:string):Set<string>{
 const values=pairs.flatMap(pair=>[pair.sniperAddress,pair.receiverAddress]);if(deployerAddress){if(values.includes(deployerAddress))throw new Error('The deployer must be distinct from every sniper and receiver.');values.push(deployerAddress)}
 if(values.length>100)throw new Error('A private session backup supports at most 100 wallets.')
 return new Set(values)
}
function publicSnapshot(input:SniperSessionBackupInput){
 if(!Array.isArray(input.pairs)||!input.pairs.length||input.pairs.length>50)throw new Error('Select between one and 50 sniper pairs.')
 const stored=input.pairs.map(pair=>({id:pair.id,name:pair.name,sniperWalletId:pair.sniperWalletId,sniperAddress:pair.sniperAddress,receiverWalletId:pair.receiverWalletId,receiverAddress:pair.receiverAddress,createdAt:pair.createdAt})),wallets=input.pairs.flatMap(pair=>[pair.sniper,pair.receiver])
 resolveSniperPairs(stored,wallets)
 for(const pair of input.pairs)if(pair.sniper?.publicKey!==pair.sniperAddress||pair.receiver?.publicKey!==pair.receiverAddress)throw new Error('A resolved wallet does not match its saved pair role.')
 const name=sniperPairName(input.name),pairs=publicPairs(input.pairs.map(pair=>({name:pair.name,sniperAddress:pair.sniperAddress,receiverAddress:pair.receiverAddress}))),deployerAddress=input.deployer?sniperPairAddress(input.deployer.publicKey):undefined
 references(pairs,deployerAddress)
 const all=input.deployer?[...wallets,input.deployer]:wallets
 return{name,pairs,...(deployerAddress?{deployerAddress}:{}),wallets:all.map(wallet=>({id:wallet.id,name:sniperPairName(wallet.name),publicKey:sniperPairAddress(wallet.publicKey)}))}
}
/** Derives one complete private file synchronously for an explicit local
 * download. The caller must never persist or upload its content. */
export function buildSniperSessionBackup(input:SniperSessionBackupInput):SniperSessionBackupFile{
 const snapshot=publicSnapshot(input),file=buildPrivateWalletBackup(snapshot.wallets.map(wallet=>({id:wallet.id,name:wallet.name,address:wallet.publicKey,readKeypair:()=>input.readKeypair(wallet.id)})),'keypair')
 const privateFile=JSON.parse(file.content) as {wallets:{name:string;publicKey:string;secretKey:number[]}[]}
 try{
  if(JSON.stringify(publicSnapshot(input))!==JSON.stringify(snapshot))throw new Error('The session or its wallet roles changed. Nothing was exported.')
  const content=JSON.stringify({version:1,type:'outsol-sniper-session',name:snapshot.name,createdAt:new Date().toISOString(),warning,pairs:snapshot.pairs,...(snapshot.deployerAddress?{deployerAddress:snapshot.deployerAddress}:{}),wallets:privateFile.wallets},null,2)+'\n'
  if(new TextEncoder().encode(content).length>MAX_BYTES)throw new Error('The private session backup exceeds 128 KB. Export fewer pairs in this file.')
  const slug=snapshot.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,45)||'session'
  return{filename:`outsol-${slug}-sniper-session.json`,mimeType:'application/json',content}
 }finally{privateFile.wallets.forEach(wallet=>wallet.secretKey.fill(0))}
}
/** The private return values are transient material for encrypted import in
 * batches of twenty. Only public pair roles belong in the reusable catalog. */
export function parseSniperSessionBackup(text:string):ParsedSniperSessionBackup{
 if(typeof text!=='string'||text.length>MAX_BYTES||new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('Session imports must be no larger than 128 KB.')
 let value:unknown;try{value=JSON.parse(text.replace(/^\uFEFF/,'').trim())}catch{throw new Error('The session backup JSON could not be parsed.')}
 const row=strict(value,['version','type','name','createdAt','warning','pairs','wallets'],['deployerAddress'])
 if(row.version!==1||row.type!=='outsol-sniper-session'||row.warning!==warning||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||new Date(row.createdAt).toISOString()!==row.createdAt)throw new Error('The session backup format is invalid or unsupported.')
 const name=sniperPairName(row.name),pairs=publicPairs(row.pairs),deployerAddress=row.deployerAddress===undefined?undefined:sniperPairAddress(row.deployerAddress),expected=references(pairs,deployerAddress)
 if(!Array.isArray(row.wallets)||!row.wallets.length||row.wallets.length>100)throw new Error('A private session backup supports between one and 100 wallets.')
 const seen=new Set<string>(),wallets=row.wallets.map((value,index)=>{
  const wallet=strict(value,['name','publicKey','secretKey']),publicKey=sniperPairAddress(wallet.publicKey),walletName=sniperPairName(wallet.name),material=wallet.secretKey
  if(seen.has(publicKey))throw new Error('The backup contains duplicate wallet addresses.');seen.add(publicKey)
  if(!expected.has(publicKey))throw new Error('The session backup contains an extra, unreferenced wallet.')
  if(!Array.isArray(material)||material.length!==64||material.some(byte=>typeof byte!=='number'||!Number.isInteger(byte)||byte<0||byte>255))throw new Error(`Wallet ${index+1} has an invalid 64-byte private key.`)
  const bytes=Uint8Array.from(material)
  try{
   let key:Keypair;try{key=Keypair.fromSecretKey(bytes)}catch{throw new Error(`Wallet ${index+1} has an invalid private key.`)}
   if(key.publicKey.toBase58()!==publicKey)throw new Error(`Wallet ${index+1} does not match its declared public address.`)
   return{name:walletName,publicKey,privateKey:bs58.encode(bytes)}
  }finally{bytes.fill(0);material.fill(0)}
 })
 if(expected.size!==seen.size||[...expected].some(address=>!seen.has(address)))throw new Error('The session backup is missing a referenced sniper, receiver or deployer wallet.')
 return{name,pairs,...(deployerAddress?{deployerAddress}:{}),wallets}
}
