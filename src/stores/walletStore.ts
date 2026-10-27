'use client'

import { create } from 'zustand'
import { Keypair, Connection, LAMPORTS_PER_SOL, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { decryptWalletSecret, encryptWalletSecret, WalletVault } from '@/lib/walletVault'
import { getRpcEndpoint } from '@/lib/rpc'
import {useWalletLibraryStore} from './walletLibraryStore'

const VAULT_KEY = 'platform-wallet-vault'
const LEGACY_KEY = 'platform-wallet'
// The legacy secret is available only to the explicit migration/export flow.
let migrationSecret: string | null = null
let unlockEpoch = 0

interface PlatformWalletStore {
  secretKeyBase58: string | null
  walletAddress: string | null
  vault: WalletVault | null
  needsMigration: boolean
  hydrated: boolean
  storageUnavailable: boolean
  balance: number
  isLoading: boolean
  error: string | null
  isSyncing: boolean
  libraryRevision:number
  getKeypair: () => Keypair | null
  getPublicKey: () => string | null
  getSelectedAddress:()=>string|null
  getExportSecret: () => string | null
  hydrateWallet: () => void
  generateWallet: (passphrase: string) => Promise<void>
  importFromSecretKey: (secretKey: string, passphrase: string) => Promise<boolean>
  importFromJson: (json: string, passphrase: string) => Promise<boolean>
  encryptWallet: (passphrase: string) => Promise<boolean>
  unlockWallet: (passphrase: string) => Promise<boolean>
  lockWallet: () => void
  clearWallet: () => Promise<void>
  refreshBalance: () => Promise<void>
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>
  signAndSendTransaction: (tx: Transaction | VersionedTransaction) => Promise<string>
}

function validateSecret(secret: string): Keypair {
  const bytes = bs58.decode(secret)
  if (bytes.length !== 64) throw new Error('Invalid secret key')
  return Keypair.fromSecretKey(bytes)
}

function persistVault(vault: WalletVault, replacingLegacy = false) {
  const existing = localStorage.getItem(VAULT_KEY)
  if (existing && (!replacingLegacy || JSON.parse(existing)?.publicKey !== vault.publicKey)) throw new Error('A saved encrypted wallet already exists. Reload to recover it before replacing it.')
  const serialized = JSON.stringify(vault)
  localStorage.setItem(VAULT_KEY, serialized)
  if (localStorage.getItem(VAULT_KEY) !== serialized) throw new Error('Wallet storage could not be verified')
  // Delete the old plaintext only after ciphertext was written and verified.
  localStorage.removeItem(LEGACY_KEY)
}

export const usePlatformWalletStore = create<PlatformWalletStore>((set, get) => ({
  secretKeyBase58: null, walletAddress: null, vault: null, needsMigration: false,
  hydrated: false, storageUnavailable: false, balance: 0, isLoading: false, error: null, isSyncing: false,libraryRevision:0,

  hydrateWallet: () => {
    if (get().hydrated || typeof window === 'undefined') return
    try {
      const legacy = localStorage.getItem(LEGACY_KEY)
      const legacySecret = legacy ? JSON.parse(legacy)?.state?.secretKeyBase58 : null
      if (typeof legacySecret === 'string' && legacySecret) {
        const wallet = validateSecret(legacySecret)
        migrationSecret = legacySecret
        set({ needsMigration: true, walletAddress: wallet.publicKey.toBase58(), hydrated: true })
        return
      }
      const stored = localStorage.getItem(VAULT_KEY)
      if (stored) {
        const vault = JSON.parse(stored) as WalletVault
        if (vault.version !== 1 || typeof vault.publicKey !== 'string' || typeof vault.ciphertext !== 'string') throw new Error('Invalid vault')
        new PublicKey(vault.publicKey)
        set({ vault, walletAddress: vault.publicKey })
      }
      set({ hydrated: true })
    } catch { set({ hydrated: true, storageUnavailable: true, error: 'Wallet storage could not be read. Keep your existing browser data and restore an exported backup.' }) }
  },

  getKeypair: () => {
    const library=useWalletLibraryStore.getState()
    if(library.activeId!==null)return library.getKeypair(library.activeId)
    if (get().needsMigration || !get().secretKeyBase58) return null
    try { return validateSecret(get().secretKeyBase58!) } catch { return null }
  },
  // A locked wallet is unavailable to launch callers. walletAddress remains visible for recovery.
  getPublicKey: () => get().getKeypair()?.publicKey.toBase58() || null,
  getSelectedAddress:()=>{const library=useWalletLibraryStore.getState();return library.activeId!==null?library.getActiveWallet()?.publicKey||null:get().walletAddress},
  getExportSecret: () => {if(migrationSecret)return migrationSecret;const library=useWalletLibraryStore.getState();if(library.activeId!==null){const key=library.getKeypair(library.activeId);return key?bs58.encode(key.secretKey):null}return get().secretKeyBase58},

  generateWallet: async (passphrase) => {
    get().hydrateWallet()
    if (get().vault || get().needsMigration || get().storageUnavailable) throw new Error('Export and remove the existing wallet before replacing it.')
    const keypair = Keypair.generate()
    const epoch = unlockEpoch
    const secret = bs58.encode(keypair.secretKey)
    const vault = await encryptWalletSecret(secret, passphrase, keypair.publicKey.toBase58())
    persistVault(vault)
    set({ vault, secretKeyBase58: epoch === unlockEpoch ? secret : null, walletAddress: vault.publicKey, balance: 0, error: null })
  },

  importFromSecretKey: async (input, passphrase) => {
    get().hydrateWallet()
    if (get().vault || get().needsMigration || get().storageUnavailable) { set({ error: 'Export and remove the existing wallet before replacing it.' }); return false }
    try {
      const epoch = unlockEpoch
      const secret = input.trim()
      const keypair = validateSecret(secret)
      const vault = await encryptWalletSecret(secret, passphrase, keypair.publicKey.toBase58())
      persistVault(vault)
      set({ vault, secretKeyBase58: epoch === unlockEpoch ? secret : null, walletAddress: vault.publicKey, balance: 0, error: null })
      return true
    } catch { set({ error: 'Import failed. Check the key, passphrase (12 characters minimum), and available browser storage.' }); return false }
  },

  importFromJson: async (json, passphrase) => {
    try {
      const parsed = JSON.parse(json)
      const bytes = Array.isArray(parsed) ? parsed : parsed.secretKey
      if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('Invalid key')
      return get().importFromSecretKey(bs58.encode(new Uint8Array(bytes)), passphrase)
    } catch { set({ error: 'Invalid wallet JSON. Use a 64-byte keypair export.' }); return false }
  },

  encryptWallet: async (passphrase) => {
    if (!migrationSecret) return false
    try {
      const secret = migrationSecret
      const epoch = unlockEpoch
      const keypair = validateSecret(secret)
      const vault = await encryptWalletSecret(secret, passphrase, keypair.publicKey.toBase58())
      persistVault(vault, true)
      migrationSecret = null
      set({ vault, secretKeyBase58: epoch === unlockEpoch ? secret : null, walletAddress: vault.publicKey, needsMigration: false, error: null })
      return true
    } catch { set({ error: 'Encryption failed. Your original wallet remains recoverable; export it before clearing browser data.' }); return false }
  },

  unlockWallet: async (passphrase) => {
    const vault = get().vault
    if (!vault) return false
    const epoch = ++unlockEpoch
    try {
      const secret = await decryptWalletSecret(vault, passphrase)
      if (epoch !== unlockEpoch || get().vault !== vault) return false
      if (validateSecret(secret).publicKey.toBase58() !== vault.publicKey) throw new Error('Invalid vault')
      set({ secretKeyBase58: secret, error: null })
      return true
    } catch { set({ error: 'Could not unlock wallet. Check your passphrase or restore an exported backup.' }); return false }
  },

  lockWallet: () => { unlockEpoch++;useWalletLibraryStore.getState().lockAll(); set({ secretKeyBase58: null, balance: 0 }) },
  clearWallet: async () => {
    unlockEpoch++
    // Storage errors must not silently pretend to remove a recoverable wallet.
    localStorage.removeItem(VAULT_KEY)
    localStorage.removeItem(LEGACY_KEY)
    migrationSecret = null
    set({ secretKeyBase58: null, walletAddress: null, vault: null, needsMigration: false, storageUnavailable: false, balance: 0, error: null })
  },

  refreshBalance: async () => {
    const address = get().getSelectedAddress()
    if (!address) return
    set({ isLoading: true })
    try {
      const balance = await new Connection(getRpcEndpoint(), 'confirmed').getBalance(new PublicKey(address))
      if(get().getSelectedAddress()!==address){set({isLoading:false});return}
      set({ balance: balance / LAMPORTS_PER_SOL, isLoading: false })
    } catch { set({ isLoading: false, error: 'Could not refresh balance. Try again shortly.' }) }
  },

  signTransaction: async (tx) => {
    const keypair = get().getKeypair()
    if (!keypair) throw new Error('Unlock your wallet before signing.')
    if (tx instanceof VersionedTransaction) tx.sign([keypair])
    else tx.partialSign(keypair)
    return tx
  },

  signAndSendTransaction: async (tx) => {
    await get().signTransaction(tx)
    const connection = new Connection(getRpcEndpoint(), 'confirmed')
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
    // Poll HTTP; the private provider URL is never exposed through WebSockets.
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
      const status = value[0]
      if (status?.err) throw new Error('The transaction failed on chain.')
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    throw new Error(`Confirmation is pending. Check signature ${signature} before retrying.`)
  },
}))

// Existing launch/trade callers subscribe to this compatibility store. Keep
// their live signer checks reactive without copying managed private keys here.
useWalletLibraryStore.subscribe(()=>usePlatformWalletStore.setState(state=>({libraryRevision:state.libraryRevision+1})))
