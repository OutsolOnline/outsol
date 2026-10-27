'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { ArrowRight, CircleAlert, Loader2, ScanSearch, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePlatformWalletStore } from '@/stores/walletStore'
import { formatInspectorSol, inspectWallet, type AccountRentStatus, type TokenAccountInventory, type WalletInspection } from '@/lib/walletInspector'

const rentLabels: Record<AccountRentStatus, string> = {
  potential: 'Potential account rent',
  'has-balance': 'Contains tokens',
  frozen: 'Frozen · excluded',
  uninitialized: 'Uninitialized · excluded',
  native: 'Wrapped SOL · excluded',
  'different-close-authority': 'Different close authority',
  'extension-review': 'Extensions not assessed',
}

function Inventory({ inventory, title }: { inventory: TokenAccountInventory | null; title: string }) {
  const [page, setPage] = useState(0)
  const pageSize = 25
  const pages = Math.ceil((inventory?.accounts.length ?? 0) / pageSize)
  const visible = inventory?.accounts.slice(page * pageSize, (page + 1) * pageSize) ?? []

  return <section className="workspace-card overflow-hidden" aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-3 p-6">
      <div><h2 className="text-base font-medium text-foreground">{title}</h2><p className="mt-1 text-sm text-muted">{inventory ? `${inventory.accounts.length} validated accounts · ${inventory.emptyAccountCount} empty` : 'Unavailable in this scan'}</p></div>
      {inventory?.program === 'token-2022' && <span className="rounded border border-border px-2 py-1 text-xs text-muted">Rent eligibility unsupported</span>}
    </div>
    {!inventory ? <p className="border-t border-border px-6 py-8 text-sm text-muted">The provider did not return a usable inventory. Scan again to retry.</p> : inventory.accounts.length === 0 ? <p className="border-t border-border px-6 py-8 text-sm text-muted">{inventory.rejectedCount ? 'No account responses passed validation. See the scan notes above.' : 'No token accounts returned for this program.'}</p> : <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">{title}, exact token balances and conservative account rent assessment</caption>
          <thead className="border-y border-border bg-surface text-muted"><tr><th scope="col" className="px-6 py-3 font-normal">Mint / token account</th><th scope="col" className="px-4 py-3 font-normal">Exact balance</th><th scope="col" className="px-4 py-3 font-normal">Account state</th><th scope="col" className="px-6 py-3 font-normal">Rent assessment</th></tr></thead>
          <tbody>{visible.map(account => <tr key={account.address} className="border-b border-border align-top last:border-0">
            <td className="max-w-[260px] px-6 py-4"><code className="block break-all text-xs text-foreground">{account.mint}</code><details className="mt-2 text-muted"><summary className="cursor-pointer text-xs">Account details</summary><div className="mt-2 space-y-2"><div><span className="block text-xs">Token account</span><code className="break-all text-xs">{account.address}</code></div><div><span className="block text-xs">Effective close authority</span><code className="break-all text-xs">{account.closeAuthority}</code></div><p className="text-sm">Account SOL: {formatInspectorSol(account.lamports)}</p></div></details></td>
            <td className="max-w-[180px] px-4 py-4"><code className="break-all text-foreground">{account.balance}</code><span className="mt-1 block text-xs text-muted">{account.decimals} decimals</span></td>
            <td className="px-4 py-4"><span className={account.state === 'frozen' ? 'text-amber-300' : 'text-muted'}>{account.state}</span><span className="mt-1 block text-xs text-muted">{account.isNative ? 'Wrapped SOL' : 'Non-native token'}</span></td>
            <td className="max-w-[160px] px-6 py-4"><span className={account.rentStatus === 'potential' ? 'text-accent' : 'text-muted'}>{rentLabels[account.rentStatus]}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      {pages > 1 && <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4"><span className="text-xs text-muted">Page {page + 1} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setPage(current => current - 1)} disabled={page === 0}>Previous</Button><Button size="sm" variant="secondary" onClick={() => setPage(current => current + 1)} disabled={page + 1 >= pages}>Next</Button></div></div>}
    </>}
  </section>
}

export function WalletInspector() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const vaultAddress = usePlatformWalletStore(state => {void state.libraryRevision;return state.getSelectedAddress()})
  const [address, setAddress] = useState('')
  const [result, setResult] = useState<WalletInspection | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef({ mounted: true, scan: 0 })
  const connectedAddress = publicKey?.toBase58()

  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    return () => { state.mounted = false; state.scan++ }
  }, [])
  useEffect(() => {
    // A provider change invalidates both displayed data and an in-flight read.
    lifecycle.current.scan++
    setResult(null)
    setLoading(false)
    setError('')
  }, [connection])

  const chooseAddress = (next: string) => {
    lifecycle.current.scan++
    setAddress(next)
    setResult(null)
    setLoading(false)
    setError('')
  }

  const scan = async () => {
    const version = ++lifecycle.current.scan
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const next = await inspectWallet(connection, address)
      if (lifecycle.current.mounted && version === lifecycle.current.scan) setResult(next)
    } catch (failure) {
      if (lifecycle.current.mounted && version === lifecycle.current.scan) setError(failure instanceof Error ? failure.message : 'The wallet could not be scanned. Try again.')
    } finally {
      if (lifecycle.current.mounted && version === lifecycle.current.scan) setLoading(false)
    }
  }

  const inventories = result ? [result.standard, result.token2022].filter((value): value is TokenAccountInventory => value !== null) : []
  const totalAccounts = inventories.reduce((sum, inventory) => sum + inventory.accounts.length, 0)
  const emptyAccounts = inventories.reduce((sum, inventory) => sum + inventory.emptyAccountCount, 0)
  const incompleteInventories = !!result && (result.standard === null || result.token2022 === null || inventories.some(inventory => inventory.rejectedCount || inventory.omittedCount))
  const rent = result?.standard?.potentialRentLamports

  return <div className="space-y-6">
    <section className="workspace-card p-6 md:p-7" aria-label="Scan a public wallet">
      <div className="mb-5 flex items-start gap-3"><div className="rounded-lg border border-border bg-surface p-2.5 text-accent"><ScanSearch size={21} aria-hidden="true" /></div><div><h2 className="text-base font-medium text-foreground">Scan a wallet</h2><p id="inspector-address-help" className="mt-1 text-sm text-muted">Enter any public Solana address. A wallet connection is optional.</p></div></div>
      <form onSubmit={event => { event.preventDefault(); void scan() }} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="inspector-address">Public wallet address</Label><div className="flex flex-col gap-3 sm:flex-row"><Input id="inspector-address" value={address} onChange={event => chooseAddress(event.target.value)} maxLength={100} placeholder="Paste a Solana public address" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="inspector-address-help" aria-invalid={!!error} className="min-w-0 font-mono text-xs" /><Button type="submit" disabled={loading || !address.trim()} className="gap-2">{loading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ScanSearch size={15} aria-hidden="true" />}{loading ? 'Scanning…' : 'Scan wallet'}</Button></div></div>
        {(connectedAddress || vaultAddress) && <div className="flex flex-wrap gap-2">{connectedAddress && <Button type="button" size="sm" variant="secondary" onClick={() => chooseAddress(connectedAddress)}>Use connected wallet</Button>}{vaultAddress && <Button type="button" size="sm" variant="secondary" onClick={() => chooseAddress(vaultAddress)}>Use vault address</Button>}</div>}
      </form>
      <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /><p>Read-only. This tool never requests a key or signature, closes an account, or transfers funds. The public address is sent to the configured Solana RPC provider.</p></div>
    </section>

    <div aria-live="polite" aria-atomic="true">{loading && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" aria-hidden="true" />Reading SOL, standard SPL and Token-2022 accounts…</p>}{error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200"><CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}</div>

    {!result && !loading && !error && <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center"><ScanSearch size={28} className="mx-auto mb-4 text-muted" aria-hidden="true" /><h2 className="text-sm font-medium text-foreground">Your wallet, at a glance.</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">See exact token balances, empty accounts and a conservative estimate of potential account rent. Start with a public address above.</p></div>}

    {result && <>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-medium text-foreground">{result.warnings.length ? 'Scan complete · partial results' : 'Scan complete'}</h2><code className="mt-1 block break-all text-xs text-muted">{result.address}</code></div><p className="text-sm text-muted">{new Date(result.scannedAt).toLocaleTimeString()} · confirmed reads</p></div>
      {result.warnings.length > 0 && <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-relaxed text-amber-200"><p className="mb-2 font-medium">Some scan data is incomplete.</p><ul className="list-disc space-y-1 pl-4">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="workspace-card p-5"><dt className="text-xs text-muted">SOL balance</dt><dd className="mt-3 break-all font-mono text-xl text-foreground">{result.balanceLamports === null ? 'Unavailable' : formatInspectorSol(result.balanceLamports)}{result.balanceLamports !== null && <span className="ml-1 text-xs text-muted">SOL</span>}</dd><p className="mt-2 text-sm text-muted">Wallet SOL, excluding token accounts</p></div>
        <div className="workspace-card p-5"><dt className="text-xs text-muted">Token accounts{incompleteInventories ? ' · partial' : ''}</dt><dd className="mt-3 font-mono text-xl text-foreground">{totalAccounts}</dd><p className="mt-2 text-sm text-muted">Standard SPL + Token-2022</p></div>
        <div className="workspace-card p-5"><dt className="text-xs text-muted">Empty accounts{incompleteInventories ? ' · partial' : ''}</dt><dd className="mt-3 font-mono text-xl text-foreground">{emptyAccounts}</dd><p className="mt-2 text-sm text-muted">Zero token balance; eligibility varies</p></div>
        <div className="workspace-card p-5"><dt className="text-xs text-muted">Potential account rent{incompleteInventories ? ' · partial' : ''}</dt><dd className="mt-3 break-all font-mono text-xl text-accent">{rent == null ? 'Unavailable' : formatInspectorSol(rent)}{rent != null && <span className="ml-1 text-xs text-muted">SOL</span>}</dd><p className="mt-2 text-sm text-muted">{result.standard?.potentialAccountCount ?? 0} standard SPL candidates</p></div>
      </dl>
      <Inventory key={`spl-${result.scannedAt}`} inventory={result.standard} title="Standard SPL accounts" />
      <Inventory key={`2022-${result.scannedAt}`} inventory={result.token2022} title="Token-2022 accounts" />
      <details className="workspace-card p-6 text-xs leading-relaxed text-muted"><summary className="cursor-pointer text-sm font-medium text-foreground">How the estimate works</summary><div className="mt-4"><p>Only validated, empty, initialized standard SPL accounts whose effective close authority matches this address are candidates. Each account is capped at the lower of its SOL balance and the current 165-byte rent reserve. Frozen accounts and wrapped SOL are conservatively excluded. Token-2022 extension restrictions and multisig signing requirements are not inspected.</p><p className="mt-3">This is an estimate before any transaction fees. The readings may come from different slots, and account states can change. No account closure or transfer is available here.</p><a className="mt-3 inline-flex items-center gap-1 text-foreground underline underline-offset-4" href="https://solana.com/docs/tokens/basics/close-account" target="_blank" rel="noreferrer">Solana account rent documentation <ArrowRight size={12} aria-hidden="true" /></a></div></details>
    </>}
    <div className="flex flex-wrap gap-5 text-xs text-muted"><Link href="/wallet" className="inline-flex items-center gap-1 hover:text-foreground">Wallet vault <ArrowRight size={12} aria-hidden="true" /></Link><Link href="/manage" className="inline-flex items-center gap-1 hover:text-foreground">Manage a token <ArrowRight size={12} aria-hidden="true" /></Link><Link href="/tools" className="inline-flex items-center gap-1 hover:text-foreground">All tools <ArrowRight size={12} aria-hidden="true" /></Link></div>
  </div>
}
