'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Button } from '@/components/ui/button'
import { useLaunchStore } from '@/stores/launchStore'
import { useEffect } from 'react'
import Link from 'next/link'
import { usePlatformWalletStore } from '@/stores/walletStore'

export function ConnectWalletStep() {
  const { connected, publicKey } = useWallet()
  const { nextStep, prevStep, setUsePlatformWallet } = useLaunchStore()
  const platform = usePlatformWalletStore()

  useEffect(() => {
    if (connected && publicKey) {
      setUsePlatformWallet(false)
    }
  }, [connected, publicKey, setUsePlatformWallet])

  return (
    <div className="space-y-7 py-4 max-w-xl mx-auto">
      <div><h2 className="text-xl font-medium mb-2">Choose the wallet that signs.</h2><p className="text-sm text-muted leading-relaxed">Your token design is ready. Connect an external wallet or unlock your local vault to prepare a simulated launch preview.</p></div>
      {connected && publicKey ? (
        <>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
              <span className="text-muted text-sm font-light">connected</span>
            </div>
            <p className="font-mono text-sm text-foreground">
              {publicKey.toBase58().slice(0, 12)}...{publicKey.toBase58().slice(-12)}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-muted-dim" />
            <Button onClick={nextStep}>
              Continue to launch review
            </Button>
            <div className="flex-1 h-px bg-muted-dim" />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-4">
            <p className="text-muted text-sm font-light leading-relaxed">
              Connect your wallet to sign the token creation transaction.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-muted-dim" />
            <WalletMultiButton />
            <div className="flex-1 h-px bg-muted-dim" />
          </div>

          <p className="text-muted text-xs font-light text-center">
            your wallet will not be charged until you approve the transaction
          </p>
        </>
      )}
      {platform.getPublicKey() ? <div className="notice flex flex-wrap items-center justify-between gap-4"><span>Use your unlocked local wallet</span><Button variant="secondary" onClick={() => { setUsePlatformWallet(true); nextStep() }}>Use vault wallet</Button></div> : <p className="text-xs text-muted text-center">Or <Link href="/wallet" className="text-accent underline">create or unlock your encrypted wallet vault</Link>.</p>}
      <Button variant="ghost" onClick={prevStep}>Back to launch settings</Button>
    </div>
  )
}
