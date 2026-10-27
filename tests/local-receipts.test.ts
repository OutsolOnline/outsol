import { beforeEach, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { saveWallet, getWallet, listWallets, saveLaunch, getLaunches, updateLaunchSellSignature } from '../src/lib/supabase/walletService'

let stored: Map<string, string>
beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
})

it('refuses remote wallet storage and never persists wallet secrets', async () => {
  const secret = bs58.encode(Keypair.generate().secretKey)
  expect(await saveWallet('public', secret)).toBe(false)
  expect(await getWallet('public')).toBeNull()
  expect(await listWallets()).toEqual([])
  expect(stored.size).toBe(0)
})

it('stores a public launch receipt locally and updates its sell receipt', async () => {
  const address = Keypair.generate().publicKey.toBase58()
  const signature = bs58.encode(new Uint8Array(64).fill(1))
  const sell = bs58.encode(new Uint8Array(64).fill(2))
  expect(await saveLaunch({ walletPublicKey: address, mintAddress: address, tokenName: 'Test', tokenSymbol: 'TEST', txSignature: signature, devBuyAmount: 0, autoSellEnabled: false })).toBe(true)
  expect(await updateLaunchSellSignature(signature, sell)).toBe(true)
  const receipts = await getLaunches(address)
  expect(receipts).toHaveLength(1)
  expect(receipts[0].sell_signature).toBe(sell)
  expect(stored.size).toBe(1)
})
