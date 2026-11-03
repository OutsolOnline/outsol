import {createLaunchDraft,loadLaunchDrafts,saveLaunchDraft,type LaunchDraft,type DraftStorage} from './launchDrafts'
import {DEFAULT_LAUNCH_CONFIG} from './launchConfig'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS,parseLaunchBundleSettings} from './launchBundle/types'
import {artworkToDataUri,saveArtwork,validateArtwork} from './artworkLibrary'
import type {TokenMetadata} from './pumpfun/types'
import {PublicKey} from '@solana/web3.js'
import {parseCreatorFeeSelection,type CreatorFeeSelection} from './creatorFeeRouting'
import type {LaunchBundleSettings} from './launchBundle/types'

export const MAX_KIT_CHARACTERS=7_100_000
export interface KitRole {slot:string;role:'deployer'|'creator-fee'|'buyer'|'receiver';buySol?:number;delaySeconds?:number;sourceSlot?:string}
export interface LaunchKit {version:1;type:'outsol-launch-kit';name:string;metadata:TokenMetadata;preset:{devBuySol:number;slippage:number;priorityFeeSol:number;jitoTipSol:number;mode:'manual'|'organic'|'block0';intervalMinSeconds:number;intervalMaxSeconds:number;deferBuys:boolean};roles:KitRole[];artwork?:{type:string;base64:string}}
export interface KitRequirements {roles:KitRole[];rebindRequired:true}
const REQUIREMENTS='outsol-launch-kit-roles-v1',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Invalid launch kit object.');return value as Record<string,unknown>}
const exact=(value:Record<string,unknown>,fields:string[])=>{if(Object.keys(value).some(key=>!fields.includes(key)))throw new Error('Launch kits cannot contain wallet bindings, keys or unknown fields.')}
const finite=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max
function roles(value:unknown):KitRole[]{
 if(!Array.isArray(value)||value.length<1||value.length>34)throw new Error('A launch kit needs valid unbound role slots.')
 const result=value.map(input=>{
  const row=object(input);exact(row,['slot','role','buySol','delaySeconds','sourceSlot'])
  if(typeof row.slot!=='string'||! /^(deployer|creator-fee|buyer-[1-9]\d?|receiver-[1-9]\d?)$/.test(row.slot)||!['deployer','creator-fee','buyer','receiver'].includes(String(row.role)))throw new Error('Invalid kit role slot.')
  if(row.role==='buyer'&&(!row.slot.startsWith('buyer-')||!finite(row.buySol,0,1000)||!finite(row.delaySeconds,0,3600))||row.role==='receiver'&&(!row.slot.startsWith('receiver-')||typeof row.sourceSlot!=='string')||row.role==='deployer'&&row.slot!=='deployer'||row.role==='creator-fee'&&row.slot!=='creator-fee')throw new Error('Invalid role settings.')
  if(row.role!=='buyer'&&(row.buySol!==undefined||row.delaySeconds!==undefined)||row.role!=='receiver'&&row.sourceSlot!==undefined)throw new Error('Unexpected role amount or source.')
  return {slot:row.slot,role:row.role,...(row.role==='buyer'?{buySol:row.buySol,delaySeconds:row.delaySeconds}:{}),...(row.role==='receiver'?{sourceSlot:row.sourceSlot}:{})} as KitRole
 })
 if(new Set(result.map(row=>row.slot)).size!==result.length||result.filter(row=>row.role==='deployer').length!==1||result.filter(row=>row.role==='creator-fee').length>1||result.filter(row=>row.role==='buyer').length>16||result.some(row=>row.role==='receiver'&&!result.some(source=>source.role==='buyer'&&source.slot===row.sourceSlot)))throw new Error('Kit roles are duplicated or have missing sources.')
 const buyers=result.filter(row=>row.role==='buyer');if(buyers.some((_,index)=>!buyers.some(row=>row.slot===`buyer-${index+1}`)))throw new Error('Buyer slots must be consecutive, beginning with buyer-1.')
 return result
}
function toKit(draft:LaunchDraft):LaunchKit{
 const safe=createLaunchDraft(draft,draft.id,Date.parse(draft.updatedAt))
 if(safe.config.mode!=='standard'||safe.config.venue!=='pump')throw new Error('Portable kits support Pump.fun launch designs only.')
 const settings=parseLaunchBundleSettings(safe.bundleSettings),slots:KitRole[]=[{slot:'deployer',role:'deployer'}]
 if(safe.config.creatorFeeSelection.kind!=='deployer')slots.push({slot:'creator-fee',role:'creator-fee'})
 settings.wallets.forEach((wallet,index)=>{const slot=`buyer-${index+1}`;slots.push({slot,role:'buyer',buySol:wallet.buySol,delaySeconds:wallet.delaySeconds});if(wallet.transferTo)slots.push({slot:`receiver-${index+1}`,role:'receiver',sourceSlot:slot})})
 return {version:1,type:'outsol-launch-kit',name:safe.name,metadata:safe.metadata,preset:{devBuySol:safe.config.devBuySol,slippage:safe.config.slippage,priorityFeeSol:safe.config.priorityFeeSol,jitoTipSol:safe.config.jitoTipSol,mode:settings.mode,intervalMinSeconds:settings.intervalMinSeconds,intervalMaxSeconds:settings.intervalMaxSeconds,deferBuys:settings.deferBuys??false},roles:slots}
}
export async function exportLaunchKit(draft:LaunchDraft,artwork?:Blob,requirements?:KitRequirements):Promise<string>{
 const kit=toKit(draft)
 if(requirements){const imported=roles(requirements.roles),current=new Map(kit.roles.map(row=>[row.slot,row]));kit.roles=roles([...imported.map(row=>current.get(row.slot)??row),...kit.roles.filter(row=>!imported.some(prior=>prior.slot===row.slot))])}
 if(artwork){await validateArtwork(artwork);const uri=await artworkToDataUri(artwork);kit.artwork={type:artwork.type,base64:uri.slice(uri.indexOf(',')+1)}}
 const text=JSON.stringify(kit,null,2);if(text.length>MAX_KIT_CHARACTERS)throw new Error('This launch kit exceeds the portable file limit.');return text
}
export async function parseLaunchKit(text:string):Promise<{kit:LaunchKit;artwork:Blob|null}>{
 if(typeof text!=='string'||text.length>MAX_KIT_CHARACTERS)throw new Error('Choose a launch kit below 7.1 MB with artwork no larger than 5 MB.')
 const input=object(JSON.parse(text))
 // Legacy public draft files remain importable; they are projected through the
 // same unbound, new-upload kit format, never restored as live wallet bindings.
 if(input.type===undefined&&input.version===1){exact(input,['version','id','name','updatedAt','metadata','metadataUri','config','artworkId','bundleSettings']);exact(object(input.config),Object.keys(DEFAULT_LAUNCH_CONFIG));exact(object(input.metadata),['name','symbol','description','website','twitter','telegram']);const legacy=createLaunchDraft(input as unknown as LaunchDraft);return {kit:toKit(legacy),artwork:null}}
 exact(input,['version','type','name','metadata','preset','roles','artwork'])
 if(input.version!==1||input.type!=='outsol-launch-kit'||typeof input.name!=='string')throw new Error('Choose a supported OutSol launch kit or public draft JSON.')
 const metadata=object(input.metadata);exact(metadata,['name','symbol','description','website','twitter','telegram'])
 const preset=object(input.preset);exact(preset,['devBuySol','slippage','priorityFeeSol','jitoTipSol','mode','intervalMinSeconds','intervalMaxSeconds','deferBuys'])
 const slotRows=roles(input.roles)
 const draft=createLaunchDraft({name:input.name,metadata:metadata as unknown as TokenMetadata,metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG,devBuySol:preset.devBuySol as number,slippage:preset.slippage as number,priorityFeeSol:preset.priorityFeeSol as number,jitoTipSol:preset.jitoTipSol as number}})
 const settings=parseLaunchBundleSettings({...DEFAULT_LAUNCH_BUNDLE_SETTINGS,mode:preset.mode,intervalMinSeconds:preset.intervalMinSeconds,intervalMaxSeconds:preset.intervalMaxSeconds,deferBuys:preset.deferBuys})
 if(typeof preset.deferBuys!=='boolean')throw new Error('The kit staged execution setting is invalid.')
 const kit:LaunchKit={version:1,type:'outsol-launch-kit',name:draft.name,metadata:draft.metadata,preset:{devBuySol:draft.config.devBuySol,slippage:draft.config.slippage,priorityFeeSol:draft.config.priorityFeeSol,jitoTipSol:draft.config.jitoTipSol,mode:settings.mode,intervalMinSeconds:settings.intervalMinSeconds,intervalMaxSeconds:settings.intervalMaxSeconds,deferBuys:settings.deferBuys??false},roles:slotRows}
 let artwork:Blob|null=null
 if(input.artwork!==undefined){
  const image=object(input.artwork);exact(image,['type','base64'])
  if(typeof image.type!=='string'||!['image/png','image/jpeg','image/gif','image/webp'].includes(image.type)||typeof image.base64!=='string'||image.base64.length>6_990_508||image.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64))throw new Error('Embedded artwork must be a valid raster no larger than 5 MB.')
  const binary=atob(image.base64);if(btoa(binary)!==image.base64)throw new Error('Embedded artwork encoding is invalid.')
  artwork=new Blob([Uint8Array.from(binary,char=>char.charCodeAt(0))],{type:image.type});await validateArtwork(artwork);kit.artwork={type:image.type,base64:image.base64}
 }
 return {kit,artwork}
}
export function readKitRequirements(storage:DraftStorage=localStorage):Record<string,KitRequirements>{
 try{
  const raw=storage.getItem(REQUIREMENTS);if(raw===null)return {};if(raw.length>200000)throw new Error()
  const input=object(JSON.parse(raw));exact(input,['version','drafts']);if(input.version!==1)throw new Error()
  const drafts=object(input.drafts);if(Object.keys(drafts).length>60)throw new Error()
  return Object.fromEntries(Object.entries(drafts).map(([id,value])=>{if(!UUID.test(id))throw new Error();const row=object(value);exact(row,['roles','rebindRequired']);if(row.rebindRequired!==true)throw new Error();return [id,{roles:roles(row.roles),rebindRequired:true}]}))
 }catch{throw new Error('Saved kit role requirements cannot be read. Preserve this browser data before importing another kit.')}
}
export async function importLaunchKit(text:string,storage:DraftStorage=localStorage):Promise<{draft:LaunchDraft;roles:KitRole[]}>{
 const {kit,artwork}=await parseLaunchKit(text)
 if(loadLaunchDrafts(storage).length>=30)throw new Error('You have 30 drafts. Export or remove one before importing another.');const requirements=readKitRequirements(storage)
 const asset=artwork?await saveArtwork(artwork,kit.name):undefined
 const draft=createLaunchDraft({name:kit.name,metadata:kit.metadata,metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG,devBuySol:kit.preset.devBuySol,slippage:kit.preset.slippage,priorityFeeSol:kit.preset.priorityFeeSol,jitoTipSol:kit.preset.jitoTipSol,creatorFeeSelection:{kind:'deployer'}},bundleSettings:{...DEFAULT_LAUNCH_BUNDLE_SETTINGS,groupId:null,wallets:[],mode:kit.preset.mode,intervalMinSeconds:kit.preset.intervalMinSeconds,intervalMaxSeconds:kit.preset.intervalMaxSeconds,deferBuys:kit.preset.deferBuys},...(asset?{artworkId:asset.id}:{})})
 if(Object.keys(requirements).length>=60)throw new Error('The kit role manifest is full. Preserve an export before importing more kits.')
 const serialized=JSON.stringify({version:1,drafts:{...requirements,[draft.id]:{roles:kit.roles,rebindRequired:true}}})
 storage.setItem(REQUIREMENTS,serialized);if(storage.getItem(REQUIREMENTS)!==serialized)throw new Error('Kit requirements could not be saved. No draft has been opened.')
 saveLaunchDraft(draft,storage)
 return {draft,roles:kit.roles}
}
/** Call from the live launch guard, with this tab's actual draft ID. Never use
 * the shared refresh pointer as signing identity. Bindings stay in the builder,
 * not this portable manifest, and are rechecked before each guarded action. */
