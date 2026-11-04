'use client'
import { useEffect,useState } from 'react'

import { useBundlerStore } from '@/stores/bundlerStore'
import { BundlerForm } from './BundlerForm'
import { BundlerResult } from './BundlerResult'
import { Button } from '@/components/ui'
import {BundlePresets} from './BundlePresets'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {creatorFeeRoutingLabel} from '@/lib/creatorFeeRouting'
import {BundleWalletControls,useBundleWalletControlPersistence} from './BundleWalletControls'
import {BundleWalletSetup} from './BundleWalletSetup'
import {ManagedBundleWallets} from './ManagedBundleWallets'
import {SniperPairsWorkspace} from './SniperPairsWorkspace'
import styles from './BundlerWorkspace.module.css'

export function BundlerContent() {
  const walletStorageError=useBundleWalletControlPersistence('standalone')
  const store = useBundlerStore()
  const [view,setView]=useState<'launch'|'wallets'>('launch'),[walletBusy,setWalletBusy]=useState(false)
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
    !walletBusy &&
    !store.result?.createSignature &&
    store.bundleWallets.every(wallet=>wallet.buyAmount<=0||wallet.isValid) &&
    (!store.managedGroupId||(library.groups.some(group=>group.id===store.managedGroupId)&&[store.managedCreatorWalletId,...store.bundleWallets.filter(wallet=>wallet.buyAmount>0).map(wallet=>wallet.libraryWalletId)].every(id=>!!id&&library.unlockedIds.includes(id)))) &&
    !(store.sniperMode==='block0'&&sniperCount>3)

  const nextStep = walletBusy
    ? 'Finish the current wallet action before launching.'
    : !store.creatorPublicKey
    ? 'Choose a deployer wallet in Wallets.'
    : !store.tokenName || !store.tokenSymbol || !store.tokenImage
      ? 'Add your token name, symbol and artwork.'
      : !mintReady
        ? 'Finish your mint address settings.'
        : store.sniperMode==='block0'&&sniperCount>3
          ? 'Atomic execution supports at most three immediate buyers; transaction size may reduce this further.'
          : !canExecute && !store.isExecuting && !store.result?.createSignature
            ? 'Review buyer keys and unlock the selected wallet group before launching.'
            : 'Review the wallets, budgets and execution plan before launching.'

  return (
    <div className={styles.workspace}>
      {walletStorageError&&<p role="alert" className="notice notice-error">{walletStorageError}</p>}
      <nav className={styles.viewTabs} aria-label="Bundle workspace">
        <button type="button" aria-pressed={view==='launch'} disabled={store.isExecuting||walletBusy} onClick={()=>setView('launch')}>Launch setup</button>
        <button type="button" aria-pressed={view==='wallets'} disabled={store.isExecuting||walletBusy} onClick={()=>setView('wallets')}>Wallet controls &amp; sales</button>
      </nav>
      <div hidden={view!=='launch'}>
        <ol className={styles.progress} aria-label="Launch setup sections">
          <li><a href="#bundle-wallets"><span>01</span>Wallets</a></li>
          <li><a href="#bundle-token"><span>02</span>Token</a></li>
          <li><a href="#bundle-execution"><span>03</span>Execution</a></li>
          <li><a href="#bundle-review"><span>04</span>Review &amp; launch</a></li>
        </ol>
        <section id="bundle-wallets" className={styles.walletSection} aria-labelledby="bundle-wallets-title">
          <div className={styles.sectionHeading}><span>01</span><div><h2 id="bundle-wallets-title">Prepare your wallets</h2><p>A sniper wallet buys. Its receiver holds the purchased tokens and can sell them later. Keep both wallets for another launch.</p></div></div>
          {view==='launch'&&<SniperPairsWorkspace mode="standalone" onBusyChange={setWalletBusy}/>}
          <p className={styles.fundingNote}><strong>Before you fund:</strong> download the wallet backup. Then send SOL to the deployer and sniper addresses yourself. Receiving tokens may also require account rent, which is included in the transaction checks.</p>
          {(store.creatorPrivateKey||store.bundleWallets.some(wallet=>wallet.privateKey))&&<div className={styles.backupNotice}>
            <div><h3>Keep a private wallet backup</h3><p>Anyone with this file can spend these wallets. Save it securely before adding SOL. Browser-timed buys and sells stop when this page closes.</p></div>
            <Button variant="secondary" onClick={exportWalletBackup}>Download private backup</Button>
          </div>}
        </section>
        <div className={styles.launchGrid}>
          <div className={styles.formColumn}>
            <fieldset disabled={walletBusy} className={styles.formGuard}><BundlerForm /></fieldset>
            <details className={styles.optional}>
              <summary>Saved launch presets<span>Optional</span></summary>
              <div className={styles.optionalBody}><p className={styles.help}>Apply a reusable execution preset, then review its wallet amounts and timing.</p><BundlePresets /></div>
            </details>
          </div>
          <aside id="bundle-review" className={styles.reviewColumn} aria-labelledby="bundle-review-title">
            <div className={styles.reviewCard}>
              <div className={styles.reviewHeading}><span>04</span><div><h2 id="bundle-review-title">Review &amp; launch</h2><p>Planning estimate · SOL</p></div></div>
              <div className={styles.tokenIdentity}><strong>{store.tokenName||'Your token'}</strong><span>{store.tokenSymbol?'$'+store.tokenSymbol:'Add token details'}</span></div>
              <dl className={styles.reviewContext}><div><dt>Deployer</dt><dd>{store.creatorPublicKey?store.creatorPublicKey.slice(0,6)+'…'+store.creatorPublicKey.slice(-4):'Not selected'}</dd></div><div><dt>Execution</dt><dd>{store.sniperMode==='block0'?'Atomic · Block 0':'After confirmation'}</dd></div></dl>
              <dl className={styles.costs}>
                <div><dt>LaunchPier platform fee</dt><dd className={styles.free}>0 SOL</dd></div>
                <div><dt>Deployer buy</dt><dd>{store.devBuyAmount} SOL</dd></div>
                <div><dt>Immediate buys <span>({sniperCount})</span></dt><dd>{validWallets.filter(w=>w.mode==='sniper').reduce((sum,w)=>sum+w.buyAmount,0).toFixed(3)} SOL</dd></div>
                <div><dt>Delayed buys <span>({delayedCount})</span></dt><dd>{validWallets.filter(w=>w.mode==='delayed').reduce((sum,w)=>sum+w.buyAmount,0).toFixed(3)} SOL</dd></div>
                <div><dt>{store.sniperMode==='block0'?'Validator tip':'Tip reserve, if needed'}</dt><dd>{jitoTip} SOL</dd></div>
                <div><dt>Network &amp; rent <span>(rough)</span></dt><dd>~{networkFees.toFixed(4)} SOL</dd></div>
                <div className={styles.total}><dt>Estimated outflow</dt><dd>~{totalEstimate.toFixed(4)} SOL</dd></div>
              </dl>
              <p className={styles.help}>Buy budgets purchase tokens; they are not platform fees. Protocol and creator charges are included in native quotes. Network costs, account rent and validator tips are separate.</p>
              <details className={styles.costDetails}><summary>Execution and cost details</summary><p>Buy inputs are maximum trade budgets. Long metadata and recipient setup can require more packets and reduce atomic buyer capacity below three. A zero tip reserve disables split routes. Packet capacity and execution are checked before signing.</p><p>Creator fees: {store.result?.creatorFeeRouting?creatorFeeRoutingLabel(store.result.creatorFeeRouting):store.result?.createSignature?'Legacy receipt · recipient unverified':creatorFeeRoutingLabel(store.creatorFeeSelection)}</p></details>
              {store.sniperMode==='block0'&&sniperCount>3&&<p className={styles.error} role="alert">Use at most three immediate buyers for atomic mode. Move other wallets to delayed timing or choose after-confirmation execution.</p>}
              {!store.result?.createSignature&&!store.result?.bundleId&&<div className={styles.launchAction}>
                <p className={styles.nextStep}>{nextStep}</p>
                <Button onClick={store.executeLaunch} disabled={!canExecute} className={styles.launchButton}>
                  {store.isExecuting?<span className={styles.executing}><span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin"/>{store.statusMessage}</span>:'Launch token'}
                </Button>
                <p className={styles.signingNote}>Signs and sends using your selected wallets. Review everything above before continuing.</p>
              </div>}
              {store.isExecuting&&<Button variant="secondary" className="w-full mt-3" onClick={store.cancelPendingActions}>Cancel pending browser actions</Button>}
            </div>
            <BundlerResult />
            {store.result?.createSignature&&<Button variant="secondary" className="w-full" disabled={store.isExecuting||walletBusy} onClick={()=>setView('wallets')}>Open wallet controls &amp; sales</Button>}
          </aside>
        </div>
      </div>
      {view==='wallets'&&<div className={styles.walletControls}>
        <div className={styles.controlsIntro}><h2>Manage your bundle wallets</h2><p>Inspect balances, transfer purchased tokens to receivers, back up keys or review a sale. Every action uses the wallets selected for this bundle.</p></div>
        <fieldset disabled={walletBusy||store.isExecuting} className="space-y-5"><ManagedBundleWallets/><BundleWalletSetup mode="standalone" disabled={walletBusy||store.isExecuting}/></fieldset>
        <BundleWalletControls mode="standalone" onBusyChange={setWalletBusy}/>
      </div>}
    </div>
  )
}
