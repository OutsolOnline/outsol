import type {BundlerConfig,BundleWallet} from './types'

export const BUNDLE_PRESETS_KEY='outsol-bundle-presets-v1'
type WalletSettings=Pick<BundleWallet,'buyAmount'|'mode'|'delaySeconds'|'sellEnabled'|'sellPercent'|'sellDelaySeconds'>
export interface BundleSettings {
 devBuyAmount:number;bundleMode:BundlerConfig['bundleMode'];sniperMode:BundlerConfig['sniperMode'];naturalDelayMin:number;naturalDelayMax:number;jitoTip:number;slippage:number
 autoSellEnabled:boolean;autoSellDelay:number;autoSellPercent:number;wallets:WalletSettings[]
}
export interface BundlePreset {id:string;name:string;createdAt:string;updatedAt:string;settings:BundleSettings}
interface PresetStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const numeric=(value:unknown,min:number,max:number,label:string)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid preset ${label}.`);return value}
const boolean=(value:unknown)=>{if(typeof value!=='boolean')throw new Error('Invalid preset switch.');return value}
function settings(input:unknown):BundleSettings {
 if(!input||typeof input!=='object')throw new Error('Preset settings cannot be read.')
 const value=input as BundleSettings
 if(!['sniper','natural'].includes(value.bundleMode)||!['block0','after_confirm'].includes(value.sniperMode))throw new Error('Invalid preset execution mode.')
 if(!Array.isArray(value.wallets)||value.wallets.length>16)throw new Error('A preset supports up to 16 wallet rows.')
 const result:BundleSettings={devBuyAmount:numeric(value.devBuyAmount,0,1_000_000,'creator budget'),bundleMode:value.bundleMode,sniperMode:value.sniperMode,naturalDelayMin:numeric(value.naturalDelayMin,0,3600,'minimum interval'),naturalDelayMax:numeric(value.naturalDelayMax,0,3600,'maximum interval'),jitoTip:numeric(value.jitoTip,0,0.1,'tip'),slippage:numeric(value.slippage,0,50,'slippage'),autoSellEnabled:boolean(value.autoSellEnabled),autoSellDelay:numeric(value.autoSellDelay,1,3600,'sell delay'),autoSellPercent:numeric(value.autoSellPercent,1,100,'sell percentage'),wallets:value.wallets.map(wallet=>{
  if(!wallet||!['sniper','delayed'].includes(wallet.mode))throw new Error('Invalid preset wallet timing.')
  return {buyAmount:numeric(wallet.buyAmount,0,1_000_000,'buy budget'),mode:wallet.mode,delaySeconds:numeric(wallet.delaySeconds,0,3600,'buy delay'),sellEnabled:boolean(wallet.sellEnabled),sellPercent:numeric(wallet.sellPercent,1,100,'sell percentage'),sellDelaySeconds:numeric(wallet.sellDelaySeconds,1,3600,'sell delay')}
 })}
 if(result.naturalDelayMax<result.naturalDelayMin)throw new Error('Preset interval range must be ordered.')
 if(result.sniperMode==='block0'&&(result.bundleMode==='natural'||result.wallets.filter(wallet=>wallet.buyAmount>0&&wallet.mode==='sniper').length>3||result.jitoTip<0.000001))throw new Error('Atomic presets allow up to three immediate buyers and require a validator tip. Metadata can reduce this limit.')
 return result
}
/** Whitelist projection: no addresses, wallet references, secrets or artwork. */
export function publicBundleSettings(config:BundlerConfig):BundleSettings {
 return settings({...config,wallets:config.bundleWallets.map(wallet=>({buyAmount:wallet.buyAmount,mode:wallet.mode,delaySeconds:wallet.delaySeconds,sellEnabled:wallet.sellEnabled,sellPercent:wallet.sellPercent,sellDelaySeconds:wallet.sellDelaySeconds}))})
}
export function applyBundleSettings<T extends BundlerConfig>(config:T,input:BundleSettings):T {
 const {wallets,...value}=settings(input)
 return {...config,...value,autoSellTriggerType:'time',bundleWallets:config.bundleWallets.map((wallet,index)=>({...wallet,...(wallets[index]??{buyAmount:0,sellEnabled:false}),sellTriggerType:'time'}))}
}
function publicPreset(input:unknown):BundlePreset {
 if(!input||typeof input!=='object')throw new Error('A saved preset cannot be read.')
 const value=input as BundlePreset
 if(typeof value.id!=='string'||!value.id||value.id.length>80||typeof value.name!=='string'||!value.name.trim()||value.name.length>80||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))throw new Error('A saved preset cannot be read.')
 return {id:value.id,name:value.name.trim(),createdAt:value.createdAt,updatedAt:value.updatedAt,settings:settings(value.settings)}
}
export function readBundlePresets(storage:PresetStorage):{raw:string|null;presets:BundlePreset[]} {
 const raw=storage.getItem(BUNDLE_PRESETS_KEY)
 if(raw===null)return {raw,presets:[]}
 try {
  if(raw.length>200_000)throw new Error('too large')
  const parsed=JSON.parse(raw)
  if(parsed.version!==1||!Array.isArray(parsed.presets)||parsed.presets.length>50)throw new Error('invalid format')
  const presets:BundlePreset[]=parsed.presets.map(publicPreset)
  if(new Set(presets.map(value=>value.id)).size!==presets.length)throw new Error('duplicate ids')
  return {raw,presets}
 }catch{throw new Error('Saved presets cannot be read. Browser data is preserved; recover it before saving new presets.')}
}
export function writeBundlePresets(storage:PresetStorage,presets:BundlePreset[],expectedRaw:string|null):{raw:string;presets:BundlePreset[]} {
 if(storage.getItem(BUNDLE_PRESETS_KEY)!==expectedRaw)throw new Error('Saved presets changed in another tab. Reload presets and try again.')
 if(presets.length>50)throw new Error('Keep at most 50 saved presets.')
 const safe=presets.map(publicPreset)
 if(new Set(safe.map(value=>value.id)).size!==safe.length)throw new Error('Preset IDs must be unique.')
 const raw=JSON.stringify({version:1,presets:safe})
 storage.setItem(BUNDLE_PRESETS_KEY,raw)
 if(storage.getItem(BUNDLE_PRESETS_KEY)!==raw)throw new Error('Preset save could not be verified. Reload presets before continuing.')
 return {raw,presets:safe}
}
const row:WalletSettings={buyAmount:0.01,mode:'sniper',delaySeconds:5,sellEnabled:false,sellPercent:100,sellDelaySeconds:60}
const base:BundleSettings={devBuyAmount:0.01,bundleMode:'sniper',sniperMode:'after_confirm',naturalDelayMin:3,naturalDelayMax:10,jitoTip:0.0003,slippage:20,autoSellEnabled:false,autoSellDelay:30,autoSellPercent:100,wallets:[]}
export const BUILT_IN_BUNDLE_PRESETS=[
 {id:'atomic',name:'Atomic / block zero',description:'Create and up to 3 immediate buyers in a Jito bundle. Metadata may reduce buyer capacity; simulation checks the packet limit. No first-block guarantee.',settings:{...base,sniperMode:'block0' as const,wallets:Array.from({length:3},()=>({...row}))}},
 {id:'confirmed',name:'After confirmation',description:'Confirm token creation, then submit 8 wallet buys sequentially. Each buy uses a fresh native quote.',settings:{...base,wallets:Array.from({length:8},()=>({...row}))}},
 {id:'organic',name:'Organic intervals',description:'Confirm creation, then space 16 wallet buys by a random 3–10 second gap. Browser-only timing; keep this page open.',settings:{...base,bundleMode:'natural' as const,wallets:Array.from({length:16},()=>({...row}))}},
] satisfies Array<{id:string;name:string;description:string;settings:BundleSettings}>
