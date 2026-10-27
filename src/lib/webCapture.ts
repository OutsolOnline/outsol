import {DEFAULT_LAUNCH_CONFIG} from './launchConfig'
import {createLaunchDraft,loadLaunchDrafts} from './launchDrafts'
import type {TokenMetadata} from './pumpfun/types'
import {parseXPostUrl} from './xPosts'

export interface WebCapture {version:1;kind:'page'|'selection'|'image';name:string;symbol:string;description:string;sourceUrl:string;imageUrl?:string}

/** A post remains an editable source link in the eventual token metadata. */
export function captureMetadata(capture:WebCapture):TokenMetadata {
 let twitter=''
 try {twitter=parseXPostUrl(capture.sourceUrl).url}catch{ /* Other public sources have no inferred X identity. */ }
 return {name:capture.name,symbol:capture.symbol,description:capture.description,website:'',twitter,telegram:''}
}

/** Browser-side public URL suggestions only. Never use these URLs in a server fetch. */
export function publicCaptureUrl(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>2000)throw new Error('Choose a public HTTPS page or image URL within 2,000 characters.')
 let url:URL;try{url=new URL(value)}catch{throw new Error('Enter a valid public HTTPS website address.')}
 const host=url.hostname.toLowerCase().replace(/\.$/,'')
 if(url.protocol!=='https:'||url.username||url.password||!host.includes('.')||host.includes(':')||host.includes('*')||/(^|\.)(localhost|local|internal|home|lan|onion|invalid|test)$/.test(host))throw new Error('Only public HTTPS website addresses are supported.')
 if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
  const [a,b,c]=host.split('.').map(Number)
  if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2))||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)throw new Error('Private and reserved network addresses are not supported.')
 }
 url.search='';url.hash='';return url.toString()
}
export function parseWebCapture(fragment:string):WebCapture|null{
 if(!fragment)return null
 if(fragment.length>24000)throw new Error('The captured page is too large. Capture a shorter selection.')
 const params=new URLSearchParams(fragment.replace(/^#/,''))
 if(params.getAll('import').length!==1||[...params.keys()].some(key=>key!=='import'))throw new Error('This extension link is invalid. Capture the page again.')
 let value:unknown;try{value=JSON.parse(params.get('import')!)}catch{throw new Error('The extension details could not be read. Capture the page again.')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid capture details.')
 const item=value as Record<string,unknown>,fields=['version','kind','name','symbol','description','sourceUrl','imageUrl']
 if(Object.keys(item).some(key=>!fields.includes(key))||item.version!==1||!['page','selection','image'].includes(String(item.kind))||(item.imageUrl!==undefined&&typeof item.imageUrl!=='string'))throw new Error('Unsupported extension capture. Update the extension and try again.')
 if(typeof item.name!=='string'||new TextEncoder().encode(item.name).length>32||/[\u0000-\u001f\u007f]/.test(item.name)||typeof item.symbol!=='string'||!/^[A-Za-z0-9]{0,10}$/.test(item.symbol)||typeof item.description!=='string'||item.description.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.description))throw new Error('The captured name, symbol or description is invalid or too long.')
 return{version:1,kind:item.kind as WebCapture['kind'],name:item.name,symbol:item.symbol.toUpperCase(),description:item.description,sourceUrl:publicCaptureUrl(item.sourceUrl),...(item.imageUrl?{imageUrl:publicCaptureUrl(item.imageUrl)}:{})}
}
export function createCapturedDraft(capture:WebCapture,metadata:TokenMetadata,artworkId?:string){
 if(!capture||!metadata.name.trim()||!metadata.symbol.trim())throw new Error('Review a token name and symbol before saving the draft.')
 const reviewed={...metadata,name:metadata.name.trim(),symbol:metadata.symbol.trim().toUpperCase()}
 if(new TextEncoder().encode(reviewed.name).length>32||/[\u0000-\u001f\u007f]/.test(reviewed.name))throw new Error('Token name must fit 32 UTF-8 bytes and use a single line.')
 if(!/^[A-Z0-9]{1,10}$/.test(reviewed.symbol))throw new Error('Symbol must contain 1–10 letters or numbers.')
 if(typeof reviewed.description!=='string'||reviewed.description.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reviewed.description))throw new Error('Description must contain no unsupported characters and fit 1,000 characters.')
 const draft=createLaunchDraft({name:reviewed.name,metadata:reviewed,metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG},...(artworkId?{artworkId}:{})})
 return draft
}

