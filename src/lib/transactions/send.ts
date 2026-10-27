import type { Connection, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { withTimeout } from './http'
export interface TransactionReceipt { status: 'confirmed' | 'failed' | 'unknown'; signature: string; submitted?: boolean; error?: string }
export interface ConfirmationOptions { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal; onBroadcast?: () => void }
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Pending browser actions cancelled. Already submitted transactions remain on chain.', 'AbortError')
}
/** Read the live signer synchronously at the broadcast boundary, after all RPC awaits. */
export function assertSubmissionSigner(expectedPayer: string, readSigner: () => string | undefined | null, signal?: AbortSignal): void {
  throwIfAborted(signal)
  if (readSigner() !== expectedPayer) throw new Error('The signing wallet was locked, disconnected or changed. Nothing was sent.')
}
export function signedTransactionSignature(tx: VersionedTransaction): string {
  if (tx.signatures.length !== tx.message.header.numRequiredSignatures || tx.signatures.some(signature => signature.every(byte => byte === 0))) {
    throw new Error('Every required transaction signer must sign before submission')
  }
  if (tx.serialize().length > 1232) throw new Error('Transaction exceeds the Solana packet size')
  return bs58.encode(tx.signatures[0])
}

export async function confirmSignatures(connection: Connection, signatures: string[], opts: ConfirmationOptions = {}): Promise<{ status: TransactionReceipt['status']; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 45_000
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  const cancelled = () => ({ status: 'unknown' as const, error: 'Pending browser actions cancelled. Confirmation is unknown; preserve the saved signatures and check on chain.' })
  do {
    if (opts.signal?.aborted) return cancelled()
    try {
      const { value } = await withTimeout(connection.getSignatureStatuses(signatures, { searchTransactionHistory: true }), Math.max(1, deadline - Date.now()))
      if (opts.signal?.aborted) return cancelled()
      // A processed observation can disappear on another fork. Preserve the
      // original signature until its error reaches our confirmation threshold.
      const failed = value.find(status => status?.err && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'))
      if (failed) return { status: 'failed', error: `On-chain transaction failed: ${JSON.stringify(failed.err)}` }
      if (value.length === signatures.length && value.every(status => status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'))) {
        return { status: 'confirmed' }
      }
    } catch (error) { lastError = error instanceof Error ? error.message : 'Confirmation unavailable' }
    const remaining = deadline - Date.now()
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)))
  } while (Date.now() < deadline)
  return { status: 'unknown', error: `Confirmation is unknown. Check the saved signatures before starting another launch.${lastError ? ` ${lastError}` : ''}` }
}

export async function sendAndConfirmTransaction(connection: Connection, tx: VersionedTransaction, opts: ConfirmationOptions = {}): Promise<TransactionReceipt> {
  const signature = signedTransactionSignature(tx)
  let sendError = ''
  let submitted = false
  try {
    throwIfAborted(opts.signal)
    const bytes = tx.serialize()
    throwIfAborted(opts.signal)
    opts.onBroadcast?.()
    throwIfAborted(opts.signal)
    submitted = true
    const returned = await withTimeout(connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }), Math.min(opts.timeoutMs ?? 20_000, 20_000))
    if (returned !== signature) sendError = 'RPC returned a different signature'
  } catch (error) {
    if (!submitted) return { status: 'failed', signature, submitted: false, error: error instanceof Error ? error.message : 'Transaction was not submitted' }
    // A lost response may follow a successful send. Reconcile the original
    // signature instead of rebuilding or submitting another spending transaction.
    sendError = error instanceof Error ? error.message : 'Submission response unavailable'
  }
  const receipt = await confirmSignatures(connection, [signature], opts)
  return { ...receipt, signature, submitted, ...(receipt.status === 'unknown' && sendError ? { error: `${receipt.error} ${sendError}` } : {}) }
}
