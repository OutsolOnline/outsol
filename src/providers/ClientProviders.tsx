'use client'

import { FC, ReactNode, useMemo, useEffect } from 'react'
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { getRpcEndpoint } from '@/lib/rpc'
import { usePlatformWalletStore } from '@/stores/walletStore'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css'

interface ClientProvidersProps {
  children: ReactNode
}

export const ClientProviders: FC<ClientProvidersProps> = ({ children }) => {
  useEffect(() => {
    usePlatformWalletStore.getState().hydrateWallet()
    useWalletLibraryStore.getState().hydrate()
    let timer: ReturnType<typeof setTimeout>
    const resetLockTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(() => usePlatformWalletStore.getState().lockWallet(), 15 * 60_000)
    }
    resetLockTimer()
    window.addEventListener('pointerdown', resetLockTimer)
    window.addEventListener('keydown', resetLockTimer)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', resetLockTimer)
      window.removeEventListener('keydown', resetLockTimer)
    }
  }, [])
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  )

  return (
    <ConnectionProvider endpoint={getRpcEndpoint()}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  )
}
