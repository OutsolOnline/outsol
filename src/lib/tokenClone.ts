import {Connection,PublicKey} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {readTokenFacts,type TokenFacts} from './tokenFacts'
import {withTimeout} from './transactions/http'
import {publicCaptureUrl} from './webCapture'
import {createLaunchDraft} from './launchDrafts'
import {DEFAULT_LAUNCH_CONFIG,validateTokenDetails} from './launchConfig'
import type {TokenMetadata} from './pumpfun/types'

export interface CloneSource {mint:string;name:string;symbol:string;metadataUri:string;slot:number}
export interface ClonePublicMetadata {description:string;website:string;twitter:string;telegram:string;imageUrl?:string;warnings:string[]}
const clean=(value:string)=>value.replace(/\0+$/,'').trim()
/** Identity is read on chain. The Metaplex PDA is checked independently; a
 * decoded metadata object never proves its owner or target mint by itself. */
export async function readCloneSource(connection:Connection,address:string,readFacts:(connection:Connection,address:string)=>Promise<TokenFacts>=readTokenFacts):Promise<CloneSource>{
 const mint=new PublicKey(address);if(mint.toBase58()!==address)throw new Error('Enter a canonical Solana mint address.')
 const facts=await readFacts(connection,address)
 if(facts.mint!==address)throw new Error('The returned mint identity does not match this address.')
 if(facts.tokenProgram===TOKEN_2022_PROGRAM_ID.toBase58()&&facts.name!==undefined&&facts.symbol!==undefined)return {mint:address,name:clean(facts.name),symbol:clean(facts.symbol),metadataUri:clean(facts.metadataUri??''),slot:facts.slot}
 const {Metadata,Key,PROGRAM_ID}=await import('@metaplex-foundation/mpl-token-metadata')
 const pda=PublicKey.findProgramAddressSync([new TextEncoder().encode('metadata'),PROGRAM_ID.toBytes(),mint.toBytes()],PROGRAM_ID)[0]
 const info=await withTimeout(connection.getAccountInfo(pda,'confirmed'))
 if(!info||!info.owner.equals(PROGRAM_ID)||info.executable||info.data.length>16384)throw new Error('Verified on-chain token metadata is unavailable for this mint.')
 const [metadata]=Metadata.deserialize(info.data)
 if(metadata.key!==Key.MetadataV1||!metadata.mint.equals(mint))throw new Error('The metadata account does not belong to this mint.')
 return {mint:address,name:clean(metadata.data.name),symbol:clean(metadata.data.symbol),metadataUri:clean(metadata.data.uri),slot:facts.slot}
}
/** Browser CORS read only. It must never be called in a server fetch/proxy. */
export async function fetchCloneMetadata(uri:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<ClonePublicMetadata>{
 const url=publicCaptureUrl(uri),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000),abort=()=>controller.abort()
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort()
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
 try{
  const response=await fetcher(url,{mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal})
  if(!response.ok||!/^application\/(?:json|[\w.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??''))throw new Error('This metadata host did not allow a public JSON read. Enter the remaining details manually.')
  if(Number(response.headers.get('content-length'))>131072||!response.body)throw new Error('Metadata must be public JSON no larger than 128 KB.')
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw new Error('Metadata exceeds 128 KB.');chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Metadata must be a JSON object.')
  const result:ClonePublicMetadata={description:'',website:'',twitter:'',telegram:'',warnings:[]}
  if(input.description!==undefined){if(typeof input.description!=='string'||input.description.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.description))throw new Error('The source description is invalid or exceeds 1,000 characters.');result.description=input.description}
  for(const field of ['website','twitter','telegram'] as const){
   const value=input[field]??input.extensions?.[field]??(field==='website'?input.external_url:undefined)
   if(value){try{const safe=publicCaptureUrl(value);if(safe.length>300)throw new Error();result[field]=safe}catch{result.warnings.push(`The source ${field} link was omitted because it is not a supported public HTTPS link.`)}}
  }
  if(input.image){try{result.imageUrl=publicCaptureUrl(input.image)}catch{result.warnings.push('The source image URL is not public HTTPS. Upload artwork manually.')}}
  return result
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
}
export function createClonedDraft(metadata:TokenMetadata,artworkId?:string){
 const safe={name:metadata.name.trim(),symbol:metadata.symbol.trim(),description:metadata.description,website:metadata.website??'',twitter:metadata.twitter??'',telegram:metadata.telegram??''}
 const errors=Object.values(validateTokenDetails(safe));if(errors.length)throw new Error(errors.join(' '))
 return createLaunchDraft({name:safe.name,metadata:safe,metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG,creatorFeeSelection:{kind:'deployer'}},...(artworkId?{artworkId}:{})})
}
