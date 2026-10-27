import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { PENDING_KEY, RECEIPTS_KEY } from './launchHistory'
import { TRADE_HISTORY_KEY, TRADE_PENDING_KEY } from './venues/tradeHistory'
import {WALLET_OPERATION_HISTORY_KEY,WALLET_OPERATION_PENDING_KEY,publicWalletOperationIntent} from './walletOperations/history'
import type {WalletOperationIntent} from './walletOperations/model'
import { BUNDLE_PENDING_KEY, BUNDLE_RECEIPT_KEY, readPendingBundleReceipt, readSavedBundleReceipt } from './bundler/pending'
import type { BundleResult } from './bundler/types'
import { GROUP_OPERATION_HISTORY_KEY, GROUP_OPERATION_PENDING_KEY, publicGroupOperation } from './walletGroups/history'

export type ActivityFilter = 'all' | 'launches' | 'trades' | 'wallets' | 'bundles' | 'pending'
export interface WorkspaceActivityItem {
  id: string
  kind: 'launch' | 'trade' | 'setup' | 'wallet' | 'bundle' | 'group'
  status: 'confirmed' | 'failed' | 'pending' | 'partial'
  mint: string
  venue: string
  timestamp: string | null
  signatures: string[]
  description: string
}
export interface WorkspaceActivitySnapshot { items: WorkspaceActivityItem[]; warnings: string[] }
export const WORKSPACE_ACTIVITY_KEYS = [RECEIPTS_KEY, TRADE_HISTORY_KEY, PENDING_KEY, TRADE_PENDING_KEY,WALLET_OPERATION_HISTORY_KEY,WALLET_OPERATION_PENDING_KEY,BUNDLE_RECEIPT_KEY,BUNDLE_PENDING_KEY,GROUP_OPERATION_HISTORY_KEY,GROUP_OPERATION_PENDING_KEY] as const
const MAX_SOURCE_CHARACTERS = 262_144
const VENUES: Record<string, string> = { pump: 'Pump.fun', bonk: 'Bonk', 'raydium-launchlab': 'Raydium LaunchLab', 'meteora-dbc': 'Meteora DBC', 'raydium-cpmm': 'Raydium CPMM', solana: 'Solana' }
type ReadStorage = { getItem: (key: string) => string | null }
type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid activity record')
  return value as RecordValue
}
function publicKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) || new PublicKey(value).toBase58() !== value) throw new Error('Invalid mint')
  return value
}
function signature(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) || bs58.decode(value).length !== 64) throw new Error('Invalid signature')
  return value
}
function signatures(value: unknown): string[] {
  // Up to three native launch packets plus sixteen confirmed wallet buys.
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error('Invalid signatures')
  return value.map(signature)
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid activity date')
  return new Date(value).toISOString()
}
function launchActivity(value: unknown, pending: boolean): WorkspaceActivityItem {
  const item = record(value)
  if (!['standard', 'lock', 'liquidity'].includes(String(item.mode))) throw new Error('Invalid launch mode')
  if (item.phase !== undefined && item.phase !== 'lookup' && item.phase !== 'launch') throw new Error('Invalid launch phase')
  // A lookup-table setup can never serve as a confirmed launch receipt.
  if (!pending && item.phase === 'lookup') throw new Error('Setup is not a completed launch')
  const mint = publicKey(item.mint), txs = signatures(item.signatures)
  const time = timestamp(pending ? item.submittedAt : item.confirmedAt)
  const kind = pending && item.phase === 'lookup' ? 'setup' : 'launch'
  const status = pending ? 'pending' : 'confirmed'
  const venue = typeof item.venue === 'string' && Object.hasOwn(VENUES, item.venue) ? item.venue : 'solana'
  const description = kind === 'setup' ? 'Launch setup awaiting confirmation; the token launch is not complete.' : pending ? 'Token launch awaiting confirmation.' : `Token launch confirmed on ${VENUES[venue]}.`
  return { id: `${kind}:${status}:${txs.join(':')}`, kind, status, mint, venue, timestamp: time, signatures: txs, description }
}
function tradeActivity(value: unknown, pending: boolean): WorkspaceActivityItem {
  const item = record(value)
  if (item.action !== 'buy' && item.action !== 'sell') throw new Error('Invalid trade action')
  if (!pending && item.status !== 'confirmed' && item.status !== 'failed') throw new Error('Invalid trade status')
  const mint = publicKey(item.mint), tx = signature(item.signature)
  const status = pending ? 'pending' : item.status as 'confirmed' | 'failed'
  const time = timestamp(pending ? item.submittedAt : item.resolvedAt)
  const action = item.action === 'buy' ? 'Buy' : 'Sell'
  // Descriptions are generated here; storage errors, arbitrary summaries and signer fields are never copied.
  const description = `${action} trade ${pending ? 'awaiting confirmation' : status === 'confirmed' ? 'confirmed' : 'failed'}.`
  return { id: `trade:${status}:${tx}`, kind: 'trade', status, mint, venue: 'pump', timestamp: time, signatures: [tx], description }
}
function walletActivity(value:unknown,pending:boolean):WorkspaceActivityItem{
 const item=record(value),intent=publicWalletOperationIntent(item as unknown as WalletOperationIntent)
 if(!pending&&item.status!=='confirmed'&&item.status!=='failed')throw new Error('Invalid wallet status')
 const tx=signature(item.signature),status=pending?'pending':item.status as 'confirmed'|'failed'
 const action=intent.kind==='sol'?'SOL distribution':intent.kind==='token'?'Token distribution':'Empty-account cleanup'
 return {id:`wallet:${status}:${tx}`,kind:'wallet',status,mint:intent.mint||intent.payer,venue:'solana',timestamp:timestamp(pending?item.submittedAt:item.resolvedAt),signatures:[tx],description:`${action} ${pending?'awaiting confirmation':status}.`}
}
function bundleActivity(receipt: BundleResult): WorkspaceActivityItem | null {
  const txs = [...new Set([...(receipt.submittedSignatures || []), ...(receipt.createSignature ? [receipt.createSignature] : []), ...(receipt.buySignatures || []), ...(receipt.sellSignature ? [receipt.sellSignature] : []), ...(receipt.bundleSellSignatures || [])])]
  // Failed preparation and unsubmitted configs are not on-chain activity.
  if (!receipt.mintAddress || !txs.length || !receipt.status) return null
  if (txs.length > 64) throw new Error('Bundle activity exceeds the signature limit')
  const mint = publicKey(receipt.mintAddress), checked = txs.map(signature)
  const status = receipt.status === 'unknown' ? 'pending' : receipt.status
  const description = status === 'pending' ? 'Wallet bundle awaiting confirmation. Review its saved signatures in Bundler.' : status === 'partial' ? 'Wallet bundle partially completed. Review the completed actions and remaining work in Bundler.' : status === 'confirmed' ? 'Wallet bundle confirmed.' : 'Wallet bundle failed. Review its submitted signatures in Bundler.'
  return { id: `bundle:${status}:${mint}:${checked.join(':')}`, kind: 'bundle', status, mint, venue: 'pump', timestamp: null, signatures: checked, description }
}
function groupActivity(value: unknown): WorkspaceActivityItem | null {
  const receipt = publicGroupOperation(value)
  // A pre-broadcast cancellation may have a derived signature in its journal.
  // Only packets that actually reached the submission boundary are activity.
  const submitted = receipt.packets.filter(packet => packet.signature && ['submitted', 'unknown', 'confirmed', 'failed'].includes(packet.status))
  if (!submitted.length) return null
  const txs = [...new Set(submitted.map(packet => signature(packet.signature)))]
  const confirmed = receipt.packets.filter(packet => packet.status === 'confirmed').length
  const status = submitted.some(packet => packet.status === 'submitted' || packet.status === 'unknown') ? 'pending' : confirmed === receipt.packets.length ? 'confirmed' : confirmed > 0 ? 'partial' : 'failed'
  const action = receipt.kind === 'fund' ? 'Group funding' : 'Group withdrawal'
  const state = status === 'pending' ? 'awaiting confirmation' : status === 'partial' ? 'partially completed' : status
  const mint = receipt.kind === 'fund' ? submitted[0].intent.payer : submitted[0].intent.recipients![0].address
  return { id: `group:${receipt.id}`, kind: 'group', status, mint, venue: 'solana', timestamp: receipt.updatedAt, signatures: txs, description: `${action} · ${receipt.groupName} ${state}. Review the group in Wallets.` }
}

