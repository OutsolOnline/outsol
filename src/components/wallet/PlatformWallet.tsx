'use client'

import { useState, useEffect, useRef } from 'react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePlatformWalletStore } from '@/stores/walletStore'
import Link from 'next/link'
import {Upload} from 'lucide-react'

export function PlatformWallet({initialMode='create',requestedSetup=false}:{initialMode?:'create'|'import';requestedSetup?:boolean}={}) {
  const wallet = usePlatformWalletStore()
  const { hydrateWallet, refreshBalance } = wallet
  const [mode, setMode] = useState<'create' | 'import'>(initialMode)
  const [importInput, setImportInput] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [readingFile,setReadingFile]=useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [exported, setExported] = useState(false)
  const importFile=useRef<HTMLInputElement>(null),reader=useRef<FileReader|null>(null)
  const hasWallet = !!wallet.walletAddress
  const unlocked = !!wallet.getKeypair()
  const locked = !!wallet.vault && !unlocked
  const creatingPassphrase = !hasWallet || wallet.needsMigration

  useEffect(() => { hydrateWallet() }, [hydrateWallet])
  useEffect(()=>{reader.current?.abort();reader.current=null;setReadingFile(false);setMode(initialMode);setImportInput('');setPassphrase('');setConfirmation('');setNotice(null)},[initialMode])
  useEffect(()=>()=>{reader.current?.abort();reader.current=null},[])
  useEffect(() => {
    if (!unlocked) setShowSecret(false)
    if (!hasWallet) return
    refreshBalance()
    const timer = setInterval(refreshBalance, 30_000)
    return () => clearInterval(timer)
  }, [hasWallet, unlocked, refreshBalance])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try { await action() } catch (error) { setNotice(error instanceof Error ? error.message : 'Wallet operation failed.') }
    finally { setBusy(false); setPassphrase(''); setConfirmation('') }
  }
  const chooseMode=(next:'create'|'import')=>{reader.current?.abort();reader.current=null;setReadingFile(false);setMode(next);setImportInput('');setPassphrase('');setConfirmation('');setNotice(null)}
  const readImport=(file?:File)=>{
    if(!file)return
    reader.current?.abort();reader.current=null;setReadingFile(false);setImportInput('')
    if(!file.size||file.size>16384){setNotice('Choose a keypair JSON file up to 16 KB.');return}
    const next=new FileReader();reader.current=next;setReadingFile(true);setNotice(null)
    next.onload=()=>{if(reader.current!==next)return;setReadingFile(false);if(typeof next.result==='string'){setImportInput(next.result);setNotice('Keypair file loaded locally. Enter a passphrase, then import and encrypt.')}reader.current=null}
    next.onerror=()=>{if(reader.current===next){setReadingFile(false);setNotice('This keypair file could not be read. Choose another file or paste your private key.');reader.current=null}}
    next.readAsText(file)
  }

  const exportWallet = () => {
    const secret = wallet.getExportSecret()
    if (!secret) return
    const keypair = Keypair.fromSecretKey(bs58.decode(secret))
    const blob = new Blob([JSON.stringify({ publicKey: keypair.publicKey.toBase58(), secretKey: Array.from(keypair.secretKey) }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `wallet-${keypair.publicKey.toBase58().slice(0, 8)}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExported(true)
    setNotice('Backup downloaded. This file contains your private key; keep it offline and private.')
  }

  const submit = () => run(async () => {
    if (creatingPassphrase && (passphrase.length < 12 || passphrase !== confirmation)) throw new Error('Use at least 12 characters and enter the same passphrase twice.')
    if (wallet.needsMigration) {
      if (await wallet.encryptWallet(passphrase)) setNotice('Existing wallet encrypted. Keep your passphrase and an offline backup.')
    } else if (locked) {
      await wallet.unlockWallet(passphrase)
    } else if (mode === 'create') {
      await wallet.generateWallet(passphrase)
      setNotice('Wallet created and encrypted in this browser. Export a backup before depositing SOL.')
    } else {
      const input = importInput.trim()
      if(input.length>16384)throw new Error('Use a Base58 private key or keypair JSON up to 16 KB.')
      const success = input.startsWith('[') || input.startsWith('{')
        ? await wallet.importFromJson(input, passphrase)
        : await wallet.importFromSecretKey(input, passphrase)
      if (success) { setImportInput(''); setNotice('Wallet imported and encrypted in this browser.') }
    }
  })

  if (!wallet.hydrated) return <p className="text-muted text-sm">loading wallet...</p>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-foreground font-medium">Local wallet</h3>
        {hasWallet && <span className="text-muted text-xs">{wallet.needsMigration ? 'encryption required' : unlocked ? 'unlocked' : 'locked'}</span>}
      </div>
      <p className="text-muted text-sm leading-relaxed">Your local wallet is encrypted with your passphrase before it is saved in this browser. Keep an offline export and remember your passphrase.</p>
      {requestedSetup&&hasWallet&&<p className="notice text-sm" role="status">This browser already has a local wallet. It has been preserved. Unlock it below to use it; creating or importing another wallet requires backing up and removing the current wallet first.</p>}

      {wallet.needsMigration && (
        <div className="p-4 bg-surface border border-border rounded-lg space-y-3">
          <p className="text-sm text-foreground">Your existing wallet needs encryption before it can sign. Its original key remains recoverable until encryption succeeds. Export a backup now, then set a passphrase.</p>
          <Button variant="secondary" onClick={exportWallet}>export existing wallet</Button>
        </div>
      )}

      {hasWallet && (
        <div className="p-6 bg-surface border border-border rounded-lg space-y-4">
          <div className="flex items-center justify-between"><span className="text-muted text-sm">balance</span><Button variant="ghost" size="sm" onClick={wallet.refreshBalance} disabled={wallet.isLoading}>{wallet.isLoading ? 'loading...' : 'refresh'}</Button></div>
          <p className="text-3xl font-mono text-foreground">{wallet.balance.toFixed(4)} <span className="text-lg text-muted">SOL</span></p>
          <Label htmlFor="wallet-address">deposit address</Label>
          <Input id="wallet-address" readOnly value={wallet.walletAddress || ''} className="font-mono text-xs" />
          <Button variant="secondary" size="sm" onClick={() => run(async () => { await navigator.clipboard.writeText(wallet.walletAddress!); setNotice('Address copied.') })}>copy address</Button>
        </div>
      )}

      {!hasWallet && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3" role="group" aria-label="Wallet setup mode"><Button variant={mode === 'create' ? 'default' : 'secondary'} aria-pressed={mode==='create'} disabled={busy} onClick={() => chooseMode('create')}>Create wallet</Button><Button variant={mode === 'import' ? 'default' : 'secondary'} aria-pressed={mode==='import'} disabled={busy} onClick={() => chooseMode('import')}>Import wallet</Button></div>
          {mode === 'import' && <div className="space-y-3"><Label htmlFor="wallet-import">Private key or keypair JSON</Label><Input type="password" id="wallet-import" value={importInput} maxLength={16384} disabled={busy} onChange={event => {reader.current?.abort();reader.current=null;setReadingFile(false);setNotice(null);setImportInput(event.target.value)}} autoComplete="off" spellCheck={false} placeholder="Base58 private key or JSON keypair" className="font-mono text-sm" /><div><input ref={importFile} type="file" accept=".json,application/json" className="hidden" aria-label="Import keypair JSON file" disabled={busy} onChange={event=>{readImport(event.target.files?.[0]);event.target.value=''}}/><Button variant="secondary" disabled={busy} onClick={()=>importFile.current?.click()}><Upload size={15}/>Choose keypair file</Button></div><p className="text-sm text-muted">Supports Base58 private keys and 64-byte keypair JSON exports. The file stays on this device; importing does not transfer funds.</p></div>}
        </div>
      )}

      {(!hasWallet || locked || wallet.needsMigration) && (
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="space-y-2"><Label htmlFor="wallet-passphrase">{creatingPassphrase ? 'new passphrase (12 characters minimum)' : 'unlock passphrase'}</Label><Input id="wallet-passphrase" type="password" autoComplete={creatingPassphrase ? 'new-password' : 'current-password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} disabled={busy} /></div>
          {creatingPassphrase && <div className="space-y-2"><Label htmlFor="wallet-passphrase-confirm">confirm passphrase</Label><Input id="wallet-passphrase-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /><p className="text-muted-dim text-sm">A forgotten passphrase cannot be reset. An exported keypair can restore your wallet.</p></div>}
          <Button type="submit" disabled={busy || readingFile || !passphrase || (creatingPassphrase && (passphrase.length < 12 || passphrase !== confirmation)) || (!hasWallet && mode === 'import' && !importInput.trim())}>{busy ? 'Saving encrypted wallet…' : readingFile ? 'Reading keypair file…' : wallet.needsMigration ? 'Encrypt existing wallet' : locked ? 'Unlock wallet' : mode === 'create' ? 'Create and encrypt wallet' : 'Import and encrypt wallet'}</Button>
        </form>
      )}

      {unlocked && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3"><Button variant="secondary" onClick={exportWallet}>export keypair JSON</Button><Button variant="secondary" onClick={() => setShowSecret(!showSecret)}>{showSecret ? 'hide key' : 'show key'}</Button><Button variant="ghost" onClick={() => { wallet.lockWallet(); setPassphrase(''); setShowSecret(false) }}>lock wallet</Button></div>
          {showSecret && <code className="block p-3 bg-surface border border-border rounded-lg break-all font-mono text-xs">{wallet.secretKeyBase58}</code>}
          <p className="text-muted-dim text-sm">Unlocked keys stay in this tab&apos;s memory. The wallet locks after 15 minutes without activity or when the page reloads. Keep the app open for scheduled transactions.</p>
          <Link href="/wallet-operations" className="text-link">Continue to wallet operations →</Link>
        </div>
      )}

      {hasWallet && <Button variant="ghost" onClick={() => run(async () => {
        if ((wallet.needsMigration || unlocked) && !exported) { setNotice('Export a keypair backup before removing this wallet.'); return }
        if (confirm('Remove this wallet from this browser? Confirm that your offline backup and passphrase are safe.')) { await wallet.clearWallet(); setExported(false); setNotice('Wallet removed from this browser.') }
      })}>remove wallet from browser</Button>}
      {(notice || wallet.error) && <p role="status" className="text-sm text-muted">{notice || wallet.error}</p>}
      <p className="text-muted-dim text-sm">Use a dedicated burner wallet and keep only the funds needed. Encryption protects the stored key while locked; a compromised browser can access an unlocked wallet.</p>
    </div>
  )
}
