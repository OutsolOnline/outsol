import bs58 from 'bs58'
import { publicAddress, type WalletOperationIntent } from './model'

export const WALLET_OPERATION_PENDING_KEY = 'vanity-wallet-operation-pending-v1'
export const WALLET_OPERATION_HISTORY_KEY = 'vanity-wallet-operation-receipts-v1'
export interface WalletOperationStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface PendingWalletOperation extends WalletOperationIntent { signature: string; blockhash: string; lastValidBlockHeight: number; submittedAt: string }
export interface WalletOperationReceipt extends PendingWalletOperation { status: 'confirmed' | 'failed'; resolvedAt: string; error?: string }
function target(storage?: WalletOperationStorage) { if (storage) return storage; if (typeof localStorage === 'undefined') throw new Error('Wallet recovery storage is unavailable.'); return localStorage }
function amount(value: unknown) { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) throw new Error('Invalid wallet operation amount.'); return value }
export function publicWalletOperationIntent(input: WalletOperationIntent): WalletOperationIntent {
  if (!input || !['sol', 'token', 'close'].includes(input.kind)) throw new Error('Invalid wallet operation.')
  const payer = publicAddress(input.payer, true), priorityLamports = amount(input.priorityLamports)
  if (BigInt(priorityLamports) > 10000000n) throw new Error('Invalid priority fee budget.')
  const base = { kind: input.kind, payer, priorityLamports }
  if (input.kind === 'close') {
    if (!Array.isArray(input.closeAccounts) || !input.closeAccounts.length || input.closeAccounts.length > 8) throw new Error('Invalid account cleanup list.')
    const closeAccounts = input.closeAccounts.map(value => ({ address: publicAddress(value.address), mint: publicAddress(value.mint), tokenProgram: publicAddress(value.tokenProgram) }))
    if (new Set(closeAccounts.map(value => value.address)).size !== closeAccounts.length || closeAccounts.some(value => value.address === payer)) throw new Error('Invalid account cleanup list.')
    return { ...base, closeAccounts }
  }
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 8) throw new Error('Invalid wallet recipients.')
  const recipients = input.recipients.map(value => ({ address: publicAddress(value.address, true), rawAmount: amount(value.rawAmount), ...(input.kind === 'token' ? { tokenAccount: publicAddress(value.tokenAccount) } : {}) }))
  if (new Set(recipients.map(value => value.address)).size !== recipients.length || recipients.some(value => value.address === payer || value.rawAmount === '0')) throw new Error('Invalid wallet recipients.')
  if (input.kind === 'sol') return { ...base, recipients }
  if (!Number.isInteger(input.decimals) || input.decimals! < 0 || input.decimals! > 255) throw new Error('Invalid token decimals.')
  return { ...base, recipients, mint: publicAddress(input.mint), sourceAccount: publicAddress(input.sourceAccount), tokenProgram: publicAddress(input.tokenProgram), decimals: input.decimals }
}
function pending(input: PendingWalletOperation): PendingWalletOperation {
  if (typeof input.signature !== 'string' || input.signature.length > 88 || bs58.decode(input.signature).length !== 64 || !Number.isSafeInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight < 1 || typeof input.submittedAt !== 'string' || input.submittedAt.length > 40 || !Number.isFinite(Date.parse(input.submittedAt))) throw new Error('Invalid wallet recovery record.')
  return { ...publicWalletOperationIntent(input), signature: input.signature, blockhash: publicAddress(input.blockhash), lastValidBlockHeight: input.lastValidBlockHeight, submittedAt: new Date(input.submittedAt).toISOString() }
}
export function readPendingWalletOperation(storage?: WalletOperationStorage): PendingWalletOperation | null {
  if (!storage && typeof window === 'undefined') return null
  try { const raw = target(storage).getItem(WALLET_OPERATION_PENDING_KEY); if (!raw) return null; if (raw.length > 10000) throw new Error(); return pending(JSON.parse(raw)) }
  catch { throw new Error('Wallet recovery data cannot be read. Preserve browser data and check your last signature before sending again.') }
}
export function assertNoPendingWalletOperation(storage?: WalletOperationStorage) { if (readPendingWalletOperation(storage)) throw new Error('A wallet operation is pending confirmation. Open Wallet operations and check it before continuing.') }
export function savePendingWalletOperation(input: PendingWalletOperation, storage?: WalletOperationStorage) {
  const storageTarget = target(storage), record = pending(input)
  assertNoPendingWalletOperation(storageTarget)
  storageTarget.setItem(WALLET_OPERATION_PENDING_KEY, JSON.stringify(record))
  if (readPendingWalletOperation(storageTarget)?.signature !== record.signature) throw new Error('The recovery record could not be saved. Nothing was submitted.')
}
export function clearPendingWalletOperation(signature: string, storage?: WalletOperationStorage) { if (readPendingWalletOperation(storage)?.signature === signature) target(storage).removeItem(WALLET_OPERATION_PENDING_KEY) }
export function readWalletOperationHistory(storage?: WalletOperationStorage): WalletOperationReceipt[] {
  const raw = target(storage).getItem(WALLET_OPERATION_HISTORY_KEY)
  if (!raw) return []
  if (raw.length > 300000) throw new Error('Wallet history is too large to read.')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.length > 30) throw new Error('Wallet history cannot be read.')
  return parsed.map(value => {
    if (!['confirmed', 'failed'].includes(value.status) || typeof value.resolvedAt !== 'string' || !Number.isFinite(Date.parse(value.resolvedAt))) throw new Error('Wallet history cannot be read.')
    return { ...pending(value), status: value.status, resolvedAt: new Date(value.resolvedAt).toISOString(), ...(typeof value.error === 'string' ? { error: value.error.slice(0, 500) } : {}) }
  })
}
export function saveWalletOperationReceipt(input: PendingWalletOperation, status: 'confirmed' | 'failed', error?: string, storage?: WalletOperationStorage): WalletOperationReceipt {
  if (readPendingWalletOperation(storage)?.signature !== input.signature) throw new Error('The pending wallet operation changed. Check its current status.')
  const receipt: WalletOperationReceipt = { ...pending(input), status, resolvedAt: new Date().toISOString(), ...(error ? { error: error.slice(0, 500) } : {}) }
  const history = readWalletOperationHistory(storage)
  target(storage).setItem(WALLET_OPERATION_HISTORY_KEY, JSON.stringify([receipt, ...history.filter(value => value.signature !== receipt.signature)].slice(0, 30)))
  if (readWalletOperationHistory(storage)[0]?.signature !== receipt.signature) throw new Error('The wallet receipt could not be saved. Preserve its signature.')
  clearPendingWalletOperation(receipt.signature, storage)
  return receipt
}
