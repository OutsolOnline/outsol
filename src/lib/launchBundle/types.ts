import {PublicKey} from '@solana/web3.js'

export interface LaunchBundleWallet {walletId:string;publicKey:string;name:string;buySol:number;delaySeconds:number;transferTo?:string}
export interface LaunchBundleSettings {
 version:1;mode:'manual'|'block0'|'organic';groupId:string|null;wallets:LaunchBundleWallet[];intervalMinSeconds:number;intervalMaxSeconds:number
}
export const DEFAULT_LAUNCH_BUNDLE_SETTINGS:LaunchBundleSettings={version:1,mode:'manual',groupId:null,wallets:[],intervalMinSeconds:3,intervalMaxSeconds:10}
export function launchBundleModeLabel(mode:LaunchBundleSettings['mode']):string{return mode==='block0'?'Block-0':mode==='organic'?'Organic':'Manual'}
export function validateLaunchBundleSettings(settings:LaunchBundleSettings):string[]{
 const errors:string[]=[]
 if(!settings||typeof settings!=='object'||settings.version!==1||!['manual','block0','organic'].includes(settings.mode))return ['Choose a supported launch execution mode.']
 if(settings.groupId!==null&&(typeof settings.groupId!=='string'||!settings.groupId.trim()||settings.groupId.length>100))errors.push('Choose a valid wallet group.')
 if(!Array.isArray(settings.wallets)||settings.wallets.length>16)return [...errors,'Choose at most 16 buyer wallets.']
 const ids=new Set<string>(),addresses=new Set<string>()
 for(const wallet of settings.wallets){
  if(!wallet||typeof wallet.walletId!=='string'||!wallet.walletId.trim()||wallet.walletId.length>100||typeof wallet.name!=='string'||wallet.name.length>100){errors.push('A buyer wallet reference is invalid.');continue}
  try{if(typeof wallet.publicKey!=='string'||new PublicKey(wallet.publicKey).toBase58()!==wallet.publicKey||!PublicKey.isOnCurve(new PublicKey(wallet.publicKey).toBytes()))throw new Error()}catch{errors.push('Choose a valid buyer public address.')}
  if(wallet.transferTo!==undefined){
   if(settings.mode!=='block0')errors.push('Token destinations require Block-0 mode.')
   try{if(typeof wallet.transferTo!=='string'||new PublicKey(wallet.transferTo).toBase58()!==wallet.transferTo||!PublicKey.isOnCurve(new PublicKey(wallet.transferTo).toBytes()))throw new Error();if(wallet.transferTo===wallet.publicKey)throw new Error()}catch{errors.push('Choose a valid receiving wallet different from the buyer.')}
  }
  if(ids.has(wallet.walletId)||addresses.has(wallet.publicKey))errors.push('Every buyer wallet must have a unique identity.')
  ids.add(wallet.walletId);addresses.add(wallet.publicKey)
  if(!Number.isFinite(wallet.buySol)||wallet.buySol<0||wallet.buySol>1000||!Number.isSafeInteger(Math.round(wallet.buySol*1e9)))errors.push('Each buyer budget must be 0–1,000 SOL.')
  if(!Number.isFinite(wallet.delaySeconds)||wallet.delaySeconds<0||wallet.delaySeconds>3600)errors.push('Each buyer delay must be 0–3,600 seconds.')
 }
 const active=settings.wallets.filter(wallet=>wallet?.buySol>0)
 if(active.length&&!settings.groupId)errors.push('Choose the encrypted wallet group for these buyers.')
 if(settings.mode==='block0'&&active.length>3)errors.push('Block-0 supports at most three immediate buyer wallets; packet size can reduce this limit.')
 if(!Number.isFinite(settings.intervalMinSeconds)||!Number.isFinite(settings.intervalMaxSeconds)||settings.intervalMinSeconds<0||settings.intervalMaxSeconds<settings.intervalMinSeconds||settings.intervalMaxSeconds>3600)errors.push('Organic intervals must be ordered between 0 and 3,600 seconds.')
 return errors
}
/** Public values only; absent legacy settings alone restore the default. */
export function parseLaunchBundleSettings(value:unknown):LaunchBundleSettings{
 if(value===undefined)return {...DEFAULT_LAUNCH_BUNDLE_SETTINGS,wallets:[]}
 const fields=['version','mode','groupId','wallets','intervalMinSeconds','intervalMaxSeconds']
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('Launch bundle settings cannot be read.')
 const input=value as LaunchBundleSettings
 if(!Array.isArray(input.wallets))throw new Error('Buyer wallets cannot be read.')
 const walletFields=['walletId','publicKey','name','buySol','delaySeconds','transferTo']
 if(input.wallets.some(wallet=>!wallet||typeof wallet!=='object'||Object.keys(wallet).some(key=>!walletFields.includes(key))))throw new Error('Only public buyer settings can be saved.')
 const result:LaunchBundleSettings={version:input.version,mode:input.mode,groupId:input.groupId,wallets:input.wallets.map(wallet=>({walletId:wallet.walletId,publicKey:wallet.publicKey,name:wallet.name,buySol:wallet.buySol,delaySeconds:wallet.delaySeconds,...(wallet.transferTo===undefined?{}:{transferTo:wallet.transferTo})})),intervalMinSeconds:input.intervalMinSeconds,intervalMaxSeconds:input.intervalMaxSeconds}
 const errors=validateLaunchBundleSettings(result);if(errors.length)throw new Error(errors.join(' '))
 return result
}
