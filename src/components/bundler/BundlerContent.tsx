'use client'
import { useEffect } from 'react'

import { useBundlerStore } from '@/stores/bundlerStore'
import { BundlerForm } from './BundlerForm'
import { BundlerResult } from './BundlerResult'
import { Button } from '@/components/ui'
import {BundlePresets} from './BundlePresets'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {creatorFeeRoutingLabel} from '@/lib/creatorFeeRouting'

export function BundlerContent() {
  const store = useBundlerStore()
  const library=useWalletLibraryStore()
  useEffect(() => () => useBundlerStore.getState().cancelPendingActions(), [])
  const exportWalletBackup=()=>{
    const backup={version:1,warning:'Private wallet backup. Anyone with this file can spend these wallets. Store securely.',creator:{publicKey:store.creatorPublicKey,privateKey:store.creatorPrivateKey},wallets:store.bundleWallets.filter(wallet=>wallet.privateKey).map(wallet=>({publicKey:wallet.publicKey,privateKey:wallet.privateKey})),mintPrivateKey:store.foundVanityKey||store.importedMintKey||null}
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download='wallet-outsol-bundle-backup.json';link.click();URL.revokeObjectURL(url)
  }
  
  const validWallets = store.bundleWallets.filter(w => w.isValid && w.buyAmount > 0)
  const sniperCount = validWallets.filter(w => w.mode === 'sniper').length
  const delayedCount = validWallets.filter(w => w.mode === 'delayed').length
  const totalBuyAmount = store.bundleWallets.reduce((sum, w) => sum + (w.buyAmount || 0), 0) + store.devBuyAmount
  
  // Estimate costs
  const createFee = 0
  const jitoTip = store.jitoTip
  const networkFees = 0.005 * (1 + validWallets.length) // rough estimate
  const totalEstimate = createFee + jitoTip + totalBuyAmount + networkFees

  // Check mint is ready based on mode
  const mintReady = 
    store.mintMode === 'random' ||
    (store.mintMode === 'import' && store.importedMintPublicKey) ||
    (store.mintMode === 'vanity' && store.foundVanityPublicKey)

  const canExecute = 
    store.tokenName &&
    store.tokenSymbol &&
    store.tokenImage &&
    store.creatorPublicKey &&
    mintReady &&
    !store.isExecuting &&
    !store.result?.createSignature &&
    store.bundleWallets.every(wallet=>wallet.buyAmount<=0||wallet.isValid) &&
    (!store.managedGroupId||(library.groups.some(group=>group.id===store.managedGroupId)&&[store.managedCreatorWalletId,...store.bundleWallets.filter(wallet=>wallet.buyAmount>0).map(wallet=>wallet.libraryWalletId)].every(id=>!!id&&library.unlockedIds.includes(id)))) &&
    !(store.sniperMode==='block0'&&sniperCount>3)

  return (
    <div className="workspace-card p-5 sm:p-7 max-w-5xl mx-auto">
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-2 border-b border-border pb-5">
          <h2 className="text-base font-medium text-foreground tracking-tight">Bundle configuration</h2>
          <p className="text-muted text-sm">
            Your token, participating wallets and execution preferences.
          </p>
        </div>

        <BundlePresets />

        {/* Warning stays before wallet funding and execution controls. */}
        <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-yellow-500/90">
              <p className="font-medium">Back up generated wallets before funding</p>
              <p className="text-yellow-500/70 mt-1">
                All signing happens in your browser. Back up generated wallets before funding them; managed wallet backups are available in Wallets. Only public receipts and optional public execution presets are saved here. Closing this page stops pending timed buys and sells.
              </p>
            </div>
          </div>
        </div>

        {(store.creatorPrivateKey||store.bundleWallets.some(wallet=>wallet.privateKey))&&<Button variant="secondary" onClick={exportWalletBackup}>Export private wallet backup</Button>}

        {/* Form */}
        <BundlerForm />

        {/* Cost Estimate */}
        <div className="p-4 rounded-lg border border-border bg-surface space-y-2">
          <h3 className="text-sm font-medium text-foreground mb-4">Cost review</h3>
          <p className="text-sm">Creator fees: {store.result?.creatorFeeRouting?creatorFeeRoutingLabel(store.result.creatorFeeRouting):store.result?.createSignature?'Legacy receipt · recipient unverified':creatorFeeRoutingLabel(store.creatorFeeSelection)}</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-muted">OutSol platform fee</div>
            <div className="text-right text-accent">0 SOL · always</div>
            
            <div className="text-muted">Creator buy</div>
            <div className="text-right text-accent">{store.devBuyAmount} SOL</div>
            
            <div className="text-muted">Immediate buys ({sniperCount})</div>
            <div className="text-right text-accent">
              {validWallets.filter(w => w.mode === 'sniper').reduce((sum, w) => sum + w.buyAmount, 0).toFixed(3)} SOL
            </div>
            
            <div className="text-muted">Delayed buys ({delayedCount})</div>
            <div className="text-right text-accent">
              {validWallets.filter(w => w.mode === 'delayed').reduce((sum, w) => sum + w.buyAmount, 0).toFixed(3)} SOL
            </div>
            
            <div className="text-muted">{store.sniperMode==='block0'?'Validator tip':'Validator tip reserve · if needed'}</div><div className="text-right text-accent">{jitoTip} SOL</div>
            
            <div className="text-muted">Network fees and account rent (rough)</div>
            <div className="text-right text-accent">~{networkFees.toFixed(4)} SOL</div>
            
            <div className="border-t border-border pt-3 text-foreground font-medium">Total estimate</div>
            <div className="border-t border-border pt-2 text-right text-accent font-medium">
              ~{totalEstimate.toFixed(4)} SOL
            </div>
          </div>
          <p className="text-sm text-muted">Buy inputs are maximum trade budgets. Pump protocol/creator fees are included in native quotes. Network fees, recipient setup rent and the disclosed validator tip are separate. Recipient setup and long metadata can require an atomic bundle and reduce immediate-buyer capacity below three. A zero tip reserve disables split routes. Actual packet capacity and execution are checked before signing.</p>
          {store.sniperMode==='block0'&&sniperCount>3&&<p className="text-sm text-red-400">Atomic mode allows at most three immediate buyers. Move additional wallets to delayed mode or choose sequential execution.</p>}
        </div>

        {/* Result */}
        <BundlerResult />

        {/* Execute Button */}
        {!store.result?.createSignature && !store.result?.bundleId && (
          <Button
            onClick={store.executeLaunch}
            disabled={!canExecute}
            className="w-full h-12 text-base"
          >
            {store.isExecuting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                {store.statusMessage}
              </span>
            ) : (
              `Launch (${sniperCount > 0 ? `${sniperCount} immediate` : ''}${sniperCount > 0 && delayedCount > 0 ? ' + ' : ''}${delayedCount > 0 ? `${delayedCount} delayed` : ''}${sniperCount === 0 && delayedCount === 0 ? 'create only' : ''})`
            )}
          </Button>
        )}
        {store.isExecuting&&<Button variant="secondary" className="w-full" onClick={store.cancelPendingActions}>Cancel pending browser actions</Button>}
      </div>
    </div>
  )
}
