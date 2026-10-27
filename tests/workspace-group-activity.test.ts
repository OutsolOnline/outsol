import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { filterWorkspaceActivity, readWorkspaceActivity } from '../src/lib/workspaceActivity'
import { GROUP_OPERATION_HISTORY_KEY, GROUP_OPERATION_PENDING_KEY } from '../src/lib/walletGroups/history'
import { RECEIPTS_KEY } from '../src/lib/launchHistory'
import type { GroupOperationRecord } from '../src/lib/walletGroups/types'

const payer = Keypair.generate().publicKey.toBase58()
const destination = Keypair.generate().publicKey.toBase58()
const signature = bs58.encode(new Uint8Array(64).fill(42))
const time = '2026-10-27T12:00:00.000Z'
function record(): GroupOperationRecord {
  return {
    version: 1, id: crypto.randomUUID(), kind: 'fund', groupName: 'Launch team', createdAt: time, updatedAt: time, status: 'confirmed',
    summary: { walletCount: 1, transactionCount: 1, totalTransferLamports: '1000000', totalNetworkFeeLamports: '5000', platformFeeLamports: '0', reserveLamports: '0' }, skipped: [],
    packets: [{ index: 0, intent: { kind: 'sol', payer, priorityLamports: '0', recipients: [{ address: destination, rawAmount: '1000000' }] }, payerBeforeLamports: '2000000', payerAfterLamports: '995000', networkFeeLamports: '5000', status: 'confirmed', signature, blockhash: payer, lastValidBlockHeight: 200, submittedAt: time }],
  }
}
const storage = (values: Record<string, unknown>) => ({ getItem: (key: string) => key in values ? JSON.stringify(values[key]) : null })

describe('public wallet group activity', () => {
  it('shows confirmed group funding in wallet activity without copying private or arbitrary error fields', () => {
    const value = { ...record(), privateKey: 'PRIVATE', error: 'PRIVATE provider text' }
    const result = readWorkspaceActivity(storage({ [GROUP_OPERATION_HISTORY_KEY]: [value] }))
    expect(result.warnings).toEqual([])
    expect(result.items).toMatchObject([{ kind: 'group', status: 'confirmed', mint: payer, timestamp: time, signatures: [signature], description: expect.stringMatching(/Group funding.*Launch team.*confirmed/i) }])
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|privateKey|provider text|intent|blockhash/)
    expect(filterWorkspaceActivity(result.items, 'wallets', 'Launch team')).toHaveLength(1)
  })

  it('keeps an uncertain original withdrawal signature pending and uses its public destination', () => {
    const value = record(); value.kind = 'withdraw'; value.status = 'unknown'; value.packets[0].status = 'unknown'
    const result = readWorkspaceActivity(storage({ [GROUP_OPERATION_PENDING_KEY]: value }))
    expect(result.items).toMatchObject([{ kind: 'group', status: 'pending', mint: destination, signatures: [signature] }])
    expect(filterWorkspaceActivity(result.items, 'pending', '')).toHaveLength(1)
  })

  it('preserves partial completion and excludes signatures explicitly recorded as never broadcast', () => {
    const value = record(); value.status = 'partial'; value.summary.walletCount = 2; value.summary.transactionCount = 2
    value.packets.push({ ...value.packets[0], index: 1, signature: bs58.encode(new Uint8Array(64).fill(43)), status: 'not-submitted' })
    const result = readWorkspaceActivity(storage({ [GROUP_OPERATION_HISTORY_KEY]: [value] }))
    expect(result.items).toMatchObject([{ kind: 'group', status: 'partial', signatures: [signature] }])
    value.status = 'cancelled'; value.packets.forEach(packet => { packet.status = 'not-submitted' })
    expect(readWorkspaceActivity(storage({ [GROUP_OPERATION_HISTORY_KEY]: [value] })).items).toEqual([])
  })

  it('projects one row when a saved group receipt and its uncleared recovery record overlap', () => {
    const value = record()
    const result = readWorkspaceActivity(storage({ [GROUP_OPERATION_HISTORY_KEY]: [value], [GROUP_OPERATION_PENDING_KEY]: value }))
    expect(result.items).toHaveLength(1)
    expect(result.items[0].signatures).toEqual([signature])
  })

  it('warns about malformed group data while keeping older valid launch history', () => {
    const value = record(); value.packets[0].signature = 'invalid-signature'
    const launch = { mode: 'standard', venue: 'pump', mint: destination, signatures: [signature], confirmedAt: time }
    const result = readWorkspaceActivity(storage({ [GROUP_OPERATION_PENDING_KEY]: value, [RECEIPTS_KEY]: [launch] }))
    expect(result.items).toMatchObject([{ kind: 'launch' }])
    expect(result.warnings.join(' ')).toMatch(/group/i)
  })
})
