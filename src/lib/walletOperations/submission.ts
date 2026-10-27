import { Connection, VersionedTransaction } from '@solana/web3.js'
import { withTimeout } from '@/lib/transactions/http'
import { assertSubmissionSigner, sendAndConfirmTransaction, signedTransactionSignature, throwIfAborted, type TransactionReceipt } from '@/lib/transactions/send'
import { assertNoPendingWalletOperation, clearPendingWalletOperation, readPendingWalletOperation, savePendingWalletOperation, type PendingWalletOperation, type WalletOperationStorage } from './history'
import { inspectWalletOperationIntent, simulateWalletOperation, type PreparedWalletOperation } from './builder'
import { reconcileWalletOperationRecord, type WalletOperationLocks, type WalletRecoveryResult } from './recovery'

export interface WalletSubmissionOptions {
  approved: boolean; readSigner: () => string | null | undefined
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>
  assertAvailable: () => void; signal?: AbortSignal; storage?: WalletOperationStorage; locks?: WalletOperationLocks
  onPending?: (record: PendingWalletOperation) => void
  timeoutMs?: number; pollIntervalMs?: number
}
export interface WalletSubmissionResult { receipt: TransactionReceipt; recovery?: WalletRecoveryResult }

/** The shared browser lock covers review, signing, fresh simulation, persistence and the one broadcast. */
export async function submitReviewedWalletOperation(connection: Connection, prepared: PreparedWalletOperation, options: WalletSubmissionOptions): Promise<WalletSubmissionResult> {
  if (!options.approved) throw new Error('Review the recipients and amounts, then approve this one operation.')
  if (typeof options.assertAvailable !== 'function') throw new Error('Transaction availability must be checked before signing.')
  const locks = (options.locks ?? (typeof navigator !== 'undefined' ? navigator.locks : undefined)) as WalletOperationLocks | undefined
  if (!locks) throw new Error('Use a current browser with secure cross-tab transaction coordination.')
  return locks.request('vanity-launch-submission', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Another tab is signing or checking a transaction. Finish it there first.')
    const check = () => { throwIfAborted(options.signal); options.assertAvailable(); assertNoPendingWalletOperation(options.storage); assertSubmissionSigner(prepared.intent.payer, options.readSigner, options.signal) }
    check()
    if (Date.now() - prepared.createdAt > 60000 || Date.now() < prepared.createdAt) throw new Error('This preview expired. Prepare a new preview before signing.')
    if (!(await withTimeout(connection.isBlockhashValid(prepared.transaction.message.recentBlockhash, { commitment: 'confirmed' }))).value) throw new Error('This transaction expired. Prepare a new preview.')
    check()
    inspectWalletOperationIntent(prepared.transaction, prepared.intent)
    if (Buffer.from(prepared.transaction.message.serialize()).toString('base64') !== prepared.message) throw new Error('The reviewed transaction changed. Prepare a new preview.')
    const signed = await options.signTransaction(VersionedTransaction.deserialize(prepared.transaction.serialize()))
    check()
    if (!(signed instanceof VersionedTransaction) || Buffer.from(signed.message.serialize()).toString('base64') !== prepared.message) throw new Error('The wallet changed the reviewed transaction. Nothing was submitted.')
    inspectWalletOperationIntent(signed, prepared.intent)
    const signature = signedTransactionSignature(signed)
    const currentPreview = await simulateWalletOperation(connection, signed, prepared.intent, true)
    check()
    if (JSON.stringify(currentPreview) !== JSON.stringify(prepared.preview)) throw new Error('A balance or account cost changed since your review. Prepare a fresh preview.')
    if (!(await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash, { commitment: 'confirmed' }))).value) throw new Error('This transaction expired while signing. Prepare again.')
    check()
    const record: PendingWalletOperation = { ...prepared.intent, signature, blockhash: signed.message.recentBlockhash, lastValidBlockHeight: prepared.lastValidBlockHeight, submittedAt: new Date().toISOString() }
    let saved = false
    const receipt = await sendAndConfirmTransaction(connection, signed, { signal: options.signal, timeoutMs: options.timeoutMs, pollIntervalMs: options.pollIntervalMs, onBroadcast: () => {
      check()
      savePendingWalletOperation(record, options.storage); saved = true
      // Storage may invoke synchronous browser hooks; reread the signer at the final transport boundary.
      try {
        assertSubmissionSigner(record.payer, options.readSigner, options.signal); options.assertAvailable()
        options.onPending?.(record)
        assertSubmissionSigner(record.payer, options.readSigner, options.signal); options.assertAvailable()
      } catch (error) { clearPendingWalletOperation(signature, options.storage); saved = false; throw error }
    } })
    if (receipt.submitted === false && saved) clearPendingWalletOperation(signature, options.storage)
    if (receipt.submitted === false || !readPendingWalletOperation(options.storage)) return { receipt }
    if (receipt.status === 'confirmed' || receipt.status === 'failed') return { receipt, recovery: await reconcileWalletOperationRecord(connection, { storage: options.storage, expectedSignature: signature }) }
    return { receipt }
  })
}
