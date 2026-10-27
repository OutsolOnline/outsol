import type { TokenMetadata } from './pumpfun/types'
import { migrateLegacyCreatorFeeSelection, type CreatorFeeSelection } from './creatorFeeRouting'

export type LaunchMode = 'standard' | 'lock' | 'liquidity'
export type LaunchVenue = 'pump' | 'bonk' | 'raydium-launchlab' | 'meteora-dbc'
export interface LaunchConfig {
  mode: LaunchMode
  venue: LaunchVenue
  devBuySol: number
  totalSupply: string
  decimals: number
  liquidityPercent: number
  liquiditySol: string
  unlockAt: number
  slippage: number
  priorityFeeSol: number
  jitoTipSol: number
  creatorFeeSelection: CreatorFeeSelection
}
export const PLATFORM_FEE_BPS = 0 as const
export const DEFAULT_LAUNCH_CONFIG: LaunchConfig = {
  mode: 'standard', venue: 'pump', devBuySol: 0, totalSupply: '1000000000', decimals: 6,
  liquidityPercent: 90, liquiditySol: '1', unlockAt: 0, slippage: 5, priorityFeeSol: 0.0005, jitoTipSol: 0.00001, creatorFeeSelection: { kind: 'deployer' },
}
export function validateLaunchConfig(config: LaunchConfig, now = Math.floor(Date.now() / 1000)): string[] {
  const errors: string[] = []
  try { migrateLegacyCreatorFeeSelection(config.creatorFeeSelection) } catch (error) { errors.push(error instanceof Error ? error.message : 'Choose a valid creator fee recipient.') }
  if (!['standard', 'lock', 'liquidity'].includes(config.mode)) errors.push('Choose a launch mode.')
  if (!['pump', 'bonk', 'raydium-launchlab', 'meteora-dbc'].includes(config.venue)) errors.push('Choose a supported Solana launchpad.')
  if (!Number.isFinite(config.devBuySol) || config.devBuySol < 0 || config.devBuySol > 1000) errors.push('Developer buy must be a valid SOL amount.')
  if (!Number.isFinite(config.slippage) || config.slippage < 0.1 || config.slippage > 50) errors.push('Slippage must be between 0.1% and 50%.')
  if (!Number.isFinite(config.priorityFeeSol) || config.priorityFeeSol < 0 || config.priorityFeeSol > 0.1) errors.push('Priority fee must be between 0 and 0.1 SOL.')
  if (!Number.isFinite(config.jitoTipSol) || config.jitoTipSol < 0.000001 || config.jitoTipSol > 0.1) errors.push('Bundle tip must be between 0.000001 and 0.1 SOL.')
  if (config.mode !== 'standard') {
    if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 9) errors.push('Token decimals must be between 0 and 9.')
    try {
      if (!/^[1-9]\d{0,19}$/.test(config.totalSupply)) throw new Error()
      const rawSupply = BigInt(config.totalSupply) * (10n ** BigInt(config.decimals))
      if (rawSupply > 18446744073709551615n) throw new Error()
    } catch { errors.push('Choose a positive whole-token supply that fits the token limit.') }
    if (!Number.isInteger(config.liquidityPercent) || config.liquidityPercent < 1 || config.liquidityPercent > 99) errors.push('Liquidity allocation must be between 1% and 99%.')
    if (!/^\d+(\.\d{1,9})?$/.test(config.liquiditySol) || Number(config.liquiditySol) <= 0 || Number(config.liquiditySol) > 1000) errors.push('Add a positive SOL amount for liquidity.')
    if (config.mode === 'lock' && (!Number.isSafeInteger(config.unlockAt) || config.unlockAt < now + 3600)) errors.push('Choose an unlock date at least one hour in the future.')
  }
  return errors
}
export function validateTokenDetails(metadata: TokenMetadata): Partial<Record<keyof TokenMetadata, string>> {
  const errors: Partial<Record<keyof TokenMetadata, string>> = {}
  const bytes = (s: string) => new TextEncoder().encode(s).length
  if (!metadata.name.trim() || bytes(metadata.name.trim()) > 32) errors.name = 'Enter a name of 1–32 bytes.'
  if (!/^[A-Za-z0-9_]{1,10}$/.test(metadata.symbol.trim())) errors.symbol = 'Use 1–10 letters, numbers or underscores.'
  if (metadata.description.length > 1000) errors.description = 'Keep the description under 1,000 characters.'
  for (const field of ['website', 'twitter', 'telegram'] as const) {
    if (!metadata[field]?.trim()) continue
    try {
      const url = new URL(metadata[field]!.trim())
      if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) throw new Error()
    } catch { errors[field] = 'Enter a full HTTPS link.' }
  }
  return errors
}
