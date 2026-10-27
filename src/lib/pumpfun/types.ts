import { PublicKey, Keypair, TransactionInstruction } from '@solana/web3.js'

/**
 * Token metadata for creating a Pump.fun token
 */
export interface TokenMetadata {
  name: string
  symbol: string
  description: string
  image?: File | string // File for upload or URL
  banner?: File | string // Banner/header image
  website?: string
  twitter?: string
  telegram?: string
}

/**
 * Result of uploading metadata to IPFS/storage
 */
export interface MetadataUploadResult {
  uri: string
  imageUri?: string
}

/**
 * Parameters for creating a Pump.fun token
 */
export interface CreateTokenParams {
  // The mint keypair (vanity address)
  mintKeypair: Keypair
  // Token metadata
  metadata: TokenMetadata
  // Metadata URI (after upload)
  metadataUri: string
  // Creator's public key
  creator: PublicKey
  // Optional: initial buy amount in SOL
  initialBuyAmountSol?: number
}

/**
 * Accounts required for the create instruction
 */
export interface CreateTokenAccounts {
  mint: PublicKey
  mintAuthority: PublicKey
  bondingCurve: PublicKey
  associatedBondingCurve: PublicKey
  global: PublicKey
  mplTokenMetadata: PublicKey
  metadata: PublicKey
  user: PublicKey
  systemProgram: PublicKey
  tokenProgram: PublicKey
  associatedTokenProgram: PublicKey
  rent: PublicKey
  eventAuthority: PublicKey
  program: PublicKey
}

/**
 * Result from building a create transaction
 */
export interface CreateTransactionResult {
  success: boolean
  instruction?: TransactionInstruction
  accounts?: CreateTokenAccounts
  error?: string
  errorType?: 'SCHEMA_UNKNOWN' | 'INVALID_PARAMS' | 'NETWORK_ERROR' | 'OTHER'
}

/**
 * Pump.fun link generator result
 */
export interface PumpFunLinks {
  tokenPage: string
  tradeUrl: string
  solscanUrl: string
}

/**
 * Create instruction data layout
 * NOTE: This is a best-effort reconstruction of the Pump.fun instruction layout.
 * If it doesn't work, the schema may have changed.
 */
export interface CreateInstructionData {
  discriminator: Buffer // 8 bytes
  name: string
  symbol: string
  uri: string
}

/**
 * Export format for mint keypair
 */
export interface ExportedKeypair {
  publicKey: string
  secretKey: number[]
  timestamp: string
  warning: string
}

/**
 * Launch flow state
 */
export type LaunchStep = 
  | 'connect-wallet'
  | 'metadata'
  | 'select-mint'
  | 'launch-settings'
  | 'sign-send'
  | 'result'

export interface LaunchState {
  currentStep: LaunchStep
  walletConnected: boolean
  metadata: TokenMetadata | null
  mintKeypair: Keypair | null
  metadataUri: string | null
  transactionSignature: string | null
  error: string | null
}
