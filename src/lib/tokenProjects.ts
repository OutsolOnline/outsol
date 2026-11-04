import { PublicKey } from '@solana/web3.js'
export const TOKEN_PROJECTS_KEY = 'vanity-token-projects-v1'
export interface TokenProject { mint:string;name:string;symbol:string;metadataUri?:string;notes?:string;createdAt:string;updatedAt:string;archivedAt?:string;labels?:string[];walletAddresses?:string[] }
type Storage = {getItem(key:string):string|null;setItem(key:string,value:string):void}
type ProjectInput = Pick<TokenProject,'mint'|'name'|'symbol'> & Partial<TokenProject>
function project(input:ProjectInput):TokenProject {
 const mint=new PublicKey(input.mint).toBase58()
 if(mint!==input.mint)throw new Error('Enter a valid Solana mint.')
 if(typeof input.name!=='string'||input.name.length>80||typeof input.symbol!=='string'||input.symbol.length>20)throw new Error('Project name or symbol is invalid.')
 if(input.metadataUri){const url=new URL(input.metadataUri);if(!['https:','ipfs:','ar:'].includes(url.protocol)||url.username||url.password||input.metadataUri.length>500)throw new Error('Use a public HTTPS or content-addressed metadata link.')}
 const now=new Date().toISOString()
 if(input.archivedAt!==undefined&&(typeof input.archivedAt!=='string'||input.archivedAt.length>40||!Number.isFinite(Date.parse(input.archivedAt))))throw new Error('The project archive date is invalid.')
 if(input.labels!==undefined&&(!Array.isArray(input.labels)||input.labels.length>8||input.labels.some(label=>typeof label!=='string'||!label.trim()||label.length>30)))throw new Error('Use up to eight short project labels.')
 if(input.walletAddresses!==undefined&&(!Array.isArray(input.walletAddresses)||input.walletAddresses.length>100))throw new Error('A project supports up to 100 public wallet associations.')
 const walletAddresses=input.walletAddresses?.map(value=>{if(typeof value!=='string'||new PublicKey(value).toBase58()!==value)throw new Error('A project wallet address is invalid.');return value})
 return {mint,name:input.name,symbol:input.symbol,...(input.metadataUri?{metadataUri:input.metadataUri}:{}),...(typeof input.notes==='string'?{notes:input.notes.slice(0,4000)}:{}),createdAt:input.createdAt&&Number.isFinite(Date.parse(input.createdAt))?input.createdAt:now,updatedAt:input.updatedAt&&Number.isFinite(Date.parse(input.updatedAt))?input.updatedAt:now,...(input.archivedAt?{archivedAt:new Date(input.archivedAt).toISOString()}:{}),...(input.labels?{labels:[...new Set(input.labels.map(label=>label.trim()))]}:{}),...(walletAddresses?{walletAddresses:[...new Set(walletAddresses)]}:{})}
}
export function readTokenProjects(storage:Storage=localStorage):TokenProject[]{
 try {const raw=storage.getItem(TOKEN_PROJECTS_KEY);if(!raw)return [];if(raw.length>600000)throw new Error();const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length>100)throw new Error();return parsed.map(project)}catch{throw new Error('Saved projects cannot be read. Preserve this browser’s data before editing projects.')}
}
/** Explicit allowlist: no launch store, wallet keys, signatures or transaction packets. */
export function saveTokenProject(input:ProjectInput,storage:Storage=localStorage):TokenProject {
 const items=readTokenProjects(storage),existing=items.find(item=>item.mint===input.mint)
 const next=project({...existing,...input,createdAt:existing?.createdAt,updatedAt:new Date().toISOString()})
 if(!existing&&items.length>=100)throw new Error('You have 100 saved projects. Export your projects before removing any.')
 const serialized=JSON.stringify([next,...items.filter(item=>item.mint!==next.mint)])
 if(serialized.length>600000)throw new Error('Project storage is full. Export your projects before making changes.')
 storage.setItem(TOKEN_PROJECTS_KEY,serialized)
 if(storage.getItem(TOKEN_PROJECTS_KEY)!==serialized)throw new Error('The project could not be saved. Check browser storage and retry.')
 if(typeof window!=='undefined')window.dispatchEvent(new Event('vanity-projects-changed'))
 return next
}
export function archiveTokenProject(mint:string,archived:boolean,storage:Storage=localStorage):TokenProject{
 const current=readTokenProjects(storage).find(item=>item.mint===mint)
 if(!current)throw new Error('Save this project before archiving it.')
 return saveTokenProject({...current,archivedAt:archived?new Date().toISOString():undefined},storage)
}
/** Public handoff only. This file never grants access to another user's keys. */
export function exportTokenProjects(items:TokenProject[],includeNotes=false):string{
 if(!Array.isArray(items)||items.length>100)throw new Error('Select up to 100 projects.')
 return JSON.stringify({version:1,type:'outsol-projects',projects:items.map(item=>{const safe=project(item);if(!includeNotes)delete safe.notes;return safe})},null,2)
}
export function importTokenProjects(text:string,storage:Storage=localStorage):TokenProject[]{
 if(typeof text!=='string'||text.length>600000)throw new Error('Use a project JSON file smaller than 600 KB.')
 const value=JSON.parse(text)
 if(value?.version!==1||value.type!=='outsol-projects'||!Array.isArray(value.projects)||value.projects.length>100)throw new Error('Use a LaunchPier public project export.')
 const incoming:TokenProject[]=value.projects.map(project)
 if(new Set(incoming.map(item=>item.mint)).size!==incoming.length)throw new Error('Each imported project must have a unique mint.')
 const existing=readTokenProjects(storage),merged=new Map(existing.map(item=>[item.mint,item]))
 for(const item of incoming){const previous=merged.get(item.mint);merged.set(item.mint,project({...previous,...item,notes:item.notes??previous?.notes,createdAt:previous?.createdAt??item.createdAt}))}
 if(merged.size>100)throw new Error('This import would exceed 100 saved projects. Nothing was changed.')
 const rows=[...merged.values()],serialized=JSON.stringify(rows)
 if(serialized.length>600000)throw new Error('Project storage is full. Nothing was imported.')
 storage.setItem(TOKEN_PROJECTS_KEY,serialized)
 if(storage.getItem(TOKEN_PROJECTS_KEY)!==serialized)throw new Error('The projects could not be saved. Check browser storage and retry.')
 if(typeof window!=='undefined')window.dispatchEvent(new Event('vanity-projects-changed'))
 return rows
}
