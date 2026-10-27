import { PublicKey } from '@solana/web3.js'
export const TOKEN_PROJECTS_KEY = 'vanity-token-projects-v1'
export interface TokenProject { mint:string;name:string;symbol:string;metadataUri?:string;notes?:string;createdAt:string;updatedAt:string }
type Storage = {getItem(key:string):string|null;setItem(key:string,value:string):void}
type ProjectInput = Pick<TokenProject,'mint'|'name'|'symbol'> & Partial<TokenProject>
function project(input:ProjectInput):TokenProject {
 const mint=new PublicKey(input.mint).toBase58()
 if(mint!==input.mint)throw new Error('Enter a valid Solana mint.')
 if(typeof input.name!=='string'||input.name.length>80||typeof input.symbol!=='string'||input.symbol.length>20)throw new Error('Project name or symbol is invalid.')
 if(input.metadataUri){const url=new URL(input.metadataUri);if(!['https:','ipfs:','ar:'].includes(url.protocol)||url.username||url.password||input.metadataUri.length>500)throw new Error('Use a public HTTPS or content-addressed metadata link.')}
 const now=new Date().toISOString()
 return {mint,name:input.name,symbol:input.symbol,...(input.metadataUri?{metadataUri:input.metadataUri}:{}),...(typeof input.notes==='string'?{notes:input.notes.slice(0,4000)}:{}),createdAt:input.createdAt&&Number.isFinite(Date.parse(input.createdAt))?input.createdAt:now,updatedAt:input.updatedAt&&Number.isFinite(Date.parse(input.updatedAt))?input.updatedAt:now}
}
export function readTokenProjects(storage:Storage=localStorage):TokenProject[]{
 try {const raw=storage.getItem(TOKEN_PROJECTS_KEY);if(!raw)return [];if(raw.length>600000)throw new Error();const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length>100)throw new Error();return parsed.map(project)}catch{throw new Error('Saved projects cannot be read. Preserve this browser’s data before editing projects.')}
}
/** Explicit allowlist: no launch store, wallet keys, signatures or transaction packets. */
export function saveTokenProject(input:ProjectInput,storage:Storage=localStorage):TokenProject {
 const items=readTokenProjects(storage),existing=items.find(item=>item.mint===input.mint)
 const next=project({...existing,...input,createdAt:existing?.createdAt,updatedAt:new Date().toISOString()})
 storage.setItem(TOKEN_PROJECTS_KEY,JSON.stringify([next,...items.filter(item=>item.mint!==next.mint)].slice(0,100)))
 if(typeof window!=='undefined')window.dispatchEvent(new Event('vanity-projects-changed'))
 return next
}
