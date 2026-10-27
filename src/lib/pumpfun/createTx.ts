import { Keypair } from '@solana/web3.js'
import type { CreateTokenParams, PumpFunLinks } from './types'

/**
 * Generate Pump.fun and Solscan links for a token
 */
export function generateTokenLinks(mintAddress: string): PumpFunLinks {
  return {
    tokenPage: `https://pump.fun/${mintAddress}`,
    tradeUrl: `https://pump.fun/trade/${mintAddress}`,
    solscanUrl: `https://solscan.io/token/${mintAddress}`,
  }
}

/**
 * Create metadata JSON for uploading
 */
export function createMetadataJson(
  metadata: CreateTokenParams['metadata'],
  imageUri?: string
): object {
  return {
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description,
    image: imageUri || metadata.image || '',
    showName: true,
    createdOn: 'https://pump.fun',
    ...(metadata.website && { website: metadata.website }),
    ...(metadata.twitter && { twitter: metadata.twitter }),
    ...(metadata.telegram && { telegram: metadata.telegram }),
  }
}

/**
 * Export keypair to JSON format with security warnings
 */
export function exportKeypairToJson(keypair: Keypair): string {
  const data = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey),
    timestamp: new Date().toISOString(),
    warning: 'NEVER share this file. The secret key gives full control of this address. Keep it safe and backed up.',
  }
  return JSON.stringify(data, null, 2)
}

/**
 * Import keypair from JSON format
 */
export function importKeypairFromJson(json: string): Keypair | null {
  try {
    const data = JSON.parse(json)
    const bytes = Array.isArray(data) ? data : data.secretKey
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null
    const keypair = Keypair.fromSecretKey(new Uint8Array(bytes))
    if (!Array.isArray(data) && data.publicKey && data.publicKey !== keypair.publicKey.toBase58()) return null
    return keypair
  } catch {
    return null
  }
}
