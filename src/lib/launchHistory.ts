import type { LaunchReceipt } from '@/stores/launchStore'
import {publicLaunchBundleOutcome} from './launchBundle/receipt'
import { parseResolvedCreatorFeeRouting } from './creatorFeeRouting'
export const RECEIPTS_KEY = 'vanity-launch-receipts'
export const PENDING_KEY = 'vanity-pending-launch'
export interface PendingLaunch extends Omit<LaunchReceipt, 'confirmedAt'> { payer: string; blockhash: string; submittedAt: string; phase?: 'lookup' | 'launch'; lookupTableAddress?: string; expiresAfterBlockHeight?: number }

// Public fields only. Never serialize a launch plan, signer or application store.
export function publicPending(input: PendingLaunch): PendingLaunch {
  const routing = input.creatorFeeRouting === undefined ? undefined : parseResolvedCreatorFeeRouting(input.creatorFeeRouting)
  if (routing && (routing.payer !== input.payer || routing.mint !== input.mint || input.mode !== 'standard' || (input.venue !== undefined && input.venue !== 'pump'))) throw new Error('Saved creator fee routing does not match this Pump launch.')
  const outcome=input.bundleExecution===undefined?undefined:publicLaunchBundleOutcome(input.bundleExecution)
  if(outcome?.transfers?.length&&(input.mode!=='standard'||(input.venue!==undefined&&input.venue!=='pump')||outcome.transfers.some(item=>item.mint!==input.mint)))throw new Error('Saved token transfer intent does not match this Pump launch.')
  return { ...(outcome===undefined?{}:{bundleExecution:outcome}), mode: input.mode, mint: input.mint, signatures: [...input.signatures], payer: input.payer, blockhash: input.blockhash, submittedAt: input.submittedAt, poolAddress: input.poolAddress, lockAddress: input.lockAddress, unlockAt: input.unlockAt, ...(input.venue ? { venue: input.venue } : {}), ...(input.phase ? { phase: input.phase } : {}), ...(input.lookupTableAddress ? { lookupTableAddress: input.lookupTableAddress } : {}), ...(Number.isSafeInteger(input.expiresAfterBlockHeight) ? { expiresAfterBlockHeight: input.expiresAfterBlockHeight } : {}), ...(routing ? { creatorFeeRouting: routing } : {}) }
}
export function pastExpiryBoundary(pending: PendingLaunch, finalizedHeight: number): boolean {
  return Number.isSafeInteger(pending.expiresAfterBlockHeight) && pending.expiresAfterBlockHeight! > 0 && finalizedHeight > pending.expiresAfterBlockHeight!
}
export function readPending(): PendingLaunch | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (raw === null) return null
    const item = JSON.parse(raw)
    if (!item || !['standard', 'lock', 'liquidity'].includes(item.mode) || typeof item.mint !== 'string' || !Array.isArray(item.signatures) || !item.signatures.length || item.signatures.some((s: unknown) => typeof s !== 'string') || typeof item.payer !== 'string' || typeof item.blockhash !== 'string') throw new Error('Invalid recovery record')
    return publicPending(item)
  } catch { throw new Error('Launch recovery storage is unreadable. Check your last transaction and preserve this browser’s data before launching again.') }
}
export function savePending(input: PendingLaunch) {
  const safe = publicPending(input)
  const existing = readPending()
  if (existing && !samePending(existing, safe)) throw new Error('A different launch needs a confirmation check. Its recovery information is preserved.')
  localStorage.setItem(PENDING_KEY, JSON.stringify(safe))
  if (!readPending()) throw new Error('Could not save the recovery record. Enable browser storage before launching.')
}
export function samePending(a: PendingLaunch | null, b: PendingLaunch): boolean {
  if (!a || a.mint !== b.mint || a.blockhash !== b.blockhash || a.signatures.length !== b.signatures.length || !a.signatures.every((signature,index) => signature === b.signatures[index])) return false
  try {const first=publicPending(a),second=publicPending(b);return JSON.stringify(first.creatorFeeRouting)===JSON.stringify(second.creatorFeeRouting)&&JSON.stringify(first.bundleExecution?.transfers)===JSON.stringify(second.bundleExecution?.transfers)}catch{return false}
}
export function clearPendingIfMatching(pending: PendingLaunch) {
  if (samePending(readPending(), pending)) localStorage.removeItem(PENDING_KEY)
}
export function saveConfirmed(pending: PendingLaunch): LaunchReceipt {
  if (pending.phase === 'lookup') throw new Error('A setup transaction is not a completed launch')
  const { payer: _payer, blockhash: _blockhash, submittedAt: _submittedAt, ...publicReceipt } = publicPending(pending)
  const receipt: LaunchReceipt = { ...publicReceipt, confirmedAt: new Date().toISOString() }
  try {
    const existing: LaunchReceipt[] = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]')
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify([receipt, ...existing.filter(item => item.mint !== receipt.mint)].slice(0, 100)))
    clearPendingIfMatching(pending)
  } catch { /* Confirmed on chain even if local history cannot be updated. */ }
  return receipt
}
