'use client'
import {useEffect} from 'react'
import Link from 'next/link'
import {useBundlerStore} from '@/stores/bundlerStore'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {Label} from '@/components/ui'
export function ManagedBundleWallets(){
 const store=useBundlerStore(),library=useWalletLibraryStore(),group=library.groups.find(group=>group.id===store.managedGroupId)
 const hydrate=library.hydrate
 useEffect(()=>{hydrate()},[hydrate])
 const selectedIds=[store.managedCreatorWalletId,...store.bundleWallets.filter(wallet=>wallet.buyAmount>0).map(wallet=>wallet.libraryWalletId)].filter((id):id is string=>!!id)
 const locked=selectedIds.filter(id=>!library.unlockedIds.includes(id)).length
 return <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-foreground">Wallet source</h3><Link className="text-xs text-accent hover:underline" href="/wallet">Open wallet library and funding</Link></div>
  <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="bundle-managed-group">Encrypted wallet group</Label><select id="bundle-managed-group" className="w-full rounded border border-border bg-background p-2 text-sm" value={store.managedGroupId??''} onChange={event=>event.target.value?store.selectManagedGroup(event.target.value):store.useManualWallets()}><option value="">Manual session keys</option>{library.groups.map(group=><option key={group.id} value={group.id}>{group.name} · {group.walletIds.length} wallets</option>)}</select></div>
  {group&&<div className="space-y-1"><Label htmlFor="bundle-managed-creator">Creator from this group</Label><select id="bundle-managed-creator" className="w-full rounded border border-border bg-background p-2 text-sm" value={store.managedCreatorWalletId??''} onChange={event=>store.selectManagedGroup(group.id,event.target.value)}>{group.walletIds.map(id=>{const wallet=library.wallets.find(wallet=>wallet.id===id);return wallet?<option key={id} value={id}>{wallet.name} · {wallet.publicKey.slice(0,6)}…</option>:null})}</select></div>}</div>
  {group?<><p className="text-xs text-muted">The creator and first 16 other group wallets are referenced directly. Keys stay in the unlocked library. Locking a selected wallet or changing the library stops pending browser actions.</p><p className={`text-xs ${locked?'text-yellow-400':'text-accent'}`}>{locked?`${locked} selected wallet${locked===1?' is':'s are'} locked. Unlock in Wallets before launching.`:'Selected wallets are unlocked in this browser.'}</p>{group.walletIds.length>17&&<p className="text-xs text-yellow-400">This group has more than 16 buyers. Only the first 16 buyers are included; review the rows below.</p>}</>:<p className="text-xs text-muted">Choose a saved group to use its unlocked keys without pasting them again. Manual keys remain available for this browser session.</p>}
  {library.error&&<p role="alert" className="text-xs text-red-400">{library.error}</p>}
 </section>
}
