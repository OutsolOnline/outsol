import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

const { balances, prepareTransfer } = vi.hoisted(() => ({
  balances: new Map<string, bigint>(),
  prepareTransfer: vi.fn(),
}))

vi.mock('../src/lib/walletOperations/builder', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/walletOperations/builder')>(),
  prepareWalletOperation: prepareTransfer,
}))

vi.mock('../src/lib/walletGroups/simulate', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/walletGroups/simulate')>(),
  ordinaryWalletBalance: async (_connection: unknown, address: string) => balances.get(address) ?? 0n,
  quoteGroupSolFee: async () => 5000n,
  simulateGroupSol: async (_connection: unknown, _transaction: unknown, intent: { payer: string; recipients: { address: string; rawAmount: string }[] }) => {
    const payerBefore = balances.get(intent.payer) ?? 0n
    const total = intent.recipients.reduce((sum, recipient) => sum + BigInt(recipient.rawAmount), 0n)
    return {
      payerBeforeLamports: payerBefore.toString(),
      payerAfterLamports: (payerBefore - total - 5000n).toString(),
      networkFeeLamports: '5000',
      rentChangeLamports: '0',
      recipients: intent.recipients.map(recipient => {
        const before = balances.get(recipient.address) ?? 0n
        return { ...recipient, beforeRaw: before.toString(), afterRaw: (before + BigInt(recipient.rawAmount)).toString() }
      }),
    }
  },
}))

import { prepareGroupOperation } from '../src/lib/walletGroups/prepare'

const address = () => Keypair.generate().publicKey.toBase58()
const wallet = (publicKey: string) => ({ id: crypto.randomUUID(), name: 'Group member', address: publicKey })
const connection = {
  getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  getMinimumBalanceForRentExemption: async () => 690880,
  getLatestBlockhash: async () => ({ blockhash: address(), lastValidBlockHeight: 200 }),
  getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(key => {
    const amount = balances.get(key.toBase58())
    return amount === undefined ? null : { lamports: Number(amount), owner: SystemProgram.programId, executable: false, data: Buffer.alloc(0) }
  }),
} as unknown as Parameters<typeof prepareGroupOperation>[0]

beforeEach(() => {
  balances.clear()
  prepareTransfer.mockReset()
})

describe('whole-group balance previews for self-excluded members', () => {
  it('shows the actual final balance of a group member that funds the other members', async () => {
    const payer = address(), recipient = address(), senderMember = wallet(payer)
    balances.set(payer, 2000000n)
    prepareTransfer.mockResolvedValue({
      preview: {
        payerBeforeLamports: '2000000', payerAfterLamports: '995000', networkFeeLamports: '5000',
        recipients: [{ address: recipient, beforeRaw: '0', afterRaw: '1000000' }],
      },
    })
    const result = await prepareGroupOperation(connection, {
      kind: 'fund', groupName: 'Launch team', wallets: [senderMember, wallet(recipient)],
      payer, amountSol: '0.001', priorityFeeSol: '0',
    })
    expect(result.rows.find(row => row.walletId === senderMember.id)).toMatchObject({
      status: 'skipped', transferLamports: '0', beforeLamports: '2000000', afterLamports: '995000',
    })
    expect(result.summary.payerAfterLamports).toBe('995000')
  })

  it('shows all incoming withdrawals in the final balance of a destination that belongs to the group', async () => {
    const sender = address(), destination = address(), destinationMember = wallet(destination)
    balances.set(sender, 1000000n)
    balances.set(destination, 3000000n)
    const result = await prepareGroupOperation(connection, {
      kind: 'withdraw', groupName: 'Launch team', wallets: [wallet(sender), destinationMember],
      destination, amountMode: 'available', reserveSol: '0', priorityFeeSol: '0',
    })
    expect(result.rows.find(row => row.walletId === destinationMember.id)).toMatchObject({
      status: 'skipped', transferLamports: '0', beforeLamports: '3000000', afterLamports: '3995000',
    })
    expect(result.summary.destinationAfterLamports).toBe('3995000')
  })
})
