'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { VersionedTransaction } from '@solana/web3.js'
import { ArrowRight, Check, ExternalLink, Loader2, Plus, RefreshCw, Send, Trash2, Users, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { usePlatformWalletStore } from '@/stores/walletStore'
import { useBundlerStore } from '@/stores/bundlerStore'
import { readPending } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { formatUnits, type WalletOperationInput, type WalletRecipientInput } from '@/lib/walletOperations/model'
import { prepareWalletOperation, readWalletTokenAccounts, type PreparedWalletOperation, type WalletTokenAccount } from '@/lib/walletOperations/builder'
import { assertNoPendingWalletOperation, readPendingWalletOperation, readWalletOperationHistory, type PendingWalletOperation, type WalletOperationReceipt } from '@/lib/walletOperations/history'
import { readWalletGroups, removeWalletGroup, saveWalletGroup, type WalletGroup } from '@/lib/walletOperations/groups'
import { reconcilePendingWalletOperation } from '@/lib/walletOperations/recovery'
import { submitReviewedWalletOperation } from '@/lib/walletOperations/submission'
import { assertNoPendingBundleReceipt } from '@/lib/bundler/pending'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'

type Status = 'idle' | 'scanning' | 'preparing' | 'ready' | 'signing' | 'sending' | 'checking' | 'confirmed' | 'failed' | 'unknown'
const blankRecipient = (): WalletRecipientInput => ({ address: '', amount: '' })
const sol = (raw: string) => `${formatUnits(raw, 9)} SOL`

export function WalletOperations() {
  const { connection } = useConnection(), external = useWallet(), vault = usePlatformWalletStore()
  const [source, setSource] = useState<'external' | 'vault'>('external')
  const [kind, setKind] = useState<'sol' | 'token' | 'close'>('sol')
  const [recipients, setRecipients] = useState<WalletRecipientInput[]>([blankRecipient()])
  const [mint, setMint] = useState(''), [tokenSource, setTokenSource] = useState(''), [priority, setPriority] = useState('0.00001')
  const [accounts, setAccounts] = useState<WalletTokenAccount[]>([]), [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [groups, setGroups] = useState<WalletGroup[]>([]), [groupName, setGroupName] = useState(''), [groupAddresses, setGroupAddresses] = useState('')
  const [prepared, setPrepared] = useState<PreparedWalletOperation | null>(null), [approved, setApproved] = useState(false)
  const [pending, setPending] = useState<PendingWalletOperation | null>(null), [history, setHistory] = useState<WalletOperationReceipt[]>([])
  const [status, setStatus] = useState<Status>('idle'), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const operation = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null)
  const sourceRef = useRef(source)
  const externalAdapter = useRef(external.wallet?.adapter)
  useEffect(() => { sourceRef.current = source; externalAdapter.current = external.wallet?.adapter }, [source, external.wallet?.adapter])
  const payer = source === 'vault' ? vault.getPublicKey() || vault.getSelectedAddress() : external.publicKey?.toBase58()
  const canSign = source === 'vault' ? !!vault.getPublicKey() : !!(external.publicKey && external.signTransaction)
  const busy = ['scanning', 'preparing', 'signing', 'sending', 'checking'].includes(status)
  const blocked = !!pending || status === 'unknown'
  const signerNow = () => sourceRef.current === 'vault' ? usePlatformWalletStore.getState().getPublicKey() : externalAdapter.current?.publicKey?.toBase58()

  const refreshRecords = () => { setPending(readPendingWalletOperation()); setHistory(readWalletOperationHistory()); setGroups(readWalletGroups()) }
  useEffect(() => {
    alive.current = true; usePlatformWalletStore.getState().hydrateWallet()
    const refresh = () => { try { refreshRecords() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Local operation records are unavailable.'); setStatus('unknown') } }
    refresh(); window.addEventListener('storage', refresh)
    return () => { alive.current = false; controller.current?.abort(); window.removeEventListener('storage', refresh) }
  }, [])
  useEffect(() => { setPrepared(null); setApproved(false); setAccounts([]); setSelectedAccounts([]) }, [payer])
  const resetReview = () => { setPrepared(null); setApproved(false); setError(''); setNotice(''); if (!pending && status !== 'unknown') setStatus('idle') }
  const assertOtherOperationsAvailable = () => {
    assertNoPendingGroupOperation()
    assertNoPendingBundleReceipt()
    if (!alive.current) throw new Error('The wallet operations page was closed. Nothing new was submitted.')
    if (readPending() || readTradePending()) throw new Error('Check the pending launch or trade in Activity before moving funds.')
    const bundle = useBundlerStore.getState()
    if (bundle.isExecuting || bundle.result?.status === 'unknown') throw new Error('Finish or check the active bundle before moving funds.')
  }
  const scan = async () => {
    if (operation.current || !payer) return
    operation.current = true; setError(''); setStatus('scanning'); setPrepared(null); setApproved(false)
    const requestedPayer = payer
    try {
      const inventory = await readWalletTokenAccounts(connection, requestedPayer)
      if (alive.current && signerNow() === requestedPayer) { setAccounts(inventory); setSelectedAccounts([]); setStatus('idle'); setNotice(`${inventory.length} token accounts checked. Choose an account below.`) }
      else if (alive.current) { setStatus('idle'); setError('The selected wallet changed. Scan again.') }
    } catch (failure) { if (alive.current) { setError(failure instanceof Error ? failure.message : 'Token accounts could not be loaded.'); setStatus('failed') } }
    finally { operation.current = false }
  }
  const prepare = async () => {
    if (operation.current || !payer || !canSign) return
    operation.current = true; setStatus('preparing'); setError(''); setNotice(''); setPrepared(null); setApproved(false)
    try {
      assertOtherOperationsAvailable(); assertNoPendingWalletOperation()
      const input: WalletOperationInput = kind === 'close' ? { kind, payer, priorityFeeSol: priority, accounts: selectedAccounts } : kind === 'token' ? { kind, payer, priorityFeeSol: priority, recipients, mint, ...(tokenSource ? { sourceAccount: tokenSource } : {}) } : { kind, payer, priorityFeeSol: priority, recipients }
      const plan = await prepareWalletOperation(connection, input)
      if (!alive.current || signerNow() !== payer) throw new Error('The selected wallet changed. Prepare a new preview.')
      assertOtherOperationsAvailable(); assertNoPendingWalletOperation()
      setPrepared(plan); setStatus('ready')
    } catch (failure) { if (alive.current) { setError(failure instanceof Error ? failure.message : 'This operation could not be prepared.'); setStatus('failed') } }
    finally { operation.current = false }
  }
  const sign = async () => {
    if (operation.current || !prepared || !approved || !canSign) return
    operation.current = true; controller.current = new AbortController(); setStatus('signing'); setError(''); setNotice('')
    try {
      const result = await submitReviewedWalletOperation(connection, prepared, {
        approved, readSigner: signerNow, assertAvailable: assertOtherOperationsAvailable, signal: controller.current.signal,
        signTransaction: async transaction => {
          if (sourceRef.current === 'vault') return await usePlatformWalletStore.getState().signTransaction(transaction) as VersionedTransaction
          if (!external.signTransaction) throw new Error('Connect a wallet that can sign transactions.')
          return external.signTransaction(transaction)
        },
        onPending: record => { if (alive.current) { setPending(record); setStatus('sending') } },
      })
      if (!alive.current) return
      refreshRecords(); setPrepared(null); setApproved(false)
      const currentPending = readPendingWalletOperation()
      if (currentPending) { setStatus('unknown'); setError(result.receipt.error || result.recovery?.error || 'Confirmation is unknown. Check the saved signature before sending another operation.') }
      else { setStatus(result.receipt.status === 'confirmed' ? 'confirmed' : 'failed'); if (result.receipt.status !== 'confirmed') setError(result.receipt.error || 'The operation did not complete.') }
      setAccounts([]); setSelectedAccounts([])
      if (sourceRef.current === 'vault') void usePlatformWalletStore.getState().refreshBalance()
    } catch (failure) {
      if (alive.current) { let current: PendingWalletOperation | null = null, unreadable = false; try { current = readPendingWalletOperation(); setPending(current) } catch { unreadable = true }; setPrepared(null); setApproved(false); setStatus(current || unreadable ? 'unknown' : 'failed'); setError(failure instanceof Error ? failure.message : 'The operation did not complete.') }
    } finally { operation.current = false; controller.current = null }
  }
  const recover = async () => {
    if (operation.current) return
    operation.current = true; setStatus('checking'); setError('')
    try {
      const result = await reconcilePendingWalletOperation(connection)
      if (!alive.current) return
      refreshRecords(); setStatus(result.pending ? 'unknown' : result.status === 'confirmed' || result.status === 'failed' ? result.status : 'idle')
      if (result.error) setError(result.error)
    } catch (failure) { if (alive.current) { setStatus('unknown'); setError(failure instanceof Error ? failure.message : 'Confirmation could not be checked.') } }
    finally { operation.current = false }
  }
  const saveGroup = () => {
    setError(''); setNotice('')
    try {
      const group = saveWalletGroup({ name: groupName, addresses: groupAddresses.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean) })
      setGroups(readWalletGroups()); setGroupName(''); setGroupAddresses(''); setNotice(`“${group.name}” saved with public recipient addresses.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The group could not be saved.') }
  }
  const currentPreview = prepared?.preview, units = prepared?.intent.kind === 'token' ? prepared.intent.decimals! : 9

  return <div className="grid xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.85fr)] gap-6 items-start text-sm">
    <div className="space-y-6">
      <section className="workspace-card p-5 sm:p-7"><h2 className="text-lg font-medium flex gap-2 items-center"><Wallet size={18} className="text-accent" />Sending wallet</h2><fieldset disabled={busy} className="space-y-4 mt-5"><div className="launch-mode-tabs" role="group" aria-label="Sending wallet"><button className={`launch-mode-tab ${source === 'external' ? 'selected' : ''}`} aria-pressed={source === 'external'} onClick={() => { setSource('external'); resetReview() }}>Connected wallet</button><button className={`launch-mode-tab ${source === 'vault' ? 'selected' : ''}`} aria-pressed={source === 'vault'} onClick={() => { setSource('vault'); resetReview() }}>Local vault</button></div>{source === 'external' ? <WalletMultiButton /> : <p className="text-sm text-muted">{vault.getPublicKey() ? 'Your local vault is unlocked.' : <>Unlock your <Link href="/wallet" className="text-accent underline">encrypted wallet</Link> to sign.</>}</p>}{payer && <p className="font-mono text-xs text-muted break-all">{payer}</p>}</fieldset></section>
      <section className="workspace-card p-5 sm:p-7"><h2 className="text-lg font-medium">Choose an operation</h2><fieldset disabled={busy || blocked} className="space-y-6 mt-5"><div className="flex flex-wrap gap-2" role="group" aria-label="Wallet operation">{([{ value: 'sol', label: 'Send / withdraw SOL' }, { value: 'token', label: 'Transfer tokens' }, { value: 'close', label: 'Clean empty accounts' }] as const).map(item => <Button key={item.value} variant={kind === item.value ? 'default' : 'secondary'} size="sm" aria-pressed={kind === item.value} onClick={() => { setKind(item.value); setRecipients([blankRecipient()]); resetReview() }}>{item.label}</Button>)}</div>
        {kind === 'token' && <div className="space-y-4"><div><label className="block text-sm mb-2" htmlFor="operation-mint">Token mint address</label><Input id="operation-mint" value={mint} onChange={event => { setMint(event.target.value); resetReview() }} spellCheck={false} autoComplete="off" /></div><div><label className="block text-sm mb-2" htmlFor="operation-token-source">Source token account <span className="text-muted">· optional</span></label><Input id="operation-token-source" value={tokenSource} onChange={event => { setTokenSource(event.target.value); resetReview() }} placeholder="Leave empty for your associated token account" spellCheck={false} autoComplete="off" /></div><p className="text-sm text-muted leading-relaxed">Standard SPL and Token-2022 mints with metadata-only extensions are supported. Amounts use the mint’s exact decimals; transfer fees and other extensions require a separate venue.</p></div>}
        {kind !== 'close' && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-medium">{recipients.length > 1 ? 'Funding distribution' : 'Recipient'}</h3><Button variant="ghost" size="sm" disabled={recipients.length >= 8} onClick={() => { setRecipients([...recipients, blankRecipient()]); resetReview() }}><Plus size={14} className="mr-1" />Add recipient</Button></div>
          {groups.length > 0 && <div><label className="block text-sm mb-2" htmlFor="recipient-group">Fill recipients from a saved group</label><select id="recipient-group" className="w-full bg-surface border border-border rounded-xl p-3 text-sm" defaultValue="" onChange={event => { const group = groups.find(value => value.id === event.target.value); if (group) { setRecipients(group.addresses.map(address => ({ address, amount: '' }))); resetReview() }; event.target.value = '' }}><option value="">Choose a public address group…</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.addresses.length} wallets</option>)}</select></div>}
          {recipients.map((recipient, index) => <div key={index} className="rounded-xl border border-border p-4 space-y-3"><div className="flex items-center justify-between"><span className="text-xs text-muted">RECIPIENT {index + 1}</span>{recipients.length > 1 && <button aria-label={`Remove recipient ${index + 1}`} onClick={() => { setRecipients(recipients.filter((_, position) => position !== index)); resetReview() }}><Trash2 size={15} /></button>}</div><div><label className="block text-sm mb-2" htmlFor={`recipient-address-${index}`}>Wallet address</label><Input id={`recipient-address-${index}`} value={recipient.address} spellCheck={false} autoComplete="off" onChange={event => { setRecipients(recipients.map((value, position) => position === index ? { ...value, address: event.target.value } : value)); resetReview() }} /></div><div><label className="block text-sm mb-2" htmlFor={`recipient-amount-${index}`}>Amount · {kind === 'sol' ? 'SOL' : 'tokens'}</label><Input id={`recipient-amount-${index}`} value={recipient.amount} inputMode="decimal" onChange={event => { setRecipients(recipients.map((value, position) => position === index ? { ...value, amount: event.target.value } : value)); resetReview() }} /></div></div>)}
          <p className="text-sm text-muted">One recipient sends a withdrawal. Add up to eight recipients to fund a group in one reviewed transaction.</p>
        </div>}
        {(kind === 'close' || kind === 'token') && <div className="space-y-4"><Button variant="secondary" disabled={!payer} onClick={scan}><RefreshCw size={15} className="mr-2" />Scan wallet token accounts</Button>{kind === 'close' && <p className="text-sm text-muted">Select up to eight initialized, empty accounts. Frozen accounts, wrapped SOL, different close authorities and unsupported extensions are excluded. Recovered rent goes to your sending wallet.</p>}
          {accounts.length > 0 && <div className="space-y-3 max-h-[420px] overflow-auto">{accounts.map(account => <div key={account.address} className="rounded-xl border border-border p-4 space-y-2"><div className="flex gap-3 items-start">{kind === 'close' && <input type="checkbox" className="accent-[#c0f3cb] mt-1" disabled={!account.closeable || (!selectedAccounts.includes(account.address) && selectedAccounts.length >= 8)} checked={selectedAccounts.includes(account.address)} aria-label={`Close empty account ${account.address}`} onChange={event => { setSelectedAccounts(event.target.checked ? [...selectedAccounts, account.address] : selectedAccounts.filter(value => value !== account.address)); resetReview() }} />}<div className="min-w-0 flex-1"><p className="font-mono text-xs break-all">{account.address}</p><p className="text-sm text-muted mt-2">{formatUnits(account.amountRaw, account.decimals)} tokens · {sol(account.lamports)} account rent</p><p className="text-sm text-muted break-all mt-1">Mint: {account.mint || 'Unreadable'}</p>{kind === 'close' && !account.closeable && <p className="text-sm text-muted mt-2">{account.reason}</p>}</div>{kind === 'token' && account.mint && <Button variant="secondary" size="sm" onClick={() => { setMint(account.mint); setTokenSource(account.address); resetReview() }}>Use</Button>}</div></div>)}</div>}
        </div>}
        <div><label className="block text-sm mb-2" htmlFor="operation-priority">Priority fee budget · SOL</label><Input id="operation-priority" inputMode="decimal" value={priority} onChange={event => { setPriority(event.target.value); resetReview() }} /><p className="text-sm text-muted mt-2">0 to 0.01 SOL. The network fee and any recipient account rent are shown in the preview.</p></div>
        <Button className="w-full" onClick={prepare} disabled={!payer || !canSign || (kind === 'close' && !selectedAccounts.length)}>{status === 'preparing' ? <><Loader2 size={16} className="animate-spin mr-2" />Preparing and simulating</> : <>Preview operation<ArrowRight size={16} className="ml-2" /></>}</Button>
      </fieldset></section>
      <section className="workspace-card p-5 sm:p-7"><h2 className="text-lg font-medium flex items-center gap-2"><Users size={18} className="text-accent" />Named wallet groups</h2><p className="text-sm text-muted leading-relaxed mt-3">Save public recipient addresses for future distributions. These groups contain no wallet keys or signing access.</p><fieldset disabled={busy} className="space-y-4 mt-5"><div><label className="block text-sm mb-2" htmlFor="wallet-group-name">Group name</label><Input id="wallet-group-name" maxLength={60} value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Project team" /></div><div><label className="block text-sm mb-2" htmlFor="wallet-group-addresses">Public addresses · one per line, up to eight</label><Textarea id="wallet-group-addresses" value={groupAddresses} onChange={event => setGroupAddresses(event.target.value)} spellCheck={false} autoComplete="off" /></div><Button variant="secondary" onClick={saveGroup} disabled={!groupName.trim() || !groupAddresses.trim()}>Save public address group</Button>{groups.map(group => <div key={group.id} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><b className="text-sm">{group.name}</b><button aria-label={`Remove group ${group.name}`} onClick={() => { try { removeWalletGroup(group.id); setGroups(readWalletGroups()); setNotice('Public address group removed.') } catch (failure) { setError(failure instanceof Error ? failure.message : 'The group could not be removed.') } }}><Trash2 size={15} /></button></div><p className="text-sm text-muted mt-2">{group.addresses.length} public wallets</p><details className="mt-3"><summary className="text-sm text-muted cursor-pointer">Review addresses</summary>{group.addresses.map(address => <p className="font-mono text-xs break-all mt-2" key={address}>{address}</p>)}</details></div>)}</fieldset></section>
      {error && <p role="alert" className="notice notice-error text-sm">{error}</p>}{notice && <p role="status" className="notice text-sm">{notice}</p>}{status === 'confirmed' && !pending && <p role="status" className="notice text-sm"><Check size={16} className="inline mr-2 text-accent" />Wallet operation confirmed on Solana.</p>}
      {pending && <section className="workspace-card p-5 border-yellow-400/30"><h2 className="text-lg font-medium">Check your submitted operation</h2><p className="text-sm text-muted mt-3">This operation may already have landed. It will never be resent automatically.</p><a className="block text-xs text-accent font-mono break-all mt-4" href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">{pending.signature}</a><Button className="mt-5" variant="secondary" disabled={busy} onClick={recover}><RefreshCw size={15} className={`mr-2 ${status === 'checking' ? 'animate-spin' : ''}`} />Check confirmation</Button></section>}
      {history.length > 0 && <section className="workspace-card p-5 sm:p-7"><h2 className="text-lg font-medium">Recent wallet operations</h2><div className="space-y-4 mt-5">{history.slice(0, 10).map(receipt => <div key={receipt.signature} className="flex flex-wrap justify-between gap-3 border-b border-border pb-4"><div><p className="text-sm">{receipt.kind === 'sol' ? 'SOL transfer' : receipt.kind === 'token' ? 'Token transfer' : 'Empty-account cleanup'} · <span className={receipt.status === 'confirmed' ? 'text-accent' : 'text-red-300'}>{receipt.status}</span></p><p className="text-sm text-muted mt-1">{new Date(receipt.resolvedAt).toLocaleString()}</p></div><a className="text-sm text-accent inline-flex items-center gap-1" href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer">View transaction<ExternalLink size={13} /></a></div>)}</div></section>}
    </div>
    <aside className="workspace-card p-5 sm:p-7 xl:sticky xl:top-24 space-y-5"><div className="text-xs tracking-wider text-accent">REVIEW BEFORE SIGNING</div><h2 className="text-2xl font-medium">Every amount, accounted for.</h2><dl><div className="summary-row"><dt>OutSol platform fee</dt><dd className="!text-accent">0 SOL</dd></div><div className="summary-row"><dt>Network</dt><dd>Solana mainnet</dd></div></dl>
      {prepared && currentPreview ? <><div className="notice text-sm"><Check size={15} className="inline mr-2 text-accent" />Live simulation passed. Preview expires after 60 seconds.</div><div><h3 className="text-sm font-medium">Sending wallet</h3><p className="font-mono text-xs text-muted break-all mt-2">{prepared.intent.payer}</p></div><dl><div className="summary-row"><dt>SOL before</dt><dd>{sol(currentPreview.payerBeforeLamports)}</dd></div><div className="summary-row"><dt>Network fee</dt><dd>{sol(currentPreview.networkFeeLamports)}</dd></div><div className="summary-row"><dt>{BigInt(currentPreview.rentChangeLamports) >= 0n ? 'Rent returned' : 'New account rent'}</dt><dd>{sol((BigInt(currentPreview.rentChangeLamports) < 0n ? -BigInt(currentPreview.rentChangeLamports) : BigInt(currentPreview.rentChangeLamports)).toString())}</dd></div><div className="summary-row"><dt>SOL remaining</dt><dd className="!text-accent">{sol(currentPreview.payerAfterLamports)}</dd></div>{currentPreview.sourceBeforeRaw !== undefined && <><div className="summary-row"><dt>Source tokens before</dt><dd>{formatUnits(currentPreview.sourceBeforeRaw, units)}</dd></div><div className="summary-row"><dt>Source tokens remaining</dt><dd>{formatUnits(currentPreview.sourceAfterRaw!, units)}</dd></div></>}</dl>
        {prepared.intent.mint && <div><h3 className="text-sm font-medium">Token mint</h3><p className="font-mono text-xs text-muted break-all mt-2">{prepared.intent.mint}</p></div>}
        {currentPreview.recipients.map((recipient, index) => <div className="border border-border rounded-xl p-4 space-y-2" key={recipient.address}><h3 className="text-sm font-medium">Recipient {index + 1}</h3><p className="font-mono text-xs text-muted break-all">{recipient.address}</p><p className="text-sm">Receives <b>{formatUnits(recipient.rawAmount, units)} {prepared.intent.kind === 'sol' ? 'SOL' : 'tokens'}</b></p><p className="text-sm text-muted">Balance: {formatUnits(recipient.beforeRaw, units)} → {formatUnits(recipient.afterRaw, units)}</p></div>)}
        {prepared.intent.closeAccounts?.map(account => <div className="rounded-xl border border-border p-4" key={account.address}><h3 className="text-sm font-medium">Empty account to close</h3><p className="font-mono text-xs text-muted break-all mt-2">{account.address}</p></div>)}
        <p className="text-sm text-muted leading-relaxed">Signing repeats the simulation and checks that these balances and costs still match. Closing this page stops actions that have not been submitted.</p><label className="flex gap-3 text-sm text-muted leading-relaxed"><input type="checkbox" className="accent-[#c0f3cb] mt-1" checked={approved} disabled={busy || blocked} onChange={event => setApproved(event.target.checked)} />I reviewed every recipient, amount, remaining balance and cost. Sign this one operation.</label><Button className="w-full" onClick={sign} disabled={!approved || busy || blocked || !canSign}>{busy ? <Loader2 size={16} className="animate-spin mr-2" /> : <Send size={16} className="mr-2" />}{status === 'sending' ? 'Checking confirmation…' : status === 'signing' ? 'Approve in your wallet…' : 'Sign and submit once'}</Button>
      </> : <p className="text-sm text-muted leading-relaxed">Fill in your recipients or select eligible empty accounts, then prepare a preview. Browsing groups and scanning balances do not move funds.</p>}
      <div className="border-t border-border pt-5"><p className="text-sm text-muted leading-relaxed">Creator fee claims remain available on Pump.fun. Native claims are not included in these transfer and cleanup controls.</p><a className="text-sm text-accent inline-flex items-center gap-1 mt-3" href="https://pump.fun" target="_blank" rel="noreferrer">Open Pump.fun<ExternalLink size={13} /></a></div>
    </aside>
  </div>
}