/** Read-only public projections. Never returns a signer, wallet store or transaction payload. */
export function readWorkspaceActivity(storage?: ReadStorage): WorkspaceActivitySnapshot {
  const items: WorkspaceActivityItem[] = [], warnings: string[] = []
  let target: ReadStorage
  try {
    target = storage ?? window.localStorage
  } catch {
    return { items, warnings: ['Browser storage is unavailable. Activity cannot be read on this device.'] }
  }
  const read = (key: string, label: string, listLimit: number | null, project: (value: unknown) => WorkspaceActivityItem | null, maxCharacters = MAX_SOURCE_CHARACTERS) => {
    try {
      const raw = target.getItem(key)
      if (raw === null) return
      if (raw.length > maxCharacters) throw new Error('Storage source exceeds the read limit')
      const parsed: unknown = JSON.parse(raw)
      if (listLimit === null) {
        if (parsed !== null) { const item = project(parsed); if (item) items.push(item) }
        return
      }
      if (!Array.isArray(parsed)) throw new Error('History must be a list')
      let skipped = Math.max(0, parsed.length - listLimit)
      for (const entry of parsed.slice(0, listLimit)) {
        try { const item = project(entry); if (item) items.push(item) } catch { skipped++ }
      }
      if (skipped) warnings.push(`${label}: ${skipped} saved ${skipped === 1 ? 'entry was' : 'entries were'} unreadable or outside the history limit. Other records are shown.`)
    } catch {
      warnings.push(`${label} could not be read. Preserve this browser’s data and review the original workspace before trying an operation again.`)
    }
  }
  read(RECEIPTS_KEY, 'Launch history', 100, value => launchActivity(value, false))
  read(TRADE_HISTORY_KEY, 'Trade history', 30, value => tradeActivity(value, false))
  read(PENDING_KEY, 'Pending launch', null, value => launchActivity(value, true))
  read(TRADE_PENDING_KEY, 'Pending trade', null, value => tradeActivity(value, true))
  read(WALLET_OPERATION_HISTORY_KEY,'Wallet history',30,value=>walletActivity(value,false))
  read(WALLET_OPERATION_PENDING_KEY,'Pending wallet operation',null,value=>walletActivity(value,true))
  read(GROUP_OPERATION_HISTORY_KEY, 'Wallet group history', 30, groupActivity, 2_000_000)
  read(GROUP_OPERATION_PENDING_KEY, 'Pending wallet group', null, groupActivity, 100_000)
  try {
    const readonlyStorage = { getItem: (key: string) => target.getItem(key), setItem: () => { throw new Error('Activity cannot mutate bundle records') }, removeItem: () => { throw new Error('Activity cannot mutate bundle records') } }
    const saved = readSavedBundleReceipt(readonlyStorage), pending = readPendingBundleReceipt(readonlyStorage)
    const savedItem = saved ? bundleActivity(saved) : null, pendingItem = pending ? bundleActivity(pending) : null
    if (savedItem && !(pendingItem && savedItem.mint === pendingItem.mint && savedItem.signatures.some(tx => pendingItem.signatures.includes(tx)))) items.push(savedItem)
    if (pendingItem) items.push(pendingItem)
  } catch { warnings.push('Bundle activity could not be read. Preserve this browser’s data and review Bundler before trying another operation.') }
  const unique = [...new Map(items.map(item => [item.id, item])).values()]
  unique.sort((a, b) => a.timestamp === null ? b.timestamp === null ? a.id.localeCompare(b.id) : 1 : b.timestamp === null ? -1 : Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id))
  return { items: unique, warnings }
}
export function filterWorkspaceActivity(items: WorkspaceActivityItem[], filter: ActivityFilter, query: string): WorkspaceActivityItem[] {
  const search = query.trim().toLowerCase().slice(0, 200)
  return items.filter(item => {
    if (filter === 'pending' && item.status !== 'pending') return false
    if (filter === 'trades' && item.kind !== 'trade') return false
    if (filter === 'launches' && !['launch','setup'].includes(item.kind)) return false
    if (filter === 'wallets' && item.kind !== 'wallet' && item.kind !== 'group') return false
    if (filter === 'bundles' && item.kind !== 'bundle') return false
    return !search || [item.description, item.mint, VENUES[item.venue], item.status, item.kind, ...item.signatures].join(' ').toLowerCase().includes(search)
  })
}