export function assertKitBindings(draftId:string|undefined,settings:LaunchBundleSettings,selection:CreatorFeeSelection,payer:string|null|undefined,storage?:DraftStorage):void{
 if(!draftId)return
 const requirement=readKitRequirements(storage??localStorage)[draftId];if(!requirement)return
 try{if(typeof payer!=='string'||new PublicKey(payer).toBase58()!==payer||!PublicKey.isOnCurve(new PublicKey(payer).toBytes()))throw new Error()}catch{throw new Error('Bind an unlocked deployer signing wallet for this imported kit.')}
 const safe=parseLaunchBundleSettings(settings),buyers=requirement.roles.filter(row=>row.role==='buyer')
 if(safe.wallets.length<buyers.length)throw new Error(`Bind all ${buyers.length} buyer role slots in Launch settings before reviewing this kit.`)
 if(buyers.some(role=>(role.buySol??0)>0&&!(safe.wallets[Number(role.slot.replace('buyer-',''))-1]?.buySol>0)))throw new Error('Enter a positive reviewed budget for every funded buyer role in this kit.')
 for(const role of requirement.roles)if(role.role==='receiver'){
  const index=Number(role.sourceSlot!.replace('buyer-',''))-1
  if(!safe.wallets[index]?.transferTo)throw new Error(`Bind ${role.slot} in the corresponding buyer's receiving-wallet field.`)
 }
 if(requirement.roles.some(row=>row.role==='creator-fee')&&parseCreatorFeeSelection(selection).kind==='deployer')throw new Error('Explicitly rebind the creator-fee role in the creator fee recipient settings.')
}
