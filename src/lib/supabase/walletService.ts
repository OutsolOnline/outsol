import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { VaniteWallet, VaniteLaunch } from './client'

const RECEIPTS_KEY = 'vanity-public-launch-receipts-v1'
const MAX_RECEIPTS = 200

// Compatibility exports intentionally refuse cloud storage of private keys.
export async function saveWallet(_publicKey: string, _secretKeyBase58: string): Promise<boolean> { return false }
export async function getWallet(_publicKey: string): Promise<string | null> { return null }
export async function deleteWallet(_publicKey: string): Promise<boolean> { return false }
export async function listWallets(): Promise<VaniteWallet[]> { return [] }

function validSignature(value: string): boolean {
  try { return bs58.decode(value).length === 64 } catch { return false }
}

function readReceipts(): VaniteLaunch[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(RECEIPTS_KEY)
  const value = raw ? JSON.parse(raw) : []
  return Array.isArray(value) ? value.slice(0, MAX_RECEIPTS) : []
}

export async function saveLaunch(launch: {
  walletPublicKey: string; mintAddress: string; tokenName: string; tokenSymbol: string
  txSignature: string; sellSignature?: string; devBuyAmount: number; autoSellEnabled: boolean
}): Promise<boolean> {
  try {
    new PublicKey(launch.walletPublicKey)
    new PublicKey(launch.mintAddress)
    if (!validSignature(launch.txSignature) || (launch.sellSignature && !validSignature(launch.sellSignature))) return false
    if (!Number.isFinite(launch.devBuyAmount) || launch.devBuyAmount < 0) return false
    const receipt: VaniteLaunch = {
      id: crypto.randomUUID(), wallet_public_key: launch.walletPublicKey,
      mint_address: launch.mintAddress, token_name: launch.tokenName.slice(0, 100),
      token_symbol: launch.tokenSymbol.slice(0, 20), tx_signature: launch.txSignature,
      sell_signature: launch.sellSignature || null, dev_buy_amount: launch.devBuyAmount,
      auto_sell_enabled: !!launch.autoSellEnabled, created_at: new Date().toISOString(),
    }
    const receipts = readReceipts().filter(item => item.tx_signature !== receipt.tx_signature)
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify([receipt, ...receipts].slice(0, MAX_RECEIPTS)))
    return true
  } catch { return false }
}

export async function updateLaunchSellSignature(txSignature: string, sellSignature: string): Promise<boolean> {
  try {
    if (!validSignature(txSignature) || !validSignature(sellSignature)) return false
    const receipts = readReceipts()
    const found = receipts.find(item => item.tx_signature === txSignature)
    if (!found) return false
    found.sell_signature = sellSignature
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts))
    return true
  } catch { return false }
}

export async function getLaunches(walletPublicKey?: string): Promise<VaniteLaunch[]> {
  try { return readReceipts().filter(item => !walletPublicKey || item.wallet_public_key === walletPublicKey) }
  catch { return [] }
}
