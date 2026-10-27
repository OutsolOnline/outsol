'use client'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'

import { useState } from 'react'
import { Keypair } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { VanityResult as VanityResultType, type MatchMode } from '@/lib/vanity'
import { exportKeypairToJson } from '@/lib/pumpfun'
import { downloadJson, formatNumber, formatDuration } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { useLaunchStore } from '@/stores/launchStore'
import { readPending } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'

interface VanityResultProps {
  result: VanityResultType
  keypair: Keypair
  pattern: string
  mode: MatchMode
  caseSensitive: boolean
}

export function VanityResultDisplay({ result, keypair, pattern, mode, caseSensitive }: VanityResultProps) {
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const publicKey = keypair.publicKey.toBase58()

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast({
      title: 'copied',
      description: 'address copied to clipboard',
    })
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = () => {
    const json = exportKeypairToJson(keypair)
    const data = JSON.parse(json)
    downloadJson(data, `mint-${publicKey.slice(0, 8)}.json`)
    toast({
      title: 'exported',
      description: 'keypair saved. keep it secure.',
    })
  }

  // Highlight pattern in address
  const highlightPattern = (address: string) => {
    const comparedAddress = caseSensitive ? address : address.toLowerCase()
    const comparedPattern = caseSensitive ? pattern : pattern.toLowerCase()
    const index = !pattern ? -1 : mode === 'prefix'
      ? comparedAddress.startsWith(comparedPattern) ? 0 : -1
      : mode === 'suffix'
        ? comparedAddress.endsWith(comparedPattern) ? address.length - pattern.length : -1
        : comparedAddress.indexOf(comparedPattern)

    if (index === -1) return <span className="font-mono">{address}</span>

    const before = address.slice(0, index)
    const match = address.slice(index, index + pattern.length)
    const after = address.slice(index + pattern.length)

    return (
      <span className="font-mono">
        <span className="text-muted">{before}</span>
        <span className="text-foreground">{match}</span>
        <span className="text-muted">{after}</span>
      </span>
    )
  }

  return (
    <div className="space-y-10">
      {/* Success message */}
      <div className="flex items-center gap-4">
        <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
        <span className="text-foreground text-sm font-light">
          found in {formatNumber(result.attempts)} attempts ({formatDuration(result.elapsed / 1000)})
        </span>
      </div>

      {/* Address display */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm font-light">mint address</span>
          <div className="flex-1 h-px bg-muted-dim" />
        </div>
        <div className="text-sm tracking-wide break-all leading-relaxed">
          {highlightPattern(publicKey)}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copyToClipboard(publicKey)}
          >
            {copied ? 'copied' : 'copy'}
          </Button>
          <a
            href={`https://solscan.io/token/${publicKey}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm">
              view on solscan
            </Button>
          </a>
        </div>
      </div>

      {/* Secret key */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm font-light">secret key</span>
          <div className="flex-1 h-px bg-muted-dim" />
        </div>
        <div className="text-sm font-mono text-muted break-all">
          {showSecret ? (
            <span className="text-foreground/60">
              [{Array.from(keypair.secretKey).slice(0, 32).join(', ')}...]
            </span>
          ) : (
            <span>••••••••••••••••••••••••</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSecret(!showSecret)}
          >
            {showSecret ? 'hide' : 'reveal'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
          >
            export keypair
          </Button>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 py-4">
        <div className="w-px h-full bg-muted-dim" />
        <p className="text-muted text-sm font-light leading-relaxed">
          never share your secret key. anyone with access can control this address.
        </p>
      </div>

      {/* Launch CTA */}
      <div className="flex items-center gap-4 pt-4">
        <div className="flex-1 h-px bg-muted-dim" />
        <Button size="lg" asChild><Link href="/launch" onClick={event => {
          try {
            assertNoPendingWalletOperation(); if (readPending() || readTradePending()) throw new Error('Check the pending operation in Activity before starting another design.')
            const store = useLaunchStore.getState()
            if (store.currentStep === 'result') store.reset()
            store.setMintKeypair(keypair); store.setStep('metadata')
          } catch (e) { event.preventDefault(); toast({ title: 'Check your pending operation', description: e instanceof Error ? e.message : 'Recovery storage is unavailable.', variant: 'destructive' }) }
        }}>Use this mint in the builder</Link></Button>
        <div className="flex-1 h-px bg-muted-dim" />
      </div>
    </div>
  )
}
