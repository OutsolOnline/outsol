import type { Connection, SignatureStatus } from '@solana/web3.js'
import { withTimeout } from '@/lib/transactions/http'
import { readPendingWalletOperation, saveWalletOperationReceipt, type PendingWalletOperation, type WalletOperationReceipt, type WalletOperationStorage } from './history'

export interface WalletRecoveryResult { status: 'none' | 'unknown' | 'changed' | 'busy' | 'confirmed' | 'failed'; pending: PendingWalletOperation | null; receipt?: WalletOperationReceipt; error?: string }
export interface WalletOperationLocks { request<T>(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<T>): Promise<T> }
const finalStatus = (value: SignatureStatus | null | undefined) => value && ['confirmed', 'finalized'].includes(value.confirmationStatus || '') ? value.err ? 'failed' : 'confirmed' : null
export async function reconcileWalletOperationRecord(connection: Connection, options: { storage?: WalletOperationStorage; expectedSignature?: string } = {}): Promise<WalletRecoveryResult> {
  const record = readPendingWalletOperation(options.storage)
  if (!record) return { status: 'none', pending: null }
  if (options.expectedSignature && options.expectedSignature !== record.signature) return { status: 'changed', pending: record }
  const switched = (): WalletRecoveryResult | null => { const next = readPendingWalletOperation(options.storage); return next?.signature === record.signature ? null : { status: 'changed', pending: next } }
  const unknown = (): WalletRecoveryResult => switched() ?? { status: 'unknown', pending: readPendingWalletOperation(options.storage), error: 'Confirmation is still unknown. Nothing will be resent automatically.' }
  const finish = (status: 'confirmed' | 'failed', error?: string): WalletRecoveryResult => {
    const changed = switched(); if (changed) return changed
    const receipt = saveWalletOperationReceipt(record, status, error, options.storage)
    return { status, pending: readPendingWalletOperation(options.storage), receipt, error }
  }
  const first = await withTimeout(connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true }))
  const changed = switched(); if (changed) return changed
  const status = finalStatus(first.value[0])
  if (status) return finish(status, status === 'failed' ? `On-chain operation failed: ${JSON.stringify(first.value[0]?.err)}` : undefined)
  if (first.value[0]) return unknown()
  const [validity, height] = await Promise.all([withTimeout(connection.isBlockhashValid(record.blockhash, { commitment: 'finalized' })), withTimeout(connection.getBlockHeight('finalized'))])
  const changedAgain = switched(); if (changedAgain) return changedAgain
  if (validity.value || height <= record.lastValidBlockHeight) return unknown()
  const [last, transaction] = await Promise.all([withTimeout(connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true })), withTimeout(connection.getTransaction(record.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }))])
  const replacement = switched(); if (replacement) return replacement
  const observed = finalStatus(last.value[0])
  if (observed === 'confirmed' || transaction?.meta?.err === null) return finish('confirmed')
  if (observed === 'failed' || transaction?.meta?.err) return finish('failed', 'The transaction failed on chain.')
  if (last.value[0] || transaction) return unknown()
  return finish('failed', 'The original blockhash expired on the finalized chain and the signature was not found in history. Nothing was resent.')
}
export async function reconcilePendingWalletOperation(connection: Connection, options: { storage?: WalletOperationStorage; locks?: WalletOperationLocks } = {}): Promise<WalletRecoveryResult> {
  const locks = (options.locks ?? (typeof navigator !== 'undefined' ? navigator.locks : undefined)) as WalletOperationLocks | undefined
  if (!locks) throw new Error('Use a current browser with secure cross-tab transaction coordination.')
  return locks.request('vanity-launch-submission', { ifAvailable: true }, async (lock): Promise<WalletRecoveryResult> => lock ? reconcileWalletOperationRecord(connection, options) : { status: 'busy', pending: readPendingWalletOperation(options.storage), error: 'Another tab is signing or checking a transaction. Try again when it finishes.' })
}
