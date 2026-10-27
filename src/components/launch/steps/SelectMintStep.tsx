'use client'

import { useState, useRef } from 'react'
import { Keypair } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLaunchStore } from '@/stores/launchStore'
import { importKeypairFromJson, exportKeypairToJson } from '@/lib/pumpfun'
import { cn } from '@/lib/utils'
import Link from 'next/link'

export function SelectMintStep() {
  const { getMintKeypair, setMintKeypair, nextStep, prevStep } = useLaunchStore()
  const mintKeypair = getMintKeypair()
  const [mode, setMode] = useState<'generate' | 'import'>(mintKeypair ? 'import' : 'generate')
  const [error, setError] = useState<string | null>(null)
  const [importedKey, setImportedKey] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleGenerateNew = () => {
    const keypair = Keypair.generate()
    setMintKeypair(keypair)
    setError(null)
  }

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 16384) { setError('Keypair files must be under 16 KB.'); return }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const keypair = importKeypairFromJson(reader.result as string)
        if (keypair) {
          setMintKeypair(keypair)
          setError(null)
        } else {
          setError('invalid keypair format')
        }
      } catch {
        setError('failed to read file')
      }
    }
    reader.readAsText(file)
  }

  const handlePasteImport = () => {
    const keypair = importedKey.length <= 16384 ? importKeypairFromJson(importedKey) : null
    if (!keypair) { setError('Use a valid 64-byte mint keypair JSON.'); return }
    setMintKeypair(keypair); setImportedKey(''); setError(null)
  }

  const handleContinue = () => {
    if (!mintKeypair) {
      setError('select or import a keypair')
      return
    }
    nextStep()
  }

  return (
    <div className="space-y-10">
      {/* Mode selection */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMode('generate')}
          className={cn(
            'px-5 py-2 text-sm font-light rounded-terminal transition-all duration-300',
            mode === 'generate'
              ? 'bg-foreground text-background'
              : 'bg-surface border border-border text-muted hover:text-foreground'
          )}
        >
          Random address
        </button>
        <button
          onClick={() => setMode('import')}
          className={cn(
            'px-5 py-2 text-sm font-light rounded-terminal transition-all duration-300',
            mode === 'import'
              ? 'bg-foreground text-background'
              : 'bg-surface border border-border text-muted hover:text-foreground'
          )}
        >
          Import keypair
        </button>
      </div>

      {/* Generate mode */}
      {mode === 'generate' && (
        <div className="space-y-6">
          <p className="text-muted text-sm font-light">
            Every token needs a new mint address. Generate one here or choose a custom vanity address.
          </p>
          
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={handleGenerateNew}>
              Generate address
            </Button>
            <span className="text-muted text-sm">or</span>
            <Link href="/vanity">
              <Button variant="ghost">
                Create a vanity address
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Import mode */}
      {mode === 'import' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <Label className="text-muted text-sm font-light">import from file</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className="hidden"
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              choose file
            </Button>
          </div>

          <div className="divider-fade-both" />

          <div className="space-y-3">
            <Label className="text-muted text-sm font-light">or paste secret key</Label>
            <Input
              type="password"
              autoComplete="off"
              placeholder="[1,2,3,...] or {secretKey: [...]}"
              value={importedKey}
              onChange={(e) => setImportedKey(e.target.value)}
              variant="line"
              className="font-mono text-xs"
            />
            <Button
              variant="secondary"
              onClick={handlePasteImport}
              disabled={!importedKey}
            >
              import
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-muted text-sm">{error}</p>
      )}

      {/* Selected keypair */}
      {mintKeypair && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
            <span className="text-muted text-sm font-light">Selected mint address</span>
          </div>
          <p className="font-mono text-sm text-foreground break-all">
            {mintKeypair.publicKey.toBase58()}
          </p>
          <Button variant="secondary" size="sm" onClick={() => { const url = URL.createObjectURL(new Blob([exportKeypairToJson(mintKeypair)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `mint-${mintKeypair.publicKey.toBase58().slice(0,8)}.json`; link.click(); URL.revokeObjectURL(url) }}>Save mint keypair backup</Button>
          <p className="field-help">Keep the backup private. It lets you restore this mint if you close the tab before launching.</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-6">
        <Button variant="ghost" onClick={prevStep}>
          Back to token details
        </Button>
        <Button onClick={handleContinue} disabled={!mintKeypair}>
          Continue to launch settings
        </Button>
      </div>
    </div>
  )
}
