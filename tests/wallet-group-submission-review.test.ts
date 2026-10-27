import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { buildWalletOperationTransaction } from '../src/lib/walletOperations/builder'
import type { PreparedGroupOperation, GroupSubmissionOptions } from '../src/lib/walletGroups/types'

const { simulate } = vi.hoisted(() => ({ simulate: vi.fn() }))
vi.mock('../src/lib/walletGroups/simulate', () => ({ simulateGroupSol: simulate }))

import { submitReviewedGroupOperation } from '../src/lib/walletGroups/submission'
import { readGroupOperationHistory, readPendingGroupOperation } from '../src/lib/walletGroups/history'

afterEach(() => vi.restoreAllMocks())

function setup(count = 1) {
  const keys = Array.from({ length: count }, () => Keypair.generate())
  const destination = Keypair.generate().publicKey.toBase58()
  const blockhash = Keypair.generate().publicKey.toBase58()
  const createdAt = Date.now()
  const packets = keys.map((key, index) => {
    const intent = { kind: 'sol' as const, payer: key.publicKey.toBase58(), priorityLamports: '0', recipients: [{ address: destination, rawAmount: '1000000' }] }
    const transaction = buildWalletOperationTransaction(intent, blockhash)
    return {
      intent, transaction, message: Buffer.from(transaction.message.serialize()).toString('base64'), createdAt, lastValidBlockHeight: 200,
      preview: {
        payerBeforeLamports: '2000000', payerAfterLamports: '995000', networkFeeLamports: '5000', rentChangeLamports: '0',
        recipients: [{ ...intent.recipients[0], beforeRaw: String(index * 1000000), afterRaw: String((index + 1) * 1000000) }],
      },
    }
  })
  const prepared: PreparedGroupOperation = {
    id: crypto.randomUUID(), kind: 'withdraw', groupName: 'Review team', createdAt, expiresAt: createdAt + 60000,
    transactions: packets,
    rows: keys.map((key, index) => ({ walletId: crypto.randomUUID(), name: `Wallet ${index + 1}`, address: key.publicKey.toBase58(), beforeLamports: '2000000', afterLamports: '995000', transferLamports: '1000000', networkFeeLamports: '5000', status: 'ready' })),
    summary: { walletCount: count, transactionCount: count, totalTransferLamports: String(count * 1000000), totalNetworkFeeLamports: String(count * 5000), platformFeeLamports: '0', reserveLamports: '0', destinationBeforeLamports: '0', destinationAfterLamports: String(count * 1000000) },
  }
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const connection = {
    isBlockhashValid: vi.fn(async () => ({ value: true })),
    sendRawTransaction: vi.fn(async (bytes: Uint8Array) => bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0])),
    getSignatureStatuses: vi.fn(async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] })),
  } as unknown as Parameters<typeof submitReviewedGroupOperation>[0]
  const options: GroupSubmissionOptions = {
    approved: true, storage,
    locks: { request: async (_name, _options, callback) => callback({}) },
    assertAvailable: () => {}, canSign: payer => keys.some(key => key.publicKey.toBase58() === payer),
    signTransaction: async (payer, transaction) => { transaction.sign([keys.find(key => key.publicKey.toBase58() === payer)!]); return transaction },
  }
  simulate.mockReset()
  simulate.mockImplementation(async (_connection, _transaction, intent) => packets.find(packet => packet.intent.payer === intent.payer)!.preview)
  return { prepared, connection, options, storage }
}

describe('group cancellation and expiry at the final signing boundary', () => {
  it('stops a preview that expires while the signing prompt is open', async () => {
    const { prepared, connection, options } = setup()
    let now = prepared.createdAt
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const sign = options.signTransaction
    options.signTransaction = async (...args) => { now += 61000; return sign(...args) }
    const result = await submitReviewedGroupOperation(connection, prepared, options)
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
    expect(result.packets[0].status).toBe('not-submitted')
    expect(result.error).toMatch(/expired/i)
  })

  it('sends nothing when cancelled after saving the original signature but before transport', async () => {
    const { prepared, connection, options, storage } = setup()
    const controller = new AbortController()
    options.signal = controller.signal
    let journalHadSignature = false
    options.onProgress = record => {
      if (record.packets[0].status === 'submitted') {
        journalHadSignature = !!readPendingGroupOperation(storage)?.packets[0].signature
        controller.abort()
      }
    }
    const result = await submitReviewedGroupOperation(connection, prepared, options)
    expect(journalHadSignature).toBe(true)
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
    expect(result.status).toBe('cancelled')
    expect(result.packets[0].status).toBe('not-submitted')
    expect(readPendingGroupOperation(storage)).toBeNull()
    expect(readGroupOperationHistory(storage)).toMatchObject([{ status: 'cancelled' }])
  })

  it('preserves a confirmed first transfer and skips the remaining wallet after cancellation', async () => {
    const { prepared, connection, options, storage } = setup(2)
    const controller = new AbortController()
    options.signal = controller.signal
    options.onProgress = record => { if (record.packets[0].status === 'confirmed') controller.abort() }
    const result = await submitReviewedGroupOperation(connection, prepared, options)
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('partial')
    expect(result.packets.map(packet => packet.status)).toEqual(['confirmed', 'not-submitted'])
    expect(readPendingGroupOperation(storage)).toBeNull()
    expect(readGroupOperationHistory(storage)).toMatchObject([{ status: 'partial', packets: [{ status: 'confirmed' }, { status: 'not-submitted' }] }])
  })

  it('does not broadcast when the signing wallet locks during signed simulation', async () => {
    const { prepared, connection, options, storage } = setup()
    let unlocked = true
    const canSign = options.canSign
    options.canSign = payer => unlocked && canSign(payer)
    simulate.mockImplementationOnce(async () => { unlocked = false; return prepared.transactions[0].preview })
    const result = await submitReviewedGroupOperation(connection, prepared, options)
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'failed', packets: [{ status: 'not-submitted' }] })
    expect(readPendingGroupOperation(storage)).toBeNull()
    expect(result.error).toMatch(/locked|disconnected|changed/i)
  })

  it('checks the live signing wallet again after the final blockhash RPC response', async () => {
    const { prepared, connection, options } = setup()
    let unlocked = true, checks = 0
    const canSign = options.canSign
    options.canSign = payer => unlocked && canSign(payer)
    vi.mocked(connection.isBlockhashValid).mockImplementation(async () => {
      if (++checks === 2) unlocked = false
      return { context: { slot: 100 }, value: true }
    })
    const result = await submitReviewedGroupOperation(connection, prepared, options)
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
    expect(result.packets[0].status).toBe('not-submitted')
    expect(result.error).toMatch(/locked|disconnected|changed/i)
  })
})
