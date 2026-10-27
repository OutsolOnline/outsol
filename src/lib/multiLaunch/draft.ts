import {validateTokenDetails} from '@/lib/launchConfig'
import type {MultiLaunchRowInput} from './session'
import {migrateLegacyCreatorFeeSelection,requireSupportedCreatorFeeSelection,type CreatorFeeSelection} from '@/lib/creatorFeeRouting'

export const MULTI_LAUNCH_DRAFT_KEY='outsol-multi-launch-design-v1'
export interface MultiLaunchDraft {
 version:1;rows:MultiLaunchRowInput[];description:string;website:string;twitter:string;telegram:string
 source:'external'|'vault';slippage:number|null;priority:number|null;tip:number|null;kitId:string;artworkId?:string
 creatorFeeSelection?:CreatorFeeSelection
}
interface DraftStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const savedError=()=>new Error('The saved batch design cannot be read. Keep this browser’s data safe; it has not been replaced. You can still prepare the current form without autosave.')
function text(value:unknown,max:number):string {
 if(typeof value!=='string'||value.length>max)throw new Error('A batch design field is too large or cannot be read.')
 return value
}
function setting(value:unknown):number|null {
 if(value===null)return null
 if(typeof value!=='number'||!Number.isFinite(value))throw new Error('A batch setting cannot be saved.')
 return value
}
/** Editable public inputs only. No prepared reviews, packets, approvals or signers. */
function publicDesign(value:MultiLaunchDraft):MultiLaunchDraft {
 if(!value||value.version!==1||!Array.isArray(value.rows)||value.rows.length<2||value.rows.length>5||!['external','vault'].includes(value.source))throw new Error('Choose a supported batch design.')
 const rows=value.rows.map(row=>({name:text(row.name,128),symbol:text(row.symbol,40),buySol:text(row.buySol,64)}))
 if(value.artworkId!==undefined&&(typeof value.artworkId!=='string'||!/^[a-f0-9]{64}$/.test(value.artworkId)))throw new Error('Invalid local artwork reference.')
 const creatorFeeSelection=Object.hasOwn(value,'creatorFeeSelection')?requireSupportedCreatorFeeSelection(value.creatorFeeSelection):migrateLegacyCreatorFeeSelection(undefined)
 return {version:1,rows,creatorFeeSelection,description:text(value.description,1000),website:text(value.website,300),twitter:text(value.twitter,300),telegram:text(value.telegram,300),source:value.source,slippage:setting(value.slippage),priority:setting(value.priority),tip:setting(value.tip),kitId:text(value.kitId,100),...(value.artworkId?{artworkId:value.artworkId}:{})}
}
export function readMultiLaunchDraft(storage?:DraftStorage):MultiLaunchDraft|null {
 if(!storage&&typeof localStorage==='undefined')return null
 try {
  const raw=(storage??localStorage).getItem(MULTI_LAUNCH_DRAFT_KEY)
  if(raw===null)return null
  if(raw.length>20000)throw new Error()
  return publicDesign(JSON.parse(raw))
 }catch{throw savedError()}
}
export function saveMultiLaunchDraft(value:MultiLaunchDraft,storage?:DraftStorage):void {
 const destination=storage??localStorage
 // Refuse to replace an unreadable or newer design with initial defaults.
 readMultiLaunchDraft(destination)
 const raw=JSON.stringify(publicDesign(value))
 try {destination.setItem(MULTI_LAUNCH_DRAFT_KEY,raw);if(destination.getItem(MULTI_LAUNCH_DRAFT_KEY)!==raw)throw new Error()}
 catch {throw new Error('This batch design was not saved. Allow browser storage or free space, then edit a field to retry. Keep this page open in the meantime.')}
}

/** Preparation feedback mirrors the existing native-engine constraints. */
export function validateMultiLaunchDesign(design:MultiLaunchDraft,context:{hasArtwork:boolean;hasSigner:boolean}):Record<string,string> {
 const errors:Record<string,string>={}
 try{if(Object.hasOwn(design,'creatorFeeSelection'))requireSupportedCreatorFeeSelection(design.creatorFeeSelection)}catch(error){errors['multi-creator-fees']=error instanceof Error?error.message:'Choose a supported creator fee recipient.'}
 if(design.rows.length<2||design.rows.length>5)errors['multi-count']='Choose 2–5 tokens.'
 design.rows.forEach((row,index)=>{
  const details=validateTokenDetails({name:row.name,symbol:row.symbol,description:design.description,website:design.website,twitter:design.twitter,telegram:design.telegram})
  if(details.name)errors[`multi-name-${index}`]=details.name
  if(details.symbol)errors[`multi-symbol-${index}`]=details.symbol
  if(details.description)errors['multi-description']=details.description
  for(const [field,number] of [['website',0],['twitter',1],['telegram',2]] as const)if(details[field])errors[`multi-link-${number}`]=details[field]!
  if(!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(row.buySol)||row.buySol.length>24||Number(row.buySol)>1000)errors[`multi-buy-${index}`]='Use 0–1,000 SOL with at most nine decimal places.'
 })
 for(const [value,min,max,index,label] of [[design.slippage,0.1,50,0,'Slippage'],[design.priority,0,0.01,1,'Priority fee'],[design.tip,0.000001,0.1,2,'Bundle tip']] as const){
  if(value===null||!Number.isFinite(value)||value<min||value>max)errors[`multi-setting-${index}`]=`${label} must be ${min}–${max}${index===0?'%':' SOL'}.`
 }
 if(!context.hasArtwork)errors['multi-image']='Choose shared token artwork before publishing metadata.'
 if(!context.hasSigner)errors['multi-signer']='Connect an external wallet or unlock a local wallet before preparing.'
 return errors
}