export interface CaptureReview {capture:WebCapture;metadata:TokenMetadata;artworkId?:string;savedId?:string}
interface ReviewStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const REVIEW_KEY='outsol-capture-review-v1'
function safeReview(value:unknown):CaptureReview{
 const item=value as Partial<CaptureReview>|null
 if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['capture','metadata','artworkId','savedId'].includes(key)))throw new Error('Invalid saved capture.')
 const capture=parseWebCapture(`#import=${encodeURIComponent(JSON.stringify(item.capture))}`),metadata=item.metadata
 if(!capture||!metadata||typeof metadata!=='object'||Object.keys(metadata).some(key=>!['name','symbol','description','website','twitter','telegram'].includes(key)))throw new Error('Invalid saved capture.')
 for(const [key,limit] of [['name',64],['symbol',10],['description',1000],['website',300],['twitter',300],['telegram',300]] as const){
  const field=metadata[key];if((field===undefined&&!['name','symbol','description'].includes(key))||typeof field==='string'&&field.length<=limit)continue
  throw new Error('Invalid saved capture.')
 }
 if(item.artworkId!==undefined&&!/^[a-f0-9]{64}$/.test(item.artworkId)||item.savedId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.savedId))throw new Error('Invalid saved capture reference.')
 return{capture,metadata:{...metadata,website:metadata.website||'',twitter:metadata.twitter||'',telegram:metadata.telegram||''},...(item.artworkId?{artworkId:item.artworkId}:{}),...(item.savedId?{savedId:item.savedId}:{})}
}
/** Only public suggestions and opaque local IDs; image bytes and wallet state never enter session storage. */
export function writeCaptureReview(review:CaptureReview,storage?:ReviewStorage):void{
 const safe=safeReview(review)
 try{(storage||sessionStorage).setItem(REVIEW_KEY,JSON.stringify(safe))}catch{throw new Error('Refresh recovery is unavailable in this browser. Keep this tab open until your draft is saved.')}
}
export function readCaptureReview(storage?:ReviewStorage):CaptureReview|null{
 try{const raw=(storage||sessionStorage).getItem(REVIEW_KEY);if(!raw)return null;if(raw.length>16000)throw new Error();return safeReview(JSON.parse(raw))}catch{throw new Error('The saved capture recovery could not be read. Capture the page again; existing launch drafts are preserved.')}
}
export function clearCaptureReview(storage?:ReviewStorage):void{(storage||sessionStorage).removeItem(REVIEW_KEY)}

interface CaptureReviewVerification {review:CaptureReview;savedDraftStatus:'unsaved'|'saved'|'missing'|'unverified';warning?:string}
/** A failed draft read cannot prove a reference is missing or prevent independent artwork recovery. */
export function verifyCaptureReviewDraft(value:CaptureReview,readDrafts:()=>readonly{id:string}[]=loadLaunchDrafts):CaptureReviewVerification{
 const review=safeReview(value)
 if(!review.savedId)return{review,savedDraftStatus:'unsaved'}
 try{
  if(readDrafts().some(draft=>draft.id===review.savedId))return{review,savedDraftStatus:'saved'}
  delete review.savedId
  return{review,savedDraftStatus:'missing',warning:'The saved draft is no longer in this browser. Your capture details and local artwork reference are preserved.'}
 }catch{
  return{review,savedDraftStatus:'unverified',warning:'The saved draft could not be verified because local draft storage could not be read. Its recovery reference is preserved; artwork recovery can continue separately.'}
 }
}

/** Explicit user-requested browser import; CORS, no cookies, no redirects or server proxy. */
export async function fetchCaptureImage(value:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<Blob>{
 const url=publicCaptureUrl(value),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort()
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
 try{
  const response=await fetcher(url,{mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal})
  if(!response.ok)throw new Error('This website did not allow image import. Download the image and choose it below.')
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||''
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(type))throw new Error('Choose a PNG, JPEG, WebP or GIF image.')
  if(Number(response.headers.get('content-length'))>5*1024*1024)throw new Error('Choose an image no larger than 5 MB.')
  if(!response.body)throw new Error('The image response was empty.')
  reader=response.body.getReader();const parts:ArrayBuffer[]=[];let length=0
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>5*1024*1024)throw new Error('Choose an image no larger than 5 MB.');parts.push(value.slice().buffer as ArrayBuffer)}
  if(!length)throw new Error('The image was empty.')
  return new Blob(parts,{type})
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
}
