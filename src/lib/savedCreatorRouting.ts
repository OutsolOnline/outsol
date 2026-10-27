import { PublicKey } from '@solana/web3.js'
import { parseResolvedCreatorFeeRouting, type ResolvedCreatorFeeRouting } from './creatorFeeRouting'
import { RECEIPTS_KEY } from './launchHistory'

interface ReceiptStorage { getItem(key: string): string | null }
const MAX_RECEIPT_CHARACTERS = 262144
const MAX_RECEIPTS = 100

/** Saved launch intention only. This does not establish the current on-chain recipient. */
export function readSavedCreatorFeeRouting(mint: string, storage?: ReceiptStorage): ResolvedCreatorFeeRouting | undefined {
  if (new PublicKey(mint).toBase58() !== mint) throw new Error('Invalid mint address for saved creator fee routing.')
  try {
    const raw = (storage || localStorage).getItem(RECEIPTS_KEY)
    if (raw === null) return undefined
    if (raw.length > MAX_RECEIPT_CHARACTERS) throw new Error('Saved receipts exceed the public storage limit.')
    const receipts: unknown = JSON.parse(raw)
    if (!Array.isArray(receipts) || receipts.length > MAX_RECEIPTS) throw new Error('Saved receipt list is invalid.')
    let found = false, result: ResolvedCreatorFeeRouting | undefined
    for (const value of receipts) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const receipt = value as Record<string, unknown>
      if (receipt.mint !== mint) continue
      let routing: ResolvedCreatorFeeRouting | undefined
      if (Object.hasOwn(receipt, 'creatorFeeRouting')) {
        routing = parseResolvedCreatorFeeRouting(receipt.creatorFeeRouting)
        if (routing.mint !== mint || receipt.mode !== 'standard' || receipt.venue !== 'pump') throw new Error('Saved creator fee routing does not match this mint and standard Pump launch.')
      }
      if (found && JSON.stringify(routing) !== JSON.stringify(result)) throw new Error('Saved receipts contain conflicting creator fee routing for this mint.')
      if (!found) { result = routing; found = true }
    }
    return result
  } catch {
    throw new Error('Saved creator fee routing cannot be verified for this mint. Preserve this browser’s data; live chain facts can still be checked.')
  }
}
