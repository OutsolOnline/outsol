import { create } from 'zustand'
import { Keypair } from '@solana/web3.js'
import { TokenMetadata, LaunchStep } from '@/lib/pumpfun/types'
import { DEFAULT_LAUNCH_CONFIG, LaunchConfig } from '@/lib/launchConfig'
import { LAUNCH_STEP_ORDER } from '@/lib/launchFlow'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS,type LaunchBundleSettings} from '@/lib/launchBundle/types'
import {publicLaunchBundleOutcome,type LaunchBundleOutcome} from '@/lib/launchBundle/receipt'
import type {BundleResult} from '@/lib/bundler/types'
import type { ResolvedCreatorFeeRouting } from '@/lib/creatorFeeRouting'

export interface LaunchReceipt {
  mode: LaunchConfig['mode']
  venue?: LaunchConfig['venue'] | 'raydium-cpmm'
  mint: string
  signatures: string[]
  poolAddress?: string
  lockAddress?: string
  unlockAt?: number
  confirmedAt: string
  summary?: Record<string, string | number | boolean | null>
  bundleExecution?:LaunchBundleOutcome
  creatorFeeRouting?: ResolvedCreatorFeeRouting
}

interface LaunchStore {
  // State
  currentStep: LaunchStep
  metadata: TokenMetadata | null
  // Store secret key as array to avoid Uint8Array serialization issues
  mintSecretKey: number[] | null
  metadataUri: string | null
  imagePreview: string | null
  imageFile: File | Blob | null
  bannerPreview: string | null
  bannerFile: File | Blob | null
  devBuyAmount: number // SOL amount for initial dev buy
  autoSellEnabled: boolean
  autoSellDelay: number // seconds (1-10)
  autoSellPercent: number // 0-100
  usePlatformWallet: boolean // Use in-platform wallet instead of external
  transactionSignature: string | null
  sellSignature: string | null
  error: string | null
  isLoading: boolean
  config: LaunchConfig
  bundleSettings: LaunchBundleSettings
  receipt: LaunchReceipt | null

  // Actions
  setStep: (step: LaunchStep) => void
  setMetadata: (metadata: TokenMetadata) => void
  setMintKeypair: (keypair: Keypair | null) => void
  getMintKeypair: () => Keypair | null
  setMetadataUri: (uri: string) => void
  setImagePreview: (preview: string | null) => void
  setImageFile: (file: File | Blob | null) => void
  setBannerPreview: (preview: string | null) => void
  setBannerFile: (file: File | Blob | null) => void
  setDevBuyAmount: (amount: number) => void
  setAutoSellEnabled: (enabled: boolean) => void
  setAutoSellDelay: (delay: number) => void
  setAutoSellPercent: (percent: number) => void
  setUsePlatformWallet: (use: boolean) => void
  setTransactionSignature: (sig: string) => void
  setSellSignature: (sig: string) => void
  setError: (error: string | null) => void
  setIsLoading: (loading: boolean) => void
  reset: () => void
  nextStep: () => void
  prevStep: () => void
  setConfig: (config: Partial<LaunchConfig>) => void
  setBundleSettings: (settings: LaunchBundleSettings) => void
  setReceipt: (receipt: LaunchReceipt) => void
}

const STEP_ORDER = LAUNCH_STEP_ORDER

/** The signing guard and visible preview must compare the same public launch intent. */
export function launchReviewKey(state: Pick<LaunchStore, 'config' | 'bundleSettings' | 'metadata' | 'metadataUri' | 'getMintKeypair' | 'usePlatformWallet'>, payer: string | null | undefined) {
  return JSON.stringify({config:state.config,bundleSettings:state.bundleSettings,metadata:state.metadata,metadataUri:state.metadataUri,mint:state.getMintKeypair()?.publicKey.toBase58(),payer,usePlatformWallet:state.usePlatformWallet})
}

