import { PublicKey } from '@solana/web3.js'
import { getRpcEndpoint } from '@/lib/rpc'

/**
 * Pump.fun Program Constants
 * 
 * Legacy address helpers. Transaction builders use the official Pump SDK.
 */

// Pump.fun Program ID (mainnet)
export const PUMP_FUN_PROGRAM_ID = new PublicKey(
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
)

// Pump.fun Fee Recipient
export const PUMP_FUN_FEE_RECIPIENT = new PublicKey(
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM'
)

// Event Authority for Pump.fun
export const PUMP_FUN_EVENT_AUTHORITY = new PublicKey(
  'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'
)

// Global state account
export const PUMP_FUN_GLOBAL = new PublicKey(
  '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf'
)

// Mint authority (derived as PDA from program)
// This will be computed dynamically when needed
export const PUMP_FUN_MINT_AUTHORITY_SEED = 'mint-authority'

// System Programs
export const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111')
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const RENT_PROGRAM_ID = new PublicKey('SysvarRent111111111111111111111111111111111')
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

// Solana RPC endpoints
// RPC Endpoints
export const RPC_ENDPOINTS = {
  mainnet: getRpcEndpoint(),
  devnet: 'https://api.devnet.solana.com',
} as const

// Default network
export const DEFAULT_NETWORK: keyof typeof RPC_ENDPOINTS = 'mainnet'

// Fee in SOL for creating a token on Pump.fun (approximate)
export const PUMP_FUN_CREATE_FEE_SOL = 0.02

// Token metadata defaults
export const DEFAULT_DECIMALS = 6
export const DEFAULT_SUPPLY = 1_000_000_000 // 1 billion tokens

/**
 * Derive PDA addresses for Pump.fun accounts
 */
export function deriveBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_FUN_PROGRAM_ID
  )
}

export function deriveMetadataPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  )
}

export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  return address
}

/**
 * Instruction discriminators for Pump.fun program
 * These are the first 8 bytes of the instruction data that identify the instruction type
 */
export const INSTRUCTION_DISCRIMINATORS = {
  // Create instruction discriminator (sha256("global:create")[0:8])
  create: Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]),
  // Buy instruction discriminator
  buy: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  // Sell instruction discriminator
  sell: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
} as const
