import type {WalletOperationStorage} from '@/lib/walletOperations/history'
import {relayAddress} from './scan'
import type {RelayRoute,RelayRouteWallet} from './types'

export const RELAY_ROUTES_KEY='outsol-relay-routes-v1'
function target(storage?:WalletOperationStorage){if(storage)return storage;if(typeof localStorage==='undefined')throw new Error('Relay route storage is unavailable.');return localStorage}
function id(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('Choose wallets from the encrypted library.');return value}
function name(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>64||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Use a route name from 1 to 64 characters.');return value.trim()}
function publicRoute(value:RelayRoute):RelayRoute{if(!value||typeof value!=='object'||typeof value.createdAt!=='string'||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(value.updatedAt)))throw new Error('Invalid saved Relay route.');const sourceWalletId=id(value.sourceWalletId),destinationWalletId=id(value.destinationWalletId);if(sourceWalletId===destinationWalletId)throw new Error('Source and destination must be different wallets.');return{id:id(value.id),name:name(value.name),sourceWalletId,destinationWalletId,createdAt:new Date(value.createdAt).toISOString(),updatedAt:new Date(value.updatedAt).toISOString()}}
function topology(rows:RelayRoute[],wallets?:RelayRouteWallet[]){
 const address=(walletId:string)=>{if(!wallets)return walletId;const wallet=wallets.find(value=>value.id===walletId);if(!wallet)throw new Error('A selected Relay wallet no longer exists.');return relayAddress(wallet.publicKey??wallet.address??'',true)}
 const sources=rows.map(row=>address(row.sourceWalletId)),destinations=rows.map(row=>address(row.destinationWalletId))
 if(new Set(sources).size!==sources.length)throw new Error('Each Relay source must have one destination.')
 if(destinations.some(value=>sources.includes(value)))throw new Error('Relay destinations cannot also be sources. Use a separate reviewed route after rescanning.')
}
export function readRelayRoutes(storage?:WalletOperationStorage):RelayRoute[]{try{const raw=target(storage).getItem(RELAY_ROUTES_KEY);if(raw===null)return[];if(raw.length>50000)throw new Error();const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>50)throw new Error();const rows=values.map(publicRoute);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error();topology(rows);return rows}catch{throw new Error('Relay routes cannot be read. Preserve browser storage before making changes.')}}
export function saveRelayRoute(input:{id?:string;name:string;sourceWalletId:string;destinationWalletId:string},wallets:RelayRouteWallet[],storage?:WalletOperationStorage):RelayRoute{
 const rows=readRelayRoutes(storage),previous=input.id?rows.find(row=>row.id===input.id):undefined
 if(input.id&&!previous)throw new Error('This Relay route no longer exists.')
 const now=new Date().toISOString(),row=publicRoute({id:previous?.id??crypto.randomUUID(),name:input.name,sourceWalletId:input.sourceWalletId,destinationWalletId:input.destinationWalletId,createdAt:previous?.createdAt??now,updatedAt:now})
 const next=[...rows.filter(value=>value.id!==row.id),row];if(next.length>50)throw new Error('Save at most 50 Relay routes.');topology(next,wallets)
 const disk=target(storage);disk.setItem(RELAY_ROUTES_KEY,JSON.stringify(next));if(JSON.stringify(readRelayRoutes(storage))!==JSON.stringify(next))throw new Error('The Relay route could not be saved.');return row
}
export function removeRelayRoute(routeId:string,storage?:WalletOperationStorage){const rows=readRelayRoutes(storage),next=rows.filter(row=>row.id!==id(routeId));target(storage).setItem(RELAY_ROUTES_KEY,JSON.stringify(next));if(readRelayRoutes(storage).some(row=>row.id===routeId))throw new Error('The Relay route could not be removed.')}
