import {Keypair,PublicKey} from '@solana/web3.js'
import bs58 from 'bs58'

export interface WalletPrivateBackupSource {
 id:string
 name:string
 address:string
 readKeypair:()=>Keypair|null
}
export type PrivateWalletBackupFormat='keypair'|'base58'
export interface PrivateWalletBackupFile {filename:string;mimeType:'application/json'|'text/plain';content:string}

interface ReviewedWallet extends WalletPrivateBackupSource {}
const warning='Private wallet backup. Anyone with this file can spend these wallets. Keep it offline and private.'
function reviewedWallets(sources:readonly WalletPrivateBackupSource[]):ReviewedWallet[]{
 if(!Array.isArray(sources)||sources.length<1||sources.length>100)throw new Error('Select between one and 100 wallets for a private backup.')
 const identities=new Set<string>(),addresses=new Set<string>()
 return sources.map(source=>{
  if(!source||typeof source.id!=='string'||!source.id||source.id.length>100||typeof source.name!=='string'||!source.name.trim()||source.name.trim().length>60||/[\u0000-\u001f\u007f]/.test(source.name)||typeof source.address!=='string'||typeof source.readKeypair!=='function')throw new Error('Choose named wallets from this bundle before exporting.')
  let address:string
  try{address=new PublicKey(source.address).toBase58();if(address!==source.address)throw new Error()}catch{throw new Error('A reviewed wallet address is invalid.')}
  if(identities.has(source.id)||addresses.has(address))throw new Error('Choose distinct wallets; duplicate private backups are not allowed.')
  identities.add(source.id);addresses.add(address)
  return {id:source.id,name:source.name.trim(),address,readKeypair:source.readKeypair}
 })
}
function secretFor(wallet:ReviewedWallet):Uint8Array {
 let key:Keypair|null
 try{key=wallet.readKeypair()}catch{throw new Error('Unlock every selected wallet before downloading a private backup.')}
 if(!key)throw new Error('Unlock every selected wallet before downloading a private backup.')
 let bytes:Uint8Array
 try{bytes=new Uint8Array(key.secretKey);const verified=Keypair.fromSecretKey(bytes);if(verified.publicKey.toBase58()!==wallet.address||key.publicKey.toBase58()!==wallet.address)throw new Error()}
 catch{throw new Error('A private key does not match its reviewed wallet address. Nothing was exported.')}
 return bytes
}
const filenameName=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,45)||'wallet'

/** Transient private material for an explicit local download. Never persist,
 * log, send to a server or place this content in a route or query string. */
export function buildPrivateWalletBackup(sources:readonly WalletPrivateBackupSource[],format:PrivateWalletBackupFormat):PrivateWalletBackupFile {
 if(format!=='keypair'&&format!=='base58')throw new Error('Choose keypair JSON or Base58 private-key format.')
 const reviewed=reviewedWallets(sources),material:Uint8Array[]=[]
 try{
  for(const wallet of reviewed)material.push(secretFor(wallet))
  // Readers may invalidate a sibling wallet while resolving another key. Check
  // every reviewed identity again before returning any complete backup file.
  const current=reviewedWallets(sources)
  if(current.length!==reviewed.length||current.some((wallet,index)=>wallet.id!==reviewed[index].id||wallet.name!==reviewed[index].name||wallet.address!==reviewed[index].address))throw new Error('The reviewed wallet selection changed. Nothing was exported.')
  for(let index=0;index<reviewed.length;index++){
   const fresh=secretFor(current[index])
   try{if(fresh.length!==material[index].length||fresh.some((byte,offset)=>byte!==material[index][offset]))throw new Error('A selected wallet changed while preparing its private backup.')}
   finally{fresh.fill(0)}
  }
  if(reviewed.length===1){
   const stem=`outsol-${filenameName(reviewed[0].name)}-${reviewed[0].address.slice(0,8).toLowerCase()}`
   return format==='keypair'
    ?{filename:`${stem}-keypair.json`,mimeType:'application/json',content:JSON.stringify(Array.from(material[0]),null,2)+'\n'}
    :{filename:`${stem}-private-key.txt`,mimeType:'text/plain',content:bs58.encode(material[0])+'\n'}
  }
  const wallets=reviewed.map((wallet,index)=>({name:wallet.name,publicKey:wallet.address,...(format==='keypair'?{secretKey:Array.from(material[index])}:{privateKey:bs58.encode(material[index])})}))
  return {filename:`outsol-wallets-${wallets.length}-${format==='keypair'?'keypairs':'private-keys'}.json`,mimeType:'application/json',content:JSON.stringify({version:1,warning,wallets},null,2)+'\n'}
 }finally{material.forEach(bytes=>bytes.fill(0))}
}
