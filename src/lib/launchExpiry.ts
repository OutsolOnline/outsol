import { PublicKey, type Connection } from '@solana/web3.js'
import type { PendingLaunch } from './launchHistory'
import { pastExpiryBoundary } from './launchHistory'
export async function checkLaunchExpiry(connection: Connection, record: PendingLaunch): Promise<{ expired: boolean; record: PendingLaunch }> {
  if (!record.expiresAfterBlockHeight) return { expired: false, record: { ...record, expiresAfterBlockHeight: await connection.getBlockHeight('confirmed') + 160 } }
  const [valid, height] = await Promise.all([connection.isBlockhashValid(record.blockhash, { commitment: 'finalized' }), connection.getBlockHeight('finalized')])
  if (valid.value || !pastExpiryBoundary(record, height)) return { expired: false, record }
  const statuses = await connection.getSignatureStatuses(record.signatures, { searchTransactionHistory: true })
  if (statuses.value.some(status => status && !status.err)) return { expired: false, record }
  const address = record.phase === 'lookup' ? record.lookupTableAddress : record.mint
  if (!address || await connection.getAccountInfo(new PublicKey(address), 'finalized')) return { expired: false, record }
  return { expired: true, record }
}
