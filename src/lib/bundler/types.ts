'use client'

import type {CreatorFeeSelection,ResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import type {LaunchBundleTransfer} from '@/lib/launchBundle/receipt'

export type BundleMode = 'sniper' | 'natural'
export type WalletMode = 'sniper' | 'delayed'
export type SniperMode = 'block0' | 'after_confirm' // Atomic inclusion is subject to landing; no first-block guarantee.
export type SellTriggerType = 'time' | 'profit' // time = delay-based, profit = multiplier-based

export interface BundleWallet {
  id: number
  privateKey: string
  /** Session-only library reference. Managed keys never enter this object. */
  libraryWalletId?: string
  publicKey: string | null
  balance: number | null
  buyAmount: number
  mode: WalletMode
  delaySeconds: number // custom delay for this wallet (only used if mode is 'delayed')
  isValid: boolean
  error?: string
  // Sell settings
  sellEnabled: boolean
  sellPercent: number // 1-100
  sellTriggerType: SellTriggerType // 'time' or 'profit'
  sellDelaySeconds: number // delay after launch to sell (used if sellTriggerType === 'time')
  sellProfitMultiplier: number // e.g., 2 = sell at 2x (100% profit), 3 = 3x (used if sellTriggerType === 'profit')
  // Runtime tracking (populated during execution)
  tokenBalance?: number // current token holdings
  currentValue?: number // current value in SOL
  profitMultiplier?: number // current profit multiplier (currentValue / buyAmount)
}

// Wallet profit info for monitoring
export interface WalletProfitInfo {
  publicKey: string
  buyAmountSol: number
  tokenBalance: number
  currentValueSol: number
  profitMultiplier: number // currentValue / buyAmount
  profitPercent: number // (currentValue - buyAmount) / buyAmount * 100
}

export type MintMode = 'pumpfun' | 'random' | 'import' | 'vanity'

export interface BundlerConfig {
  // Token info
  tokenName: string
  tokenSymbol: string
  tokenDescription: string
  tokenImage: File | null
  tokenBanner: File | null
  
  // Creator wallet
  creatorPrivateKey: string
  creatorPublicKey: string | null
  creatorBalance: number | null
  managedGroupId?: string
  managedCreatorWalletId?: string
  devBuyAmount: number
  creatorFeeSelection: CreatorFeeSelection
  
  // Mint keypair
  mintMode: MintMode
  importedMintKey: string // For import mode
  importedMintPublicKey: string | null
  vanityPattern: string // For vanity mode
  vanityMode: 'prefix' | 'suffix' | 'contains'
  foundVanityKey: string | null // Base58 secret key when found
  foundVanityPublicKey: string | null
  
  // Bundle wallets
  bundleWallets: BundleWallet[]
  
  // Mode
  bundleMode: BundleMode
  naturalDelayMin: number // seconds between buys in natural mode
  naturalDelayMax: number
  
  // Settings
  jitoTip: number
  slippage: number
  sniperMode: SniperMode // block0 = atomic Jito bundle, after_confirm = wait for token creation
  
  // Auto sell (dev wallet)
  autoSellEnabled: boolean
  autoSellTriggerType: SellTriggerType // 'time' or 'profit'
  autoSellDelay: number // seconds after launch (used if trigger is 'time')
  autoSellProfitMultiplier: number // e.g., 2 = sell at 2x (used if trigger is 'profit')
  autoSellPercent: number // 1-100
  
  // Social links (optional)
  twitter: string
  telegram: string
  website: string
}

export interface BundleSubmission {signature:string;payer:string;blockhash:string;expiresAfterBlockHeight:number;submittedAt:string}
export interface BundleResult {
  success: boolean
  status?: 'confirmed' | 'failed' | 'unknown' | 'partial'
  mintAddress?: string
  createSignature?: string
  bundleId?: string
  buySignatures?: string[]
  sellSignature?: string
  bundleSellSignatures?: string[]
  error?: string
  submittedSignatures?: string[]
  submissions?: BundleSubmission[]
  creatorFeeRouting?: ResolvedCreatorFeeRouting
  tokenTransfers?: LaunchBundleTransfer[]
}

export const DEFAULT_JITO_TIP = 0.0003
export const MAX_BUNDLE_WALLETS = 16
export const MIN_JITO_TIP = 0.00003
