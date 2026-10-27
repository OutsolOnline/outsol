import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { publicBundleReceipt } from './receipt'
import type { BundleResult } from './types'
import { parseResolvedCreatorFeeRouting } from '@/lib/creatorFeeRouting'

export const BUNDLE_PENDING_KEY = 'vanity-bundle-pending-v1'
export const BUNDLE_RECEIPT_KEY = 'vanity-bundle-public-receipt-v1'
export interface BundleReceiptStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const FIELDS = ['success', 'status', 'mintAddress', 'createSignature', 'bundleId', 'buySignatures', 'sellSignature', 'bundleSellSignatures', 'submittedSignatures', 'submissions', 'error', 'creatorFeeRouting']
function target(storage?: BundleReceiptStorage): BundleReceiptStorage { if (storage) return storage; if (typeof localStorage === 'undefined') throw new Error('Bundle recovery storage is unavailable.'); return localStorage }
function signature(value: unknown): string {
  if (typeof value !== 'string' || value.length > 88 || bs58.decode(value).length !== 64) throw new Error('Invalid bundle signature')
  return value
}
export function parseBundleReceipt(value: unknown): BundleResult | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bundle receipt')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !FIELDS.includes(key)) || typeof input.success !== 'boolean' || (input.status !== undefined && !['unknown', 'confirmed', 'failed', 'partial'].includes(String(input.status)))) throw new Error('Invalid bundle receipt')
  const result: BundleResult = { success: input.success, ...(input.status ? { status: input.status as BundleResult['status'] } : {}) }
  if (input.mintAddress !== undefined) {
    if (typeof input.mintAddress !== 'string' || new PublicKey(input.mintAddress).toBase58() !== input.mintAddress) throw new Error('Invalid bundle mint')
    result.mintAddress = input.mintAddress
  }
  for (const key of ['createSignature', 'sellSignature'] as const) if (input[key] !== undefined) result[key] = signature(input[key])
  for (const key of ['buySignatures', 'bundleSellSignatures', 'submittedSignatures'] as const) if (input[key] !== undefined) {
    if (!Array.isArray(input[key]) || input[key].length > 64) throw new Error('Invalid bundle signature list')
    result[key] = input[key].map(signature)
    if (new Set(result[key]).size !== result[key]!.length) throw new Error('Duplicate bundle signatures')
  }
  if(input.submissions!==undefined){
    if(!Array.isArray(input.submissions)||input.submissions.length>64||input.submissions.length!==(result.submittedSignatures?.length??0))throw new Error('Invalid bundle submission context')
    const fields=['signature','payer','blockhash','expiresAfterBlockHeight','submittedAt'],seen=new Set<string>()
    result.submissions=input.submissions.map(value=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('Invalid public submission context')
      const item=value as Record<string,unknown>,original=signature(item.signature)
      if(!result.submittedSignatures?.includes(original)||seen.has(original)||typeof item.payer!=='string'||new PublicKey(item.payer).toBase58()!==item.payer||typeof item.blockhash!=='string'||bs58.decode(item.blockhash).length!==32||bs58.encode(bs58.decode(item.blockhash))!==item.blockhash||!Number.isSafeInteger(item.expiresAfterBlockHeight)||Number(item.expiresAfterBlockHeight)<1||typeof item.submittedAt!=='string'||item.submittedAt.length>40||!Number.isFinite(Date.parse(item.submittedAt)))throw new Error('Invalid bundle submission expiry context')
      seen.add(original)
      return {signature:original,payer:item.payer,blockhash:item.blockhash,expiresAfterBlockHeight:Number(item.expiresAfterBlockHeight),submittedAt:item.submittedAt}
    })
  }
  if (input.bundleId !== undefined) { if (typeof input.bundleId !== 'string' || input.bundleId.length > 256 || !input.bundleId) throw new Error('Invalid bundle ID'); result.bundleId = input.bundleId }
  if (input.error !== undefined) { if (typeof input.error !== 'string' || input.error.length > 2000) throw new Error('Invalid bundle error'); result.error = input.error.slice(0, 500) }
  if (input.creatorFeeRouting !== undefined) {
    result.creatorFeeRouting = parseResolvedCreatorFeeRouting(input.creatorFeeRouting)
    if(result.creatorFeeRouting.mint!==result.mintAddress)throw new Error('Bundle routing mint does not match')
  }
  if (result.status === 'unknown' && (!result.mintAddress || !result.submittedSignatures?.length || (result.createSignature && !result.submittedSignatures.includes(result.createSignature)))) throw new Error('Incomplete unknown bundle receipt')
  if (result.status === undefined && result.submittedSignatures?.length) throw new Error('Bundle status is missing')
  return result
}
function parsed(raw: string): unknown { if (raw.length > 100_000) throw new Error('Bundle receipt is too large'); return JSON.parse(raw) }
function legacy(storage: BundleReceiptStorage): BundleResult | null {
  const raw = storage.getItem(BUNDLE_RECEIPT_KEY)
  if (!raw) return null
  const value = parsed(raw) as { state?: { result?: unknown } }
  if (!value || typeof value !== 'object' || !value.state || !Object.prototype.hasOwnProperty.call(value.state, 'result')) throw new Error('Invalid persisted bundle state')
  return parseBundleReceipt(value.state.result)
}
/** Read-only validated public record for Activity; the caller never receives signer/config fields. */
export function readSavedBundleReceipt(storage?: BundleReceiptStorage): BundleResult | null {
  if (!storage && typeof window === 'undefined') return null
  try { return legacy(target(storage)) } catch { throw new Error('Bundle history cannot be read. Preserve browser data and review Bundler before spending again.') }
}
export function readPendingBundleReceipt(storage?: BundleReceiptStorage): BundleResult | null {
  if (!storage && typeof window === 'undefined') return null
  try {
    const destination = target(storage), prior = legacy(destination), raw = destination.getItem(BUNDLE_PENDING_KEY)
    if (!raw) return prior?.status === 'unknown' ? prior : null
    const value = parsed(raw) as { version?: number; receipt?: unknown }
    const pending = value?.version === 1 ? parseBundleReceipt(value.receipt) : null
    if (!pending || pending.status !== 'unknown') throw new Error('Invalid pending bundle')
    if (prior?.status === 'unknown' && (prior.mintAddress !== pending.mintAddress || JSON.stringify(prior.creatorFeeRouting)!==JSON.stringify(pending.creatorFeeRouting) || prior.submittedSignatures?.some(value => !pending.submittedSignatures?.includes(value)))) throw new Error('Bundle recovery records disagree')
    return pending
  } catch { throw new Error('Bundle recovery data cannot be read. Preserve browser data and check the saved signatures before spending again.') }
}
export function assertNoPendingBundleReceipt(storage?: BundleReceiptStorage): void {
  if (readPendingBundleReceipt(storage)) throw new Error('A bundle is pending confirmation. Open Bundler and check its saved signatures before spending again.')
}

