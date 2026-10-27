import { describe, expect, it } from 'vitest'
import { Connection, Keypair, PublicKey, SystemInstruction, TransactionMessage } from '@solana/web3.js'
import { createVerifiedJitoTipTransaction, JITO_TIP_ACCOUNTS } from '../src/lib/bundler/jito'

const owner = new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt')
const account = (lamports: number) => ({ lamports, owner, data: Buffer.from('ySH0dOBEYSg=', 'base64'), executable: false, rentEpoch: 0 })
function connection(accounts: ReturnType<typeof account>[]) {
  return { getMultipleAccountsInfo: async () => accounts, getMinimumBalanceForRentExemption: async () => 946560 } as unknown as Connection
}

describe('verified canonical Jito tip selection', () => {
  it('selects a correctly owned rent-safe account and preserves the approved tip exactly', async () => {
    const accounts = JITO_TIP_ACCOUNTS.map(() => account(690880)); accounts[3] = account(1_000_000)
    const payer = Keypair.generate().publicKey
    const transaction = await createVerifiedJitoTipTransaction(connection(accounts), payer, Keypair.generate().publicKey.toBase58(), 10000)
    const transfer = SystemInstruction.decodeTransfer(TransactionMessage.decompile(transaction.message).instructions[0])
    expect(transfer.fromPubkey.equals(payer)).toBe(true); expect(transfer.toPubkey.toBase58()).toBe(JITO_TIP_ACCOUNTS[3]); expect(transfer.lamports).toBe(10000n)
  })

  it('accepts a canonical account when the approved deposit itself restores rent exemption', async () => {
    const accounts = JITO_TIP_ACCOUNTS.map(() => account(690880))
    const transaction = await createVerifiedJitoTipTransaction(connection(accounts), Keypair.generate().publicKey, Keypair.generate().publicKey.toBase58(), 1_000_000)
    expect(SystemInstruction.decodeTransfer(TransactionMessage.decompile(transaction.message).instructions[0]).lamports).toBe(1_000_000n)
  })

  it('rejects unavailable, malformed, wrongly owned and under-rent destinations', async () => {
    const payer = Keypair.generate().publicKey, blockhash = Keypair.generate().publicKey.toBase58()
    await expect(createVerifiedJitoTipTransaction(connection(JITO_TIP_ACCOUNTS.map(() => account(690880))), payer, blockhash, 10000)).rejects.toThrow(/rent|recipient/i)
    const wrongOwner = JITO_TIP_ACCOUNTS.map(() => ({ ...account(1_000_000), owner: PublicKey.default }))
    await expect(createVerifiedJitoTipTransaction(connection(wrongOwner), payer, blockhash, 10000)).rejects.toThrow(/recipient/i)
    const badData = JITO_TIP_ACCOUNTS.map(() => ({ ...account(1_000_000), data: Buffer.alloc(8) }))
    await expect(createVerifiedJitoTipTransaction(connection(badData), payer, blockhash, 10000)).rejects.toThrow(/recipient/i)
    await expect(createVerifiedJitoTipTransaction(connection([]), payer, blockhash, 10000)).rejects.toThrow(/recipient/i)
  })
})
