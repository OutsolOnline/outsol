import { describe, expect, it, vi } from 'vitest'
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { confirmSignatures, sendAndConfirmTransaction } from '../src/lib/transactions/send'

const error = { InstructionError: [0, { Custom: 1 }] }
const status = (confirmationStatus: string | undefined, err: unknown) => ({
  context: { slot: 100 },
  value: [{ slot: 99, confirmations: confirmationStatus === 'finalized' ? null : 1, confirmationStatus, err }],
})

function signedTransaction() {
  const payer = Keypair.generate()
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })],
  }).compileToV0Message())
  transaction.sign([payer])
  return transaction
}

describe('transaction errors require the same confirmation threshold as successful receipts', () => {
  it.each(['processed', undefined])('preserves the original signature as unknown for an error without confirmation (%s)', async confirmationStatus => {
    const transaction = signedTransaction()
    const signature = bs58.encode(transaction.signatures[0])
    const connection = {
      sendRawTransaction: async () => signature,
      getSignatureStatuses: async () => status(confirmationStatus, error),
    } as unknown as Connection
    const receipt = await sendAndConfirmTransaction(connection, transaction, { timeoutMs: 10, pollIntervalMs: 1 })
    expect(receipt).toMatchObject({ status: 'unknown', submitted: true, signature })
  })

  it('continues polling after a processed error and accepts the subsequent confirmed success', async () => {
    const connection = {
      getSignatureStatuses: vi.fn()
        .mockResolvedValueOnce(status('processed', error))
        .mockResolvedValue(status('confirmed', null)),
    } as unknown as Connection
    expect(await confirmSignatures(connection, ['original-signature'], { timeoutMs: 50, pollIntervalMs: 1 })).toEqual({ status: 'confirmed' })
  })

  it.each(['confirmed', 'finalized'])('reports an error as terminal when its observation is %s', async confirmationStatus => {
    const connection = { getSignatureStatuses: async () => status(confirmationStatus, error) } as unknown as Connection
    expect(await confirmSignatures(connection, ['original-signature'], { timeoutMs: 50, pollIntervalMs: 1 })).toMatchObject({ status: 'failed' })
  })
})
