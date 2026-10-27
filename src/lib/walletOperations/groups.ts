import { publicAddress } from './model'
import type { WalletOperationStorage } from './history'

const KEY = 'vanity-wallet-groups-v1'
export interface WalletGroup { id: string; name: string; addresses: string[] }
function target(storage?: WalletOperationStorage) { if (storage) return storage; if (typeof localStorage === 'undefined') throw new Error('Wallet group storage is unavailable.'); return localStorage }
function safeGroup(input: WalletGroup): WalletGroup {
  if (!input || typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 60 || !Array.isArray(input.addresses) || !input.addresses.length || input.addresses.length > 8) throw new Error('Use a group name and one to eight public wallet addresses.')
  const addresses = input.addresses.map(value => publicAddress(value, true))
  if (new Set(addresses).size !== addresses.length) throw new Error('A group cannot contain duplicate wallet addresses.')
  return { id: input.id, name: input.name.trim(), addresses }
}
export function readWalletGroups(storage?: WalletOperationStorage): WalletGroup[] {
  try {
    const raw = target(storage).getItem(KEY)
    if (!raw) return []
    if (raw.length > 40000) throw new Error()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 20) throw new Error()
    const groups = parsed.map(safeGroup)
    if (new Set(groups.map(group => group.id)).size !== groups.length) throw new Error()
    return groups
  } catch { throw new Error('Wallet groups cannot be read. Preserve this browser’s data before saving another group.') }
}
export function saveWalletGroup(input: { name: string; addresses: string[]; id?: string }, storage?: WalletOperationStorage): WalletGroup {
  const safe = safeGroup({ ...input, id: input.id ?? crypto.randomUUID() }), groups = readWalletGroups(storage)
  if (groups.length >= 20 && !groups.some(group => group.id === safe.id)) throw new Error('You have 20 groups. Remove one before adding another.')
  target(storage).setItem(KEY, JSON.stringify([safe, ...groups.filter(group => group.id !== safe.id)]))
  if (!readWalletGroups(storage).some(group => group.id === safe.id)) throw new Error('The wallet group could not be saved.')
  return safe
}
export function removeWalletGroup(id: string, storage?: WalletOperationStorage) { target(storage).setItem(KEY, JSON.stringify(readWalletGroups(storage).filter(group => group.id !== id))) }
