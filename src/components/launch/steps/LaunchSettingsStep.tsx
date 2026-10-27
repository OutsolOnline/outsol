'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, ExternalLink, FolderOpen, KeyRound, Layers3, Loader2, LockKeyhole, Plus, ShieldCheck, SlidersHorizontal, UnlockKeyhole, Upload, Wallet, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLaunchStore } from '@/stores/launchStore'
import { usePlatformWalletStore } from '@/stores/walletStore'
import { useWalletLibraryStore, type WalletSummary } from '@/stores/walletLibraryStore'
import { DEFAULT_LAUNCH_BUNDLE_SETTINGS, parseLaunchBundleSettings, validateLaunchBundleSettings, type LaunchBundleSettings } from '@/lib/launchBundle/types'
import styles from './LaunchSettings.module.css'
import {CreatorFeeFields} from '../CreatorFeeFields'
import {requireSupportedCreatorFeeSelection} from '@/lib/creatorFeeRouting'

const MAX_BUYERS = 16
const modes: Array<{ id: LaunchBundleSettings['mode']; title: string; subtitle: string; Icon: typeof Zap }> = [
  { id: 'block0', title: 'Block-0', subtitle: 'Atomic Jito bundle', Icon: Zap },
  { id: 'organic', title: 'Organic', subtitle: 'Spaced wallet buys', Icon: Clock3 },
  { id: 'manual', title: 'Manual', subtitle: 'Per-wallet timing', Icon: SlidersHorizontal },
]
const formatSol = (value: number) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 9 }) : '—'
const shortAddress = (value: string) => value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value
const numericValue = (value: number) => Number.isFinite(value) ? value : ''

