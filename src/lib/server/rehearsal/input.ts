import type { RehearsalInput } from './types'
import {requireSupportedCreatorFeeSelection,type SupportedCreatorFeeSelection} from '@/lib/creatorFeeRouting'

const FIELDS = ['name', 'symbol', 'metadataUri', 'initialBuySol', 'priorityFeeSol', 'jitoTipSol']
export class RehearsalError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export function rehearsalLamports(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
}

export function parseRehearsalInput(value: unknown): RehearsalInput & {creatorFeeSelection:SupportedCreatorFeeSelection} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RehearsalError(400, 'A public launch plan is required')
  const record = value as Record<string, unknown>
  const hasSelection=Object.hasOwn(record,'creatorFeeSelection'),fields=hasSelection?[...FIELDS,'creatorFeeSelection']:FIELDS
  if (Object.keys(record).length !== fields.length || Object.keys(record).some(key => !fields.includes(key))) throw new RehearsalError(400, 'Only public launch settings are accepted')
  let creatorFeeSelection:SupportedCreatorFeeSelection
  try{creatorFeeSelection=hasSelection?requireSupportedCreatorFeeSelection(record.creatorFeeSelection):{kind:'deployer'}}catch(error){throw new RehearsalError(400,error instanceof Error?error.message:'Unsupported creator fee recipient')}
  for (const [key, max] of [['name', 32], ['symbol', 10], ['metadataUri', 200]] as const) {
    if (typeof record[key] !== 'string' || !record[key].trim() || Buffer.byteLength(record[key]) > max || /[\u0000-\u001f\u007f]/.test(record[key])) throw new RehearsalError(400, `Invalid ${key}`)
  }
  let metadata: URL
  try { metadata = new URL(record.metadataUri as string) } catch { throw new RehearsalError(400, 'Use a public HTTPS or IPFS metadata URI') }
  if (!['https:', 'ipfs:'].includes(metadata.protocol) || metadata.username || metadata.password) throw new RehearsalError(400, 'Use a public HTTPS or IPFS metadata URI')
  for (const [key, max] of [['initialBuySol', 1_000_000_000_000n], ['priorityFeeSol', 10_000_000n], ['jitoTipSol', 100_000_000n]] as const) {
    const amount = record[key]
    if (typeof amount !== 'string' || amount.length > 20 || !/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(amount) || rehearsalLamports(amount) > max) throw new RehearsalError(400, `Invalid ${key}`)
  }
  return { name: record.name as string, symbol: record.symbol as string, metadataUri: record.metadataUri as string, initialBuySol: record.initialBuySol as string, priorityFeeSol: record.priorityFeeSol as string, jitoTipSol: record.jitoTipSol as string,creatorFeeSelection }
}