/** Called only by the lock-owning executor/reconciler; stores public evidence. */
export function persistBundleCheckpoint(input: BundleResult, storage?: BundleReceiptStorage): void {
  const destination = target(storage), pending = readPendingBundleReceipt(destination), next = parseBundleReceipt(publicBundleReceipt(input))!
  if (pending && pending.mintAddress !== next.mintAddress) throw new Error('The pending bundle changed. Preserve its signatures.')
  if(pending?.submissions?.some(item=>JSON.stringify(next.submissions?.find(value=>value.signature===item.signature))!==JSON.stringify(item)))throw new Error('Original bundle submission expiry context cannot be discarded or changed.')
  if (pending && JSON.stringify(pending.creatorFeeRouting)!==JSON.stringify(next.creatorFeeRouting)) throw new Error('The pending creator fee recipient changed. Preserve its signatures.')
  if (next.status === 'unknown') {
    if (pending?.submittedSignatures?.some(value => !next.submittedSignatures?.includes(value))) throw new Error('Bundle signatures cannot be discarded while confirmation is unknown.')
    destination.setItem(BUNDLE_PENDING_KEY, JSON.stringify({ version: 1, receipt: next }))
    const saved = readPendingBundleReceipt(destination)
    if (!saved || JSON.stringify(saved.submittedSignatures) !== JSON.stringify(next.submittedSignatures)) throw new Error('The public bundle recovery record could not be saved. Nothing new was submitted.')
  } else if (pending) {
    // The caller has checked these signatures or knows the current attempt was
    // never broadcast. Rewrite the legacy copy before clearing the durable gate.
    destination.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify({ state: { result: next }, version: 0 }))
    destination.removeItem(BUNDLE_PENDING_KEY)
  }
  destination.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify({ state: { result: next }, version: 0 }))
}

/** Ordinary Zustand config updates cannot erase unresolved or malformed evidence. */
export function guardedBundleReceiptStorage(storage: BundleReceiptStorage): BundleReceiptStorage {
  const protectedRecord = () => {
    try { return !!readPendingBundleReceipt(storage) } catch { return true }
  }
  return {
    getItem: key => storage.getItem(key),
    setItem: (key, value) => { if (key !== BUNDLE_RECEIPT_KEY || !protectedRecord()) storage.setItem(key, value) },
    removeItem: key => { if (key !== BUNDLE_RECEIPT_KEY || !protectedRecord()) storage.removeItem(key) },
  }
}
