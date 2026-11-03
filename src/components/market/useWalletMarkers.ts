'use client'
import {useEffect,useMemo,useState} from 'react'
import {useWallet} from '@solana/wallet-adapter-react'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {readWatchlist,type WatchedWallet} from '@/lib/watchlist'
export function useWalletMarkers(mint:string){
 const wallets=useWalletLibraryStore(state=>state.wallets),{publicKey}=useWallet(),[watched,setWatched]=useState<WatchedWallet[]>([]),[warning,setWarning]=useState('')
 useEffect(()=>{
  useWalletLibraryStore.getState().hydrate()
  const load=()=>{try{setWatched(readWatchlist());setWarning('')}catch{setWatched([]);setWarning('Wallet labels could not be read from this browser.')}}
  load();window.addEventListener('storage',load);window.addEventListener('outsol-watchlist-changed',load)
  return()=>{window.removeEventListener('storage',load);window.removeEventListener('outsol-watchlist-changed',load)}
 },[])
 const connected=publicKey?.toBase58()
 return useMemo(()=>{
  const markers=new Map<string,{name:string;kind:'library'|'watched'|'connected';color:string}>()
  for(const row of watched)if(!row.projectMint||row.projectMint===mint)markers.set(row.address,{name:row.name,kind:'watched',color:row.color})
  for(const row of wallets)markers.set(row.publicKey,{name:row.name,kind:'library',color:'mint'})
  if(connected&&!markers.has(connected))markers.set(connected,{name:'Connected wallet',kind:'connected',color:'mint'})
  return {markers,ownedAddresses:[...wallets.map(row=>row.publicKey),...(connected?[connected]:[])],warning}
 },[wallets,watched,connected,mint,warning])
}