export function launchOutcomeFromResult(mode: LaunchBundleSettings['mode'], buyerCount: number, result: Pick<BundleResult, 'status' | 'error' | 'tokenTransfers'>): LaunchBundleOutcome {
  return publicLaunchBundleOutcome({mode,buyerCount,status:result.status==='confirmed'?'confirmed':'partial',...(result.error?{message:result.error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2000)}:{}),...(result.tokenTransfers?{transfers:result.tokenTransfers}:{})})
}

const initialState = {
  currentStep: 'metadata' as LaunchStep,
  metadata: null,
  mintSecretKey: null as number[] | null,
  metadataUri: null,
  imagePreview: null,
  imageFile: null as File | Blob | null,
  bannerPreview: null,
  bannerFile: null as File | Blob | null,
  devBuyAmount: 0,
  autoSellEnabled: false,
  autoSellDelay: 3,
  autoSellPercent: 100,
  usePlatformWallet: false,
  transactionSignature: null,
  sellSignature: null,
  error: null,
  isLoading: false,
  config: { ...DEFAULT_LAUNCH_CONFIG },
  bundleSettings: structuredClone(DEFAULT_LAUNCH_BUNDLE_SETTINGS),
  receipt: null as LaunchReceipt | null,
}

export const useLaunchStore = create<LaunchStore>((set, get) => ({
  ...initialState,
  setConfig: (config) => set((state) => ({ config: { ...state.config, ...config } })),
  setBundleSettings: (bundleSettings) => set(state => {
    const next=structuredClone(bundleSettings)
    if(state.bundleSettings.mode==='block0'&&next.mode!=='block0')for(const wallet of next.wallets)delete wallet.transferTo
    return {bundleSettings:next}
  }),
  setReceipt: (receipt) => set({ receipt, transactionSignature: receipt.signatures[0] || null }),

  setStep: (step) => set({ currentStep: step }),

  setMetadata: (metadata) => set({ metadata }),

  // Store as plain number array to avoid Uint8Array serialization issues
  setMintKeypair: (keypair) => {
    if (keypair) {
      set({ mintSecretKey: Array.from(keypair.secretKey) })
    } else {
      set({ mintSecretKey: null })
    }
  },

  // Reconstruct Keypair from stored secret key
  getMintKeypair: () => {
    const { mintSecretKey } = get()
    if (!mintSecretKey) return null
    try {
      return Keypair.fromSecretKey(new Uint8Array(mintSecretKey))
    } catch (e) {
      console.error('Failed to reconstruct keypair:', e)
      return null
    }
  },

  setMetadataUri: (uri) => set({ metadataUri: uri }),

  setImagePreview: (preview) => set({ imagePreview: preview }),

  setImageFile: (file) => set({ imageFile: file }),

  setBannerPreview: (preview) => set({ bannerPreview: preview }),

  setBannerFile: (file) => set({ bannerFile: file }),

  setDevBuyAmount: (amount) => set({ devBuyAmount: amount }),

  setAutoSellEnabled: (enabled) => set({ autoSellEnabled: enabled }),

  setAutoSellDelay: (delay) => set({ autoSellDelay: delay }),

  setAutoSellPercent: (percent) => set({ autoSellPercent: percent }),

  setUsePlatformWallet: (use) => set({ usePlatformWallet: use }),

  setTransactionSignature: (sig) => set({ transactionSignature: sig }),

  setSellSignature: (sig) => set({ sellSignature: sig }),

  setError: (error) => set({ error }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  reset: () => set({...initialState,config:{...DEFAULT_LAUNCH_CONFIG},bundleSettings:structuredClone(DEFAULT_LAUNCH_BUNDLE_SETTINGS)}),

  nextStep: () => {
    const { currentStep } = get()
    const currentIndex = STEP_ORDER.indexOf(currentStep)
    if (currentIndex < STEP_ORDER.length - 1) {
      set({ currentStep: STEP_ORDER[currentIndex + 1] })
    }
  },

  prevStep: () => {
    const { currentStep } = get()
    const currentIndex = STEP_ORDER.indexOf(currentStep)
    if (currentIndex > 0) {
      set({ currentStep: STEP_ORDER[currentIndex - 1] })
    }
  },
}))