export function LaunchSettingsStep() {
  const store = useLaunchStore(), library = useWalletLibraryStore(), platform = usePlatformWalletStore(), external = useWallet()
  const settings = store.bundleSettings || DEFAULT_LAUNCH_BUNDLE_SETTINGS
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pendingGroup, setPendingGroup] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState(''), [unlockTarget, setUnlockTarget] = useState('all'), [unlocking, setUnlocking] = useState(false), [unlockError, setUnlockError] = useState('')
  const [reloading, setReloading] = useState(false)
  const alive = useRef(true), unlockInput = useRef<HTMLInputElement>(null), errorBox = useRef<HTMLDivElement>(null)
  const hydrate = library.hydrate
  useEffect(() => { alive.current = true; hydrate(); return () => { alive.current = false } }, [hydrate])

  const payer = store.usePlatformWallet ? platform.getPublicKey() : external.publicKey?.toBase58()
  const group = library.groups.find(item => item.id === settings.groupId)
  const selectedIds = new Set(settings.wallets.map(item => item.walletId))
  const selectedLocked = settings.wallets.filter(item => !library.unlockedIds.includes(item.walletId) && library.wallets.some(wallet => wallet.id === item.walletId && wallet.publicKey === item.publicKey))
  const positiveWallets = settings.wallets.filter(item => Number.isFinite(item.buySol) && item.buySol > 0)
  const buyerBuySol = positiveWallets.reduce((sum, item) => sum + item.buySol, 0)
  const creatorBuySol = Number.isFinite(store.config.devBuySol) && store.config.devBuySol > 0 ? store.config.devBuySol : 0
  const totalBuySol = creatorBuySol + buyerBuySol
  const creatorShare = totalBuySol > 0 ? creatorBuySol / totalBuySol * 100 : 0
  const invalidSettings = validateLaunchBundleSettings(settings)
  const blocked = store.isLoading || unlocking || reloading

  const members: WalletSummary[] = (group ? group.walletIds.map(id => library.wallets.find(wallet => wallet.id === id)).filter((item): item is WalletSummary => Boolean(item)) : [])
  for (const row of settings.wallets) if (!members.some(item => item.id === row.walletId)) members.push(library.wallets.find(item => item.id === row.walletId) || { id: row.walletId, publicKey: row.publicKey, name: row.name, createdAt: '' })

  const change = (patch: Partial<LaunchBundleSettings>) => {
    const current = useLaunchStore.getState()
    current.setBundleSettings({ ...current.bundleSettings, ...patch })
    setError(''); setNotice('')
  }
  const changeWallet = (walletId: string, patch: { buySol?: number; delaySeconds?: number }) => {
    const current = useLaunchStore.getState()
    current.setBundleSettings({ ...current.bundleSettings, wallets: current.bundleSettings.wallets.map(row => row.walletId === walletId ? { ...row, ...patch } : row) })
    setError(''); setNotice('')
  }
  const applyGroup = (id: string) => {
    const currentLibrary = useWalletLibraryStore.getState(), nextGroup = currentLibrary.groups.find(item => item.id === id)
    if (id && !nextGroup) { setError('This wallet group is no longer available. Your current selection is preserved.'); return }
    const eligible = (nextGroup?.walletIds || []).map(walletId => currentLibrary.wallets.find(item => item.id === walletId)).filter((wallet): wallet is WalletSummary => Boolean(wallet) && wallet?.publicKey !== payer)
    change({ groupId: id || null, wallets: eligible.slice(0, MAX_BUYERS).map(wallet => ({ walletId: wallet.id, publicKey: wallet.publicKey, name: wallet.name, buySol: 0, delaySeconds: 0 })) })
    setPendingGroup(null); setPassphrase(''); setUnlockTarget('all'); setUnlockError('')
    setNotice(id ? `${Math.min(eligible.length, MAX_BUYERS)} wallet${eligible.length === 1 ? '' : 's'} included at 0 SOL. Set amounts only for the wallets you want to buy.${eligible.length > MAX_BUYERS ? ' Only the first 16 eligible wallets were included; use the checkboxes to change that selection.' : ''}` : 'Additional wallet buys removed. Your token details and creator buy are preserved.')
  }
  const chooseGroup = (id: string) => {
    if ((settings.groupId || '') === id) return
    if (settings.wallets.some(wallet => wallet.buySol > 0)) { setPendingGroup(id); return }
    applyGroup(id)
  }
  const toggleWallet = (wallet: WalletSummary) => {
    const current = useLaunchStore.getState(), chosen = current.bundleSettings.wallets.some(row => row.walletId === wallet.id)
    if (chosen) change({ wallets: current.bundleSettings.wallets.filter(row => row.walletId !== wallet.id) })
    else {
      if (current.bundleSettings.wallets.length >= MAX_BUYERS) { setError('Choose up to 16 buyer wallets. Deselect one before including another.'); return }
      if (wallet.publicKey === payer) { setError('The signing wallet cannot also be an additional buyer.'); return }
      change({ wallets: [...current.bundleSettings.wallets, { walletId: wallet.id, publicKey: wallet.publicKey, name: wallet.name, buySol: 0, delaySeconds: 0 }] })
    }
  }
  const unlock = async () => {
    if (blocked || !passphrase || !selectedLocked.length) return
    const ids = unlockTarget === 'all' ? selectedLocked.map(item => item.walletId) : selectedLocked.filter(item => item.walletId === unlockTarget).map(item => item.walletId)
    if (!ids.length) { setUnlockError('Choose a locked wallet from your current selection.'); return }
    const secret = passphrase; setPassphrase(''); setUnlocking(true); setUnlockError('')
    try { await library.unlockWallets(ids, secret); if (alive.current) { setUnlockTarget('all'); setNotice(`${ids.length} wallet${ids.length === 1 ? '' : 's'} unlocked in this browser. Private keys remain in memory.`) } }
    catch (failure) { if (alive.current) { setUnlockError(failure instanceof Error ? failure.message : 'The selected wallets could not be unlocked. Check the passphrase and try again.'); unlockInput.current?.focus() } }
    finally { if (alive.current) setUnlocking(false) }
  }
  const reload = async () => {
    if (blocked) return
    setReloading(true); setError('')
    try { await library.reload(); if (alive.current) setNotice('Wallet library reloaded. Unlock your selected wallets again in this browser before preparing the launch.') }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'The wallet library could not be reloaded. Your launch settings are preserved.') }
    finally { if (alive.current) setReloading(false) }
  }
  const next = () => {
    try {
      const reviewed = parseLaunchBundleSettings(settings)
      requireSupportedCreatorFeeSelection(store.config.creatorFeeSelection)
      if (!Number.isFinite(store.config.devBuySol) || store.config.devBuySol < 0 || store.config.devBuySol > 1000) throw new Error('Set a creator first buy from 0 to 1,000 SOL, or leave it at 0.')
      if (payer && reviewed.wallets.some(wallet => wallet.buySol > 0 && wallet.publicKey === payer)) throw new Error('Remove the signing wallet from the additional buyers before continuing.')
      store.setBundleSettings(reviewed); setError(''); store.nextStep()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Review your wallet amounts and timing before continuing.'); requestAnimationFrame(() => errorBox.current?.focus()) }
  }

  return <div className={styles.settings}>
    <div className={styles.heading}><span className={styles.sectionIcon}><Layers3 size={19} /></span><div><h2>Launch settings</h2><p>Choose how your launch begins. Every wallet buy stays yours to review.</p></div></div>

    <fieldset disabled={blocked} className={styles.modeFieldset}>
      <legend className={styles.label}>Execution style</legend>
      <div className={styles.modes}>{modes.map(({ id, title, subtitle, Icon }) => <label key={id} className={`${styles.mode} ${settings.mode === id ? styles.selectedMode : ''}`}><input type="radio" name="launch-bundle-mode" value={id} checked={settings.mode === id} onChange={() => change({ mode: id })} aria-label={title} aria-describedby="launch-mode-help" /><div className={styles.modeTop}><Icon size={17} strokeWidth={1.7} /><span className={styles.radioMark}>{settings.mode === id && <Check size={10} strokeWidth={2.5} />}</span></div><strong>{title}</strong><span>{subtitle}</span></label>)}</div>
      <p id="launch-mode-help" className={styles.modeHelp}>{settings.mode === 'block0' ? 'Token creation and up to three buyer wallets share an atomic Jito bundle. Metadata can reduce capacity. Simulation checks the packet limit; landing and the first block are not guaranteed.' : settings.mode === 'organic' ? 'After creation confirms, your buys are spaced by a random interval. Activity remains public on Solana. Browser timing can run late and stops when this page closes.' : 'After creation confirms, each included wallet buys with the delay you choose. With no additional buyer amounts, this is a creator-only launch.'}</p>
    </fieldset>

    <section className={styles.creatorSection} aria-labelledby="launch-creator-buy-title"><div><h3 id="launch-creator-buy-title">Creator first buy</h3><p>Optional. Paid by the signing wallet you choose next.</p></div><div className={styles.creatorAmount}><label className="sr-only" htmlFor="launch-creator-buy">Creator first buy in SOL</label><Input id="launch-creator-buy" type="number" min="0" max="1000" step="0.001" inputMode="decimal" value={numericValue(store.config.devBuySol)} disabled={blocked} onChange={event => { store.setConfig({ devBuySol: event.currentTarget.valueAsNumber }); setError('') }} /><span>SOL</span></div></section>

    <section className="py-6 border-b border-border"><CreatorFeeFields value={store.config.creatorFeeSelection} onChange={selection=>{store.setConfig({creatorFeeSelection:selection});setError('')}} disabled={blocked} idPrefix="launch-fees"/></section>

    <section className={styles.walletSection} aria-labelledby="launch-buyers-title">
      <div className={styles.sectionTop}><div><span className={styles.eyebrow}>ADDITIONAL WALLET BUYS</span><h3 id="launch-buyers-title">Bring your wallets into the launch.</h3></div><span className={styles.walletCount}>{settings.wallets.length}/{MAX_BUYERS}</span></div>
      <p className={styles.sectionCopy}>Choose a vault group, then review which wallets participate and how much each buys. New selections start at 0 SOL.</p>
      <div className={styles.groupField}><label htmlFor="launch-wallet-group" className={styles.label}>Wallet group</label><div className={styles.selectWrap}><FolderOpen size={16} /><select id="launch-wallet-group" value={settings.groupId || ''} disabled={blocked || !library.hydrated || library.storageUnavailable} onChange={event => chooseGroup(event.target.value)}><option value="">No additional wallets</option>{settings.groupId && !group && <option value={settings.groupId}>Saved group · unavailable</option>}{library.groups.map(item => <option key={item.id} value={item.id}>{item.name} · {item.walletIds.length} wallet{item.walletIds.length === 1 ? '' : 's'}</option>)}</select><ChevronDown size={14} /></div></div>

      {pendingGroup !== null && <div className={styles.changeNotice} role="alert"><p>Changing the group removes the current buyer amounts and starts the new selection at 0 SOL. Your creator buy stays unchanged.</p><div><Button size="sm" variant="secondary" disabled={blocked} onClick={() => applyGroup(pendingGroup)}>Change group</Button><Button size="sm" variant="ghost" disabled={blocked} onClick={() => setPendingGroup(null)}>Keep current group</Button></div></div>}

      <div className={styles.walletActions}><Link href="/wallet?action=create" target="_blank" rel="noopener noreferrer"><Plus size={13} />Create wallets<ExternalLink size={11} /></Link><Link href="/wallet?action=import" target="_blank" rel="noopener noreferrer"><Upload size={13} />Import wallets<ExternalLink size={11} /></Link><button type="button" disabled={blocked || !library.hydrated || library.busy} onClick={() => void reload()}>{reloading && <Loader2 size={12} className="animate-spin" />}Reload library</button></div>
      <p className={styles.actionHelp}>Wallet tools open in another tab. After making changes, reload the library here; reloading locks its wallets until you unlock them again.</p>

      {!library.hydrated ? <div role="status" className={styles.emptyWallets}><Loader2 size={19} className="animate-spin" /><p>Loading your wallet library…</p></div> : library.storageUnavailable ? <div role="alert" className={styles.libraryError}><LockKeyhole size={18} /><p>{library.error || 'Your wallet library is unavailable. Existing launch settings are preserved. Reload when storage is available.'}</p></div> : !members.length ? <div className={styles.emptyWallets}><span><Wallet size={23} strokeWidth={1.4} /></span><p>{group ? 'This group has no available buyer wallets.' : 'Your signing wallet can launch on its own.'}<small>{group ? 'Add wallets to this group, then reload the library.' : 'Choose a group above to include additional buys.'}</small></p></div> : <>
        {!group && settings.groupId && <p role="alert" className={styles.libraryError}>This group is no longer available. Your saved amounts are preserved below. Choose an available group before preparing additional buys.</p>}
        <div className={styles.walletTable} role="group" aria-label="Buyer wallet amounts"><div className={`${styles.walletRow} ${styles.tableHeader}`} aria-hidden="true"><span /><span>Wallet</span><span>Buy amount</span>{settings.mode === 'manual' && <span>Delay</span>}</div>{members.map(member => {
          const selected = selectedIds.has(member.id), row = settings.wallets.find(item => item.walletId === member.id), isPayer = member.publicKey === payer
          const available = library.wallets.some(item => item.id === member.id && item.publicKey === member.publicKey) && Boolean(group?.walletIds.includes(member.id))
          const unlocked = library.unlockedIds.includes(member.id)
          return <div className={`${styles.walletRow} ${settings.mode === 'manual' ? styles.manualRow : ''} ${!selected ? styles.excludedRow : ''}`} key={member.id}>
            <input id={`launch-include-${member.id}`} className={styles.includeBox} type="checkbox" checked={selected} disabled={blocked || !selected && (!available || isPayer || settings.wallets.length >= MAX_BUYERS)} onChange={() => toggleWallet(member)} aria-label={`${selected ? 'Exclude' : 'Include'} ${member.name}`} />
            <div className={styles.walletIdentity}><label htmlFor={`launch-include-${member.id}`}>{member.name}</label><span className={styles.walletAddress}>{shortAddress(member.publicKey)}</span><span className={`${styles.lockState} ${unlocked && available ? styles.unlocked : ''}`}>{!available ? 'Unavailable · remove this row' : isPayer ? 'Signing wallet · exclude from buyers' : unlocked ? <><UnlockKeyhole size={10} />Unlocked</> : <><LockKeyhole size={10} />Locked</>}</span></div>
            <div className={styles.rowAmount}><label htmlFor={`launch-buy-${member.id}`} className={styles.mobileFieldLabel}>Buy amount</label><div><Input id={`launch-buy-${member.id}`} type="number" min="0" max="1000" step="0.001" inputMode="decimal" aria-label={`${member.name} buy amount in SOL`} value={numericValue(row?.buySol ?? 0)} disabled={blocked || !selected || !available || isPayer} onChange={event => changeWallet(member.id, { buySol: event.currentTarget.valueAsNumber })} /><span>SOL</span></div></div>
            {settings.mode === 'manual' && <div className={styles.rowDelay}><label htmlFor={`launch-delay-${member.id}`} className={styles.mobileFieldLabel}>Delay</label><div><Input id={`launch-delay-${member.id}`} type="number" min="0" max="3600" step="1" inputMode="numeric" aria-label={`${member.name} delay in seconds after creation confirms`} value={numericValue(row?.delaySeconds ?? 0)} disabled={blocked || !selected || !available || isPayer} onChange={event => changeWallet(member.id, { delaySeconds: event.currentTarget.valueAsNumber })} /><span>sec</span></div></div>}
          </div>
        })}</div><p className={styles.rowHelp}>Only included wallets with a buy amount above 0 participate. {settings.mode === 'manual' ? 'A 0-second delay starts after token creation confirms.' : settings.mode === 'block0' ? 'Keep at most three positive buyer amounts; actual packet capacity is checked during preparation.' : 'Buys follow the interval range below.'}</p>
      </>}

      {settings.mode === 'organic' && <fieldset disabled={blocked} className={styles.intervals}><legend>Time between wallet buys</legend><div><label htmlFor="launch-organic-min">Minimum gap</label><div className={styles.intervalInput}><Input id="launch-organic-min" type="number" min="0" max="3600" step="1" value={numericValue(settings.intervalMinSeconds)} onChange={event => change({ intervalMinSeconds: event.currentTarget.valueAsNumber })} /><span>sec</span></div></div><span className={styles.intervalDash}>–</span><div><label htmlFor="launch-organic-max">Maximum gap</label><div className={styles.intervalInput}><Input id="launch-organic-max" type="number" min="0" max="3600" step="1" value={numericValue(settings.intervalMaxSeconds)} onChange={event => change({ intervalMaxSeconds: event.currentTarget.valueAsNumber })} /><span>sec</span></div></div></fieldset>}

      {selectedLocked.length > 0 && !library.storageUnavailable && <form className={styles.unlockForm} onSubmit={event => { event.preventDefault(); void unlock() }}><div className={styles.unlockHeading}><KeyRound size={16} /><div><h4>Unlock wallets in this browser</h4><p>Private keys stay in memory. Your passphrase is never saved with the launch.</p></div></div><label htmlFor="launch-unlock-target" className={styles.label}>Wallets to unlock</label><select id="launch-unlock-target" value={unlockTarget} disabled={blocked || library.busy} onChange={event => setUnlockTarget(event.target.value)}><option value="all">All {selectedLocked.length} selected locked wallets</option>{selectedLocked.map(row => <option key={row.walletId} value={row.walletId}>{row.name}</option>)}</select><div className={styles.unlockControls}><div><label htmlFor="launch-bundle-passphrase" className={styles.label}>Vault passphrase</label><Input ref={unlockInput} id="launch-bundle-passphrase" type="password" autoComplete="off" value={passphrase} disabled={blocked || library.busy} onChange={event => setPassphrase(event.target.value)} placeholder="Enter your vault passphrase" /></div><Button type="submit" variant="secondary" disabled={blocked || library.busy || !passphrase}>{unlocking ? <Loader2 size={15} className="animate-spin" /> : <UnlockKeyhole size={14} />}{unlocking ? 'Unlocking…' : 'Unlock'}</Button></div><p className={styles.actionHelp}>Unlock a group together if its wallets share a passphrase, or choose one wallet at a time.</p>{unlockError && <p role="alert" className={styles.errorText}>{unlockError}</p>}</form>}
    </section>

    <section className={styles.allocation} aria-labelledby="launch-allocation-title"><div className={styles.allocationHeading}><div><span className={styles.eyebrow}>YOUR LAUNCH ALLOCATION</span><h3 id="launch-allocation-title">{formatSol(totalBuySol)} <span>SOL in planned buys</span></h3></div><span>{positiveWallets.length} active buyer{positiveWallets.length === 1 ? '' : 's'}</span></div><div className={styles.allocationBar} aria-hidden="true"><span style={{ width: `${creatorShare}%` }} /><span style={{ width: `${totalBuySol > 0 ? 100 - creatorShare : 0}%` }} /></div><dl><div><dt><i className={styles.creatorDot} />Creator first buy</dt><dd>{formatSol(creatorBuySol)} SOL</dd></div><div><dt><i className={styles.buyerDot} />Additional wallet buys</dt><dd>{formatSol(buyerBuySol)} SOL</dd></div><div className={styles.feeRow}><dt>OutSol platform fee</dt><dd>0%</dd></div><div><dt>Network, rent & protocol costs</dt><dd>After simulation</dd></div>{settings.mode === 'block0' && <div><dt>Validator tip</dt><dd>Reviewed before signing</dd></div>}</dl><p>Amounts represent maximum SOL buy budgets. Full launch costs are checked before you sign.</p></section>

    {invalidSettings.length > 0 && <p role="status" className={styles.validationNote}>{invalidSettings[0]}</p>}
    {notice && <p role="status" className={styles.notice}><Check size={14} /><span>{notice}</span></p>}
    {error && <div className={styles.errorBox} ref={errorBox} tabIndex={-1} role="alert">{error}</div>}
    <div className={styles.footer}><p><ShieldCheck size={14} />Nothing is funded or sent from this screen.</p><div><Button type="button" variant="ghost" disabled={blocked} onClick={store.prevStep}><ArrowLeft size={14} />Back to mint</Button><Button type="button" disabled={blocked} onClick={next}>Choose signing wallet<ArrowRight size={15} /></Button></div></div>
  </div>
}
