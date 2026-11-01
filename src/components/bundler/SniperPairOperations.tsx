'use client'
import {useMemo,type ReactNode} from 'react'
import {RelayWorkspace} from '@/components/relay/RelayWorkspace'
import type {WalletControlScope} from '@/lib/bundler/walletControls'
import type {WalletOperationStorage} from '@/lib/walletOperations/history'
import type {ResolvedSniperPair} from '@/lib/sniperPairs/catalog'
import {createSniperPairPolicy} from '@/lib/sniperPairs/operations'
import {RELAY_ROUTES_KEY} from '@/lib/relay/routes'

export interface SniperPairOperationsProps{pairs:readonly ResolvedSniperPair[];scope:WalletControlScope;disabled?:boolean;onBusyChange?:(busy:boolean)=>void;renderPairSettings?:(pair:ResolvedSniperPair)=>ReactNode}
/** Fixed pair routes are public and derived from the reusable catalog. Nothing
 * can silently retarget a prepared transfer through a second route form. */
export function SniperPairOperations({pairs,scope,disabled,onBusyChange,renderPairSettings}:SniperPairOperationsProps){
 const identity=JSON.stringify(pairs)
 // Parent allocation/busy renders must not recreate route storage and abort a
 // reviewed queue. Scope revision still invalidates actual ownership changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const stablePairs=useMemo(()=>pairs.map(pair=>({...pair,sniper:{...pair.sniper},receiver:{...pair.receiver}})),[identity])
 const routeStorage=useMemo<WalletOperationStorage>(()=>{
  const policy=createSniperPairPolicy(stablePairs,scope),publicRoutes=JSON.stringify(policy.routes())
  // History refresh may finish after an unlock replaced the signing scope.
  // Reading these immutable public rows must not re-authorize an old signer.
  return{getItem:key=>{if(key!==RELAY_ROUTES_KEY)throw new Error('Only fixed pair routes are available here.');return publicRoutes},setItem:()=>{throw new Error('Change a pair in its saved session before reviewing transfers.')},removeItem:()=>{throw new Error('Change a pair in its saved session before reviewing transfers.')}}
 },[stablePairs,scope])
 return <RelayWorkspace embedded pairs={stablePairs} scope={scope} routeStorage={routeStorage} disabled={disabled} onBusyChange={onBusyChange} renderPairSettings={renderPairSettings}/>
}
