'use client'

import { useState, useRef, useEffect } from 'react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { useBundlerStore } from '@/stores/bundlerStore'
import { Button, Input, Label, Textarea } from '@/components/ui'
import { validateBase58 } from '@/lib/vanity/base58'
import styles from './BundlerForm.module.css'
import {ManagedBundleWallets} from './ManagedBundleWallets'
import {BundleWalletSetup} from './BundleWalletSetup'
import {BuyerRelayDestination} from './BuyerRelayDestination'
import {CreatorFeeFields} from '@/components/launch/CreatorFeeFields'

export function BundlerForm() {
  const store = useBundlerStore()
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [bulkKeys, setBulkKeys] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Generate a new wallet and return its private key as base58
  const generateWallet = (): string => {
    const keypair = Keypair.generate()
    return bs58.encode(keypair.secretKey)
  }

  // Generate creator wallet
  const handleGenerateCreator = () => {
    const privateKey = generateWallet()
    store.setCreatorPrivateKey(privateKey)
  }

  // Generate a bundle wallet at specific index
  const handleGenerateBundleWallet = (index: number) => {
    const privateKey = generateWallet()
    store.setBundleWalletPrivateKey(index, privateKey)
  }

  // Generate multiple wallets at once
  const handleGenerateAllEmpty = () => {
    store.bundleWallets.forEach((wallet, index) => {
      if (!wallet.privateKey) {
        const privateKey = generateWallet()
        store.setBundleWalletPrivateKey(index, privateKey)
      }
    })
  }

  // Vanity search state
  const [isSearching, setIsSearching] = useState(false)
  const [searchCount, setSearchCount] = useState(0)
  const searchRef = useRef<boolean>(false)

  // Vanity search function
  const startVanitySearch = () => {
    if (!store.vanityPattern || !validateBase58(store.vanityPattern)) return

    setIsSearching(true)
    setSearchCount(0)
    searchRef.current = true
    store.clearFoundVanity()

    const pattern = store.vanityPattern.toLowerCase()
    const mode = store.vanityMode

    const searchBatch = () => {
      if (!searchRef.current) return

      for (let i = 0; i < 1000; i++) {
        const keypair = Keypair.generate()
        const address = keypair.publicKey.toBase58()
        const addressLower = address.toLowerCase()

        let found = false
        if (mode === 'prefix' && addressLower.startsWith(pattern)) found = true
        else if (mode === 'suffix' && addressLower.endsWith(pattern)) found = true
        else if (mode === 'contains' && addressLower.includes(pattern)) found = true

        if (found) {
          const secretKey = bs58.encode(keypair.secretKey)
          store.setFoundVanity(secretKey, address)
          setIsSearching(false)
          searchRef.current = false
          return
        }
      }

      setSearchCount(c => c + 1000)
      setTimeout(searchBatch, 0)
    }

    searchBatch()
  }

  const stopVanitySearch = () => {
    searchRef.current = false
    setIsSearching(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      searchRef.current = false
    }
  }, [])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      store.setTokenImage(file)
      const reader = new FileReader()
      reader.onload = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      store.setTokenBanner(file)
      const reader = new FileReader()
      reader.onload = () => setBannerPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleBulkImport = () => {
    store.importBulkPrivateKeys(bulkKeys)
    setBulkKeys('')
    setShowBulkImport(false)
  }

  const totalBuyAmount = store.bundleWallets.reduce((sum, w) => sum + (w.buyAmount || 0), 0) + store.devBuyAmount

  return (
    <fieldset disabled={store.isExecuting || !!store.result?.createSignature} className={styles.form}>
      <details className={styles.optional}><summary>Other wallet setups<span>Optional</span></summary><div className={styles.optionalBody}>
      <details className={styles.optional}><summary className="text-sm cursor-pointer">Use a different wallet group or import wallets</summary><div className="mt-4 space-y-4"><ManagedBundleWallets /><BundleWalletSetup mode="standalone" disabled={store.isExecuting||!!store.result?.createSignature} /></div></details>
      <details className={styles.optional}><summary className="text-sm cursor-pointer">Manual deployer wallet and first buy</summary>
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-foreground">Deployer wallet</h2>

        {!store.managedGroupId&&<div className="space-y-2">
          <Label htmlFor="bundle-deployer-key">Private key · base58 or JSON</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              id="bundle-deployer-key"
              value={store.creatorPrivateKey}
              onChange={(e) => store.setCreatorPrivateKey(e.target.value)}
              placeholder="Enter creator wallet private key..."
              className="font-mono text-sm flex-1"
            />
            <Button
              variant="secondary"
              onClick={handleGenerateCreator}
              title="Generate new wallet"
            >
              generate
            </Button>
          </div>
        </div>}

        {store.creatorPublicKey && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted font-mono">
              {store.creatorPublicKey.slice(0, 6)}...{store.creatorPublicKey.slice(-4)}
            </span>
            <span className="text-accent">
              {store.creatorBalance !== null ? `${store.creatorBalance.toFixed(4)} SOL` : 'Refresh to check balance'}
            </span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="bundle-deployer-buy">Deployer first buy · SOL</Label>
          <Input
            type="number"
            step="any"
            min="0"
            id="bundle-deployer-buy"
            value={store.devBuyAmount}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val)) {
                store.setDevBuyAmount(val)
              } else if (e.target.value === '') {
                store.setDevBuyAmount(0)
              }
            }}
            placeholder="0.05"
          />
        </div>
      </section>
      </details>
      {/* Bundle Wallets */}
      <details className={styles.optional}><summary className="text-sm cursor-pointer">Manual buyer wallets, timing and destinations</summary>
      <>
      <section className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Buyer wallets</h2>
          <div className="flex flex-wrap gap-2">
            {!store.managedGroupId&&<>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateAllEmpty}
              title="Generate wallets for all empty slots"
            >
              Generate empty wallets
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowBulkImport(!showBulkImport)}
            >
              Bulk import
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={store.clearBundleWallets}
            >
              Clear wallet selection
            </Button>
            </>}
            <Button
              variant="secondary"
              size="sm"
              onClick={store.refreshBalances}
            >
              Refresh balances
            </Button>
          </div>
        </div>

        {showBulkImport && !store.managedGroupId && (
          <div className="space-y-2 p-4 bg-surface rounded-lg border border-border">
            <Label htmlFor="bundle-bulk-keys">Private keys · one per line</Label>
            <Textarea
              id="bundle-bulk-keys"
              value={bulkKeys}
              onChange={(e) => setBulkKeys(e.target.value)}
              placeholder="paste up to 16 private keys, one per line..."
              rows={4}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleBulkImport}>import</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowBulkImport(false)}>cancel</Button>
            </div>
          </div>
        )}

        <div className={`${styles.walletTable} min-w-0 max-w-full overflow-x-auto rounded-lg border border-border`}>
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-muted">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">{store.managedGroupId?'managed wallet':'private key'}</th>
                <th className="px-3 py-2 w-28">address</th>
                <th className="px-3 py-2 w-20">balance</th>
                <th className="px-3 py-2 w-24">buy (SOL)</th>
                <th className="px-3 py-2 w-32">buy mode</th>
                <th className="px-3 py-2 w-44">auto sell</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {store.bundleWallets.map((wallet, index) => (
                <tr key={wallet.id} className="hover:bg-surface/50">
                  <td className="px-1 py-2" data-label={`Wallet ${index+1}`}>
                    <button
                      disabled={!!store.managedGroupId}
                      onClick={() => handleGenerateBundleWallet(index)}
                      className="w-6 h-6 rounded bg-surface-elevated hover:bg-accent/20 text-muted hover:text-accent transition-colors text-xs"
                      title="Generate new wallet"
                      aria-label={`Generate buyer wallet ${index+1}`}
                    >
                      +
                    </button>
                  </td>
                  <td className="px-3 py-2" data-label={store.managedGroupId?'Managed wallet':'Private key'}>
                    {store.managedGroupId?<span className="text-xs text-muted">{wallet.libraryWalletId?`Library buyer ${index+1}`:'Unused slot'}</span>:<input
                      type="password"
                      aria-label={`Buyer ${index+1} private key`}
                      value={wallet.privateKey}
                      onChange={(e) => store.setBundleWalletPrivateKey(index, e.target.value)}
                      placeholder="enter private key..."
                      className="w-full bg-transparent border-none outline-none text-xs font-mono text-foreground placeholder:text-muted"
                    />}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-accent" data-label="Address">
                    {wallet.publicKey ? `${wallet.publicKey.slice(0, 4)}...${wallet.publicKey.slice(-4)}` : '-'}
                  </td>
                  <td className="px-3 py-2 text-accent text-xs" data-label="Balance · SOL">
                    {wallet.balance !== null ? `${wallet.balance.toFixed(3)}` : '-'}
                  </td>
                  <td className="px-3 py-2" data-label="Buy budget · SOL">
                    <input
                      type="number"
                      aria-label={`Buyer ${index+1} SOL budget`}
                      step="0.001"
                      min="0"
                      value={wallet.buyAmount}
                      onChange={(e) => store.setBundleWalletBuyAmount(index, e.target.value === '' ? 0 : parseFloat(e.target.value))}
                      placeholder="0"
                      className="w-full bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground"
                    />
                  </td>
                  <td className="px-3 py-2" data-label="Buy timing">
                    <div className="flex items-center gap-1">
                      <select
                        aria-label={`Buyer ${index+1} timing`}
                        value={wallet.mode}
                        onChange={(e) => store.setBundleWalletMode(index, e.target.value as 'sniper' | 'delayed')}
                        className="bg-surface border border-border rounded px-1 py-1 text-xs text-foreground"
                      >
                        <option value="sniper">sniper</option>
                        <option value="delayed">delayed</option>
                      </select>
                      {wallet.mode === 'delayed' && (
                        <input
                          type="number"
                          min="1"
                          max="60"
                          value={wallet.delaySeconds}
                          onChange={(e) => store.setBundleWalletDelay(index, parseInt(e.target.value) || 5)}
                          className="w-10 bg-surface border border-border rounded px-1 py-1 text-xs text-foreground"
                          title="buy delay (seconds)"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2" data-label="Timed sale">
                    <div className="flex items-center gap-1 flex-wrap">
                      <input
                        type="checkbox"
                        checked={wallet.sellEnabled}
                        disabled={!!wallet.transferTo}
                        onChange={(e) => store.setBundleWalletSellEnabled(index, e.target.checked)}
                        className="w-3 h-3 accent-accent"
                        title="enable auto sell"
                      />
                      {wallet.sellEnabled && (
                        <>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={wallet.sellPercent}
                            onChange={(e) => store.setBundleWalletSellPercent(index, parseInt(e.target.value) || 100)}
                            className="w-10 bg-surface border border-border rounded px-1 py-1 text-xs text-foreground"
                            title="sell percentage"
                          />
                          <span className="text-muted text-xs">%@</span>
                          <span className="text-xs text-muted">after</span>
                              <input
                                type="number"
                                min="1"
                                max="3600"
                                value={wallet.sellDelaySeconds}
                                onChange={(e) => store.setBundleWalletSellDelay(index, parseInt(e.target.value) || 60)}
                                className="w-12 bg-surface border border-border rounded px-1 py-1 text-xs text-foreground"
                                title="sell delay (seconds after launch)"
                              />
                              <span className="text-muted text-xs">s</span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between text-sm text-accent">
          <span>
            {store.bundleWallets.filter(w => w.isValid && w.buyAmount > 0 && w.mode === 'sniper').length} sniper, {' '}
            {store.bundleWallets.filter(w => w.isValid && w.buyAmount > 0 && w.mode === 'delayed').length} delayed, {' '}
            {store.bundleWallets.filter(w => w.isValid && w.buyAmount > 0 && w.sellEnabled).length} auto-sell
          </span>
          <span>total buy: {totalBuyAmount.toFixed(3)} SOL</span>
        </div>
      </section>

      {store.bundleWallets.some(wallet=>wallet.publicKey)&&<section className="space-y-4" aria-label="Buyer Relay destinations"><h2 className="text-lg font-medium">Relay bought tokens</h2><p className="field-help">Forward each buyer’s exact new purchase in its buy transaction. Existing holdings stay in the source. Receiving wallets appear in Wallet controls for sales and backups.</p>{store.bundleWallets.map((wallet,index)=>wallet.publicKey?<BuyerRelayDestination key={wallet.id} id={`bundle-transfer-${wallet.id}`} buyerName={`Buyer ${index+1}`} buyerAddress={wallet.publicKey} value={wallet.transferTo||''} disabled={store.isExecuting||!!store.result?.createSignature} onChange={address=>store.setBundleWalletTransferTo(index,address.trim()||undefined)}/>:null)}</section>}

      </>
      </details>
      </div></details>
      <section id="bundle-token" className={styles.formSection} aria-labelledby="bundle-token-title">
        <div className={styles.sectionHeading}><span>02</span><div><h2 id="bundle-token-title">Design your token</h2><p>The name, symbol and artwork are required. Review public details before launching.</p></div></div>
        <div className={styles.identityGrid}>
          <div className="space-y-2"><Label htmlFor="bundle-token-name">Token name</Label><Input id="bundle-token-name" value={store.tokenName} onChange={e=>store.setTokenName(e.target.value)} placeholder="My Token"/></div>
          <div className="space-y-2"><Label htmlFor="bundle-token-symbol">Symbol</Label><Input id="bundle-token-symbol" value={store.tokenSymbol} onChange={e=>store.setTokenSymbol(e.target.value)} placeholder="TOKEN" maxLength={10}/></div>
        </div>
        <div className={styles.artworkRow}>
          <button type="button" className={styles.artworkButton} onClick={()=>fileInputRef.current?.click()} aria-label={imagePreview?'Replace token artwork':'Upload token artwork'}>{imagePreview?<img src={imagePreview} alt="Token artwork preview"/>:<span>Upload<br/>artwork</span>}</button>
          <div><Label htmlFor="bundle-token-artwork">Token artwork</Label><p className={styles.help}>PNG, GIF, JPG or WEBP.<br/>A square image works best; 200 × 200px recommended.</p><button type="button" className={styles.textButton} onClick={()=>fileInputRef.current?.click()}>{imagePreview?'Replace artwork':'Choose image'}</button></div>
          <input id="bundle-token-artwork" ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="sr-only"/>
        </div>
        <details className={styles.optional}><summary>Description, links and banner<span>Optional</span></summary><div className={styles.optionalBody}>
          <div className="space-y-2"><Label htmlFor="bundle-token-description">Description</Label><Textarea id="bundle-token-description" value={store.tokenDescription} onChange={e=>store.setTokenDescription(e.target.value)} placeholder="What is your token about?" rows={3}/></div>
          <div className={styles.socialGrid}>
            <div className="space-y-2"><Label htmlFor="bundle-token-x">X profile</Label><Input id="bundle-token-x" value={store.twitter} onChange={e=>store.setTwitter(e.target.value)} placeholder="https://x.com/…"/></div>
            <div className="space-y-2"><Label htmlFor="bundle-token-telegram">Telegram</Label><Input id="bundle-token-telegram" value={store.telegram} onChange={e=>store.setTelegram(e.target.value)} placeholder="https://t.me/…"/></div>
            <div className="space-y-2"><Label htmlFor="bundle-token-website">Website</Label><Input id="bundle-token-website" value={store.website} onChange={e=>store.setWebsite(e.target.value)} placeholder="https://…"/></div>
          </div>
          <div className={styles.artworkRow}><button type="button" className={styles.bannerButton} onClick={()=>bannerInputRef.current?.click()} aria-label={bannerPreview?'Replace token banner':'Upload token banner'}>{bannerPreview?<img src={bannerPreview} alt="Token banner preview"/>:<span>Choose banner</span>}</button><p className={styles.help}>Optional wide artwork.<br/>1500 × 500px recommended.</p><input id="bundle-token-banner" aria-label="Token banner image" ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerChange} className="sr-only"/></div>
        </div></details>
      </section>
      {/* Mint Address */}
      <details className={styles.optional}><summary>Mint address<span>{store.mintMode==='random'?'Random':store.mintMode==='import'?'Imported':'Custom'}</span></summary><section className="space-y-4 mt-5">
        <p className={styles.help}>Use a random mint, import a fresh keypair, or search for a custom address before launching.</p>

        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            aria-pressed={store.mintMode==='random'}
            onClick={() => store.setMintMode('random')}
            className={`p-3 rounded-lg border transition-all text-left ${
              store.mintMode === 'random'
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-muted'
            }`}
          >
            <div className="font-medium text-foreground text-sm">Random</div>
            <div className="text-xs text-muted mt-1">Generated at launch</div>
          </button>
          <button
            type="button"
            aria-pressed={store.mintMode==='import'}
            onClick={() => store.setMintMode('import')}
            className={`p-3 rounded-lg border transition-all text-left ${
              store.mintMode === 'import'
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-muted'
            }`}
          >
            <div className="font-medium text-foreground text-sm">Import keypair</div>
            <div className="text-xs text-muted mt-1">Fresh, unused mint</div>
          </button>
          <button
            type="button"
            aria-pressed={store.mintMode==='vanity'}
            onClick={() => store.setMintMode('vanity')}
            className={`p-3 rounded-lg border transition-all text-left ${
              store.mintMode === 'vanity'
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-muted'
            }`}
          >
            <div className="font-medium text-foreground text-sm">Custom address</div>
            <div className="text-xs text-muted mt-1">Search a pattern</div>
          </button>
        </div>

        {store.mintMode === 'import' && (
          <div className="space-y-3 p-4 rounded-lg border border-border bg-surface">
            <div className="space-y-2">
              <Label htmlFor="bundle-mint-key">Mint private key · base58 or JSON</Label>
              <Input
                type="password"
                id="bundle-mint-key"
                value={store.importedMintKey}
                onChange={(e) => store.setImportedMintKey(e.target.value)}
                placeholder="Enter mint private key..."
                className="font-mono text-sm"
              />
            </div>
            {store.importedMintPublicKey && (
              <div className="text-sm">
                <span className="text-muted">mint address: </span>
                <span className="font-mono text-accent">{store.importedMintPublicKey}</span>
              </div>
            )}
          </div>
        )}

        {store.mintMode === 'vanity' && (
          <div className="space-y-3 p-4 rounded-lg border border-border bg-surface">
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => store.setVanityMode('prefix')}
                className={`px-3 py-2 rounded text-xs ${
                  store.vanityMode === 'prefix'
                    ? 'bg-accent text-background'
                    : 'bg-surface-elevated text-muted hover:text-foreground'
                }`}
              >
                Starts with
              </button>
              <button
                onClick={() => store.setVanityMode('suffix')}
                className={`px-3 py-2 rounded text-xs ${
                  store.vanityMode === 'suffix'
                    ? 'bg-accent text-background'
                    : 'bg-surface-elevated text-muted hover:text-foreground'
                }`}
              >
                Ends with
              </button>
              <button
                onClick={() => store.setVanityMode('contains')}
                className={`px-3 py-2 rounded text-xs ${
                  store.vanityMode === 'contains'
                    ? 'bg-accent text-background'
                    : 'bg-surface-elevated text-muted hover:text-foreground'
                }`}
              >
                Contains
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bundle-mint-pattern">Address pattern · base58 characters</Label>
              <div className="flex gap-2">
                <Input
                  id="bundle-mint-pattern"
                  value={store.vanityPattern}
                  onChange={(e) => store.setVanityPattern(e.target.value)}
                  placeholder="PUMP"
                  className="font-mono"
                  disabled={isSearching}
                />
                {!isSearching ? (
                  <Button
                    onClick={startVanitySearch}
                    disabled={!store.vanityPattern || !validateBase58(store.vanityPattern)}
                  >
                    Search address
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={stopVanitySearch}>
                    Stop search
                  </Button>
                )}
              </div>
              {!validateBase58(store.vanityPattern) && store.vanityPattern && (
                <div className="text-xs text-red-400">Use valid base58 characters.</div>
              )}
            </div>

            {isSearching && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <span>searching... {searchCount.toLocaleString()} checked</span>
              </div>
            )}

            {store.foundVanityPublicKey && (
              <div className="space-y-2 p-3 rounded bg-green-500/10 border border-green-500/30">
                <div className="text-sm text-green-400 font-medium">Address found</div>
                <div className="font-mono text-sm text-foreground break-all">
                  {store.foundVanityPublicKey}
                </div>
              </div>
            )}
          </div>
        )}

        {store.mintMode === 'pumpfun' && (
          <div className="text-sm text-muted">
            Automatic suffix generation is unavailable here. Choose Custom address, then Ends with and search for “pump”, or choose Random.
          </div>
        )}

        {store.mintMode === 'random' && (
          <div className="text-sm text-muted">
            A fresh random mint is generated when you launch.
          </div>
        )}
      </section></details>

      {/* Settings */}
      <section id="bundle-execution" className={styles.formSection} aria-labelledby="bundle-execution-title">
        <div className={styles.sectionHeading}><span>03</span><div><h2 id="bundle-execution-title">Choose how buys run</h2><p>Set the order and timing for the wallets you control.</p></div></div>

        <div className="space-y-2">
          <Label htmlFor="bundle-timing">Buy timing</Label>
          <select id="bundle-timing" value={store.bundleMode} onChange={event=>store.setBundleMode(event.target.value as 'sniper'|'natural')} className="w-full rounded border border-border bg-surface p-3 text-sm">
            <option value="sniper">Use each wallet’s timing</option><option value="natural">Organic intervals</option>
          </select>
          {store.bundleMode==='natural'&&<div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="organic-min">Minimum gap · seconds</Label><Input id="organic-min" type="number" min="0" max="3600" value={store.naturalDelayMin} onChange={event=>store.setNaturalDelayMin(Number(event.target.value))}/></div>
            <div><Label htmlFor="organic-max">Maximum gap · seconds</Label><Input id="organic-max" type="number" min="0" max="3600" value={store.naturalDelayMax} onChange={event=>store.setNaturalDelayMax(Number(event.target.value))}/></div>
          </div>}
          <p className="text-sm text-muted">Organic intervals add a random gap between your own buys. Wallet activity and funding remain public on Solana.</p>
        </div>
        {/* Atomic or sequential execution */}
        <div className="space-y-3">
          <Label>Immediate-buy execution</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed={store.sniperMode==='block0'}
              onClick={() => store.setSniperMode('block0')}
              className={`p-4 rounded-lg border transition-all text-left ${
                store.sniperMode === 'block0'
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-muted'
              }`}
            >
              <div className="font-medium text-foreground">Atomic · Block 0</div>
              <div className="text-xs text-muted mt-1">
                Create the token and submit compatible buys together
              </div>
              <div className="text-xs text-accent mt-2">
                up to three buyers; metadata can reduce capacity
              </div>
            </button>
            <button
              type="button"
              aria-pressed={store.sniperMode==='after_confirm'}
              onClick={() => store.setSniperMode('after_confirm')}
              className={`p-4 rounded-lg border transition-all text-left ${
                store.sniperMode === 'after_confirm'
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-muted'
              }`}
            >
              <div className="font-medium text-foreground">After confirmation</div>
              <div className="text-xs text-muted mt-1">
                Send buys after the token creation confirms
              </div>
              <div className="text-xs text-accent mt-2">
                Buys are separate transactions in later blocks
              </div>
            </button>
          </div>
          {store.sniperMode === 'block0' && (
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-400">
              <strong>Atomic mode:</strong> create + up to three immediate buys + one real Jito tip share a bundle. Metadata may require more launch packets and reduce buyer capacity. Simulation checks the limit. Landing and the first block are not guaranteed. Delayed buys and scheduled sells are separate browser actions. A failed bundle stops the launch; there is no sequential fallback.
            </div>
          )}
        </div>

        <details className={styles.optional}><summary>Transaction settings<span>{store.slippage}% slippage · {store.jitoTip} SOL tip reserve</span></summary><div className="mt-5">        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bundle-tip">Validator tip reserve · SOL</Label>
            <div className="flex gap-2">
              <Button
                variant={store.jitoTip === 0.00003 ? 'default' : 'secondary'}
                size="sm"
                onClick={() => store.setJitoTip(0.00003)}
              >
                0.00003
              </Button>
              <Button
                variant={store.jitoTip === 0.0001 ? 'default' : 'secondary'}
                size="sm"
                onClick={() => store.setJitoTip(0.0001)}
              >
                0.0001
              </Button>
              <Button
                variant={store.jitoTip === 0.001 ? 'default' : 'secondary'}
                size="sm"
                onClick={() => store.setJitoTip(0.001)}
              >
                0.001
              </Button>
            </div>
            <Input
              type="number"
              step="0.00001"
              id="bundle-tip"
              min={store.sniperMode==='block0'?'0.000001':'0'}
              max="0.1"
              value={store.jitoTip}
              onChange={(e) => store.setJitoTip(Number.isNaN(e.target.valueAsNumber)?0:e.target.valueAsNumber)}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bundle-slippage">Maximum slippage · %</Label>
            <Input
              type="number"
              step="1"
              min="1"
              max="50"
              id="bundle-slippage"
              value={store.slippage}
              onChange={(e) => store.setSlippage(parseInt(e.target.value) || 20)}
            />
          </div>
        </div>
        </div></details>
        <details className={styles.optional}><summary>Creator-fee recipient<span>Optional</span></summary><div className="mt-5"><CreatorFeeFields idPrefix="bundler-creator-fees" value={store.creatorFeeSelection} onChange={store.setCreatorFeeSelection} disabled={store.isExecuting||!!store.result?.createSignature}/></div></details>
      </section>

      <details className={styles.optional}><summary>Scheduled deployer sale<span>{store.autoSellEnabled?'Enabled':'Off'}</span></summary><section className="space-y-4 mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Sell from the deployer after launch</h2>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={store.autoSellEnabled} onChange={event=>{store.setAutoSellTriggerType('time');store.setAutoSellEnabled(event.target.checked)}}/>enabled</label>
        </div>
        <p className="text-sm text-muted">Keep this page open and your device awake. Timers can run late; closing or refreshing the page cancels pending actions. Sale proceeds depend on current liquidity, price impact and protocol/network fees.</p>
        {store.autoSellEnabled&&<div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label htmlFor="dev-sell-delay">seconds after launch confirmation</Label><Input id="dev-sell-delay" type="number" min="1" max="3600" value={store.autoSellDelay} onChange={event=>store.setAutoSellDelay(Number(event.target.value))}/></div>
          <div className="space-y-2"><Label htmlFor="dev-sell-percent">sell percentage</Label><Input id="dev-sell-percent" type="number" min="1" max="100" value={store.autoSellPercent} onChange={event=>store.setAutoSellPercent(Number(event.target.value))}/></div>
        </div>}
      </section></details>
    </fieldset>
  )
}
