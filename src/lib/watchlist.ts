import {PublicKey} from '@solana/web3.js'

export const WATCHLIST_KEY='outsol-public-wallet-watchlist-v1'
export const WATCHLIST_COLORS=['mint','blue','violet','amber','rose','slate'] as const
export type WatchlistColor=typeof WATCHLIST_COLORS[number]
export interface WatchedWallet {address:string;name:string;color:WatchlistColor;bookmarked:boolean;tags:string[];projectMint?:string;createdAt:string;updatedAt:string}
export interface WatchlistStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export type WatchedWalletInput=Pick<WatchedWallet,'address'|'name'>&Partial<WatchedWallet>
const MAX_ITEMS=200,MAX_BYTES=200_000
const target=(storage?:WatchlistStorage)=>storage??localStorage
const address=(input:unknown)=>{if(typeof input!=='string'||new PublicKey(input).toBase58()!==input)throw new Error('Enter a canonical Solana public address.');return input}
function wallet(input:WatchedWalletInput):WatchedWallet{
 if(!input||typeof input!=='object'||typeof input.name!=='string'||!input.name.trim()||input.name.length>60||/[\u0000-\u001f\u007f]/.test(input.name))throw new Error('Use a wallet name between 1 and 60 characters.')
 const color=input.color??'mint'
 if(!WATCHLIST_COLORS.includes(color)||input.bookmarked!==undefined&&typeof input.bookmarked!=='boolean')throw new Error('The wallet marker is invalid.')
 const tags=input.tags??[]
 if(!Array.isArray(tags)||tags.length>8||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>24||/[\u0000-\u001f\u007f]/.test(tag)))throw new Error('Use up to eight short tags.')
 const now=new Date().toISOString(),date=(value:string|undefined)=>{if(value!==undefined&&(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value))))throw new Error('The saved wallet date is invalid.');return value?new Date(value).toISOString():now}
 return {address:address(input.address),name:input.name.trim(),color,bookmarked:input.bookmarked??false,tags:[...new Set(tags.map(tag=>tag.trim()))],...(input.projectMint?{projectMint:address(input.projectMint)}:{}),createdAt:date(input.createdAt),updatedAt:date(input.updatedAt)}
}
function list(input:unknown):WatchedWallet[]{
 if(!Array.isArray(input)||input.length>MAX_ITEMS)throw new Error('A watchlist supports up to 200 wallets.')
 const rows=input.map(value=>wallet(value))
 if(new Set(rows.map(row=>row.address)).size!==rows.length)throw new Error('Every watched wallet must have a distinct address.')
 return rows
}
export function readWatchlist(storage?:WatchlistStorage):WatchedWallet[]{
 try{const raw=target(storage).getItem(WATCHLIST_KEY);if(raw===null)return [];if(raw.length>MAX_BYTES)throw new Error();const value=JSON.parse(raw);if(value?.version!==1)throw new Error();return list(value.wallets)}catch{throw new Error('The wallet watchlist cannot be read. Preserve browser data before making changes.')}
}
function save(rows:WatchedWallet[],storage?:WatchlistStorage):WatchedWallet[]{
 const safe=list(rows),serialized=JSON.stringify({version:1,wallets:safe})
 if(serialized.length>MAX_BYTES)throw new Error('The watchlist is full. Export it before removing entries.')
 target(storage).setItem(WATCHLIST_KEY,serialized)
 if(target(storage).getItem(WATCHLIST_KEY)!==serialized)throw new Error('The watchlist could not be saved. Retry after checking browser storage.')
 if(typeof window!=='undefined')window.dispatchEvent(new Event('outsol-watchlist-changed'))
 return safe
}
export function addWatchedWallet(input:WatchedWalletInput,storage?:WatchlistStorage):WatchedWallet[]{
 const rows=readWatchlist(storage),next=wallet(input)
 if(rows.some(row=>row.address===next.address))throw new Error('This address is already in your watchlist. Edit its name or marker instead.')
 return save([...rows,next],storage)
}
export function updateWatchedWallet(key:string,changes:Partial<Omit<WatchedWallet,'address'|'createdAt'>>,storage?:WatchlistStorage):WatchedWallet[]{
 const rows=readWatchlist(storage),current=rows.find(row=>row.address===key)
 if(!current)throw new Error('This watched wallet was removed. Refresh the list.')
 const next=wallet({...current,...changes,address:current.address,createdAt:current.createdAt,updatedAt:new Date().toISOString()})
 return save(rows.map(row=>row.address===key?next:row),storage)
}
export function removeWatchedWallet(key:string,storage?:WatchlistStorage):WatchedWallet[]{return save(readWatchlist(storage).filter(row=>row.address!==key),storage)}
export function exportWatchlist(rows:WatchedWallet[]):string{return JSON.stringify({version:1,type:'outsol-watchlist',wallets:list(rows)},null,2)}
export function importWatchlist(text:string,storage?:WatchlistStorage):WatchedWallet[]{
 if(typeof text!=='string'||text.length>MAX_BYTES)throw new Error('Use a watchlist JSON file smaller than 200 KB.')
 const value=JSON.parse(text)
 if(value?.version!==1||value.type!=='outsol-watchlist')throw new Error('Use an OutSol public watchlist export.')
 const incoming=list(value.wallets),existing=readWatchlist(storage),merged=new Map(existing.map(row=>[row.address,row]))
 for(const row of incoming)merged.set(row.address,row)
 return save([...merged.values()],storage)
}
