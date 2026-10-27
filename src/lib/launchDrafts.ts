import { DEFAULT_LAUNCH_CONFIG, validateLaunchConfig, type LaunchConfig } from './launchConfig'
import type { TokenMetadata } from './pumpfun/types'
import {parseLaunchBundleSettings,type LaunchBundleSettings} from './launchBundle/types'
import { migrateLegacyCreatorFeeSelection } from './creatorFeeRouting'

const KEY = 'vanity-public-launch-drafts-v1'
const MAX_DRAFTS = 30
const MAX_STORED_CHARACTERS = 200000
const CONFIG_KEYS = (Object.keys(DEFAULT_LAUNCH_CONFIG) as (keyof LaunchConfig)[]).filter(key => key !== 'creatorFeeSelection')
export interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LaunchDraft { version: 1; id: string; name: string; updatedAt: string; metadata: TokenMetadata; metadataUri: string; config: LaunchConfig; artworkId?: string; bundleSettings?: LaunchBundleSettings }
export interface LaunchDraftInput { name: string; metadata: TokenMetadata; metadataUri: string; config: LaunchConfig; artworkId?: string; bundleSettings?: LaunchBundleSettings }
function publicUrl(value: unknown, limit: number, ipfs = false): string {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > limit) throw new Error('Draft contains an invalid public link.')
  const url = new URL(value)
  if ((url.protocol !== 'https:' && !(ipfs && url.protocol === 'ipfs:')) || !url.hostname || url.username || url.password) throw new Error('Draft links must use HTTPS or a public IPFS URI.')
  return value
}
function text(value: unknown, limit: number, bytes = true): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || (bytes ? new TextEncoder().encode(value).length : value.length) > limit) throw new Error('Draft text is invalid or too long.')
  return value
}
export function createLaunchDraft(input: LaunchDraftInput, id: string = crypto.randomUUID(), now = Date.now()): LaunchDraft {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Invalid draft identifier.')
  if (!input || typeof input !== 'object' || !input.metadata || !input.config) throw new Error('Invalid public launch draft.')
  if (input.artworkId !== undefined && (typeof input.artworkId !== 'string' || !/^[a-f0-9]{64}$/.test(input.artworkId))) throw new Error('Draft artwork reference is invalid.')
  if (CONFIG_KEYS.some(key => typeof input.config[key] !== typeof DEFAULT_LAUNCH_CONFIG[key])) throw new Error('Draft launch settings have invalid types.')
  const config = { ...Object.fromEntries(CONFIG_KEYS.map(key => [key, input.config[key]])), creatorFeeSelection: migrateLegacyCreatorFeeSelection(input.config.creatorFeeSelection) } as LaunchConfig
  if (!Number.isSafeInteger(config.unlockAt) || config.unlockAt < 0 || config.unlockAt > 253402300799) throw new Error('Draft lock date is invalid.')
  if (typeof config.totalSupply !== 'string' || config.totalSupply.length > 20 || typeof config.liquiditySol !== 'string' || config.liquiditySol.length > 20 || validateLaunchConfig(config, 0).length || validateLaunchConfig({ ...config, mode: config.mode === 'lock' ? 'lock' : 'liquidity' }, 0).length) throw new Error('Draft launch settings are invalid. Check the amounts and lock date.')
  const metadata: TokenMetadata = { name: text(input.metadata.name, 32), symbol: text(input.metadata.symbol, 10), description: text(input.metadata.description, 1000, false) }
  for (const key of ['website', 'twitter', 'telegram'] as const) metadata[key] = publicUrl(input.metadata[key], 300)
  const name = text(input.name, 80, false).trim() || metadata.name || 'Untitled launch'
  const bundleSettings=input.bundleSettings===undefined?undefined:parseLaunchBundleSettings(input.bundleSettings)
  return { version: 1, id, name, updatedAt: new Date(now).toISOString(), metadata, metadataUri: publicUrl(input.metadataUri, 200, true), config, ...(input.artworkId ? { artworkId: input.artworkId } : {}),...(bundleSettings?{bundleSettings}:{}) }
}
function target(storage?: DraftStorage): DraftStorage { return storage || localStorage }
export function loadLaunchDrafts(storage?: DraftStorage): LaunchDraft[] {
  try {
    const raw = target(storage).getItem(KEY)
    if (!raw) return []
    if (raw.length > MAX_STORED_CHARACTERS) throw new Error()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > MAX_DRAFTS) throw new Error()
    const result = parsed.map(value => {
      if (!value || value.version !== 1 || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error()
      return createLaunchDraft(value, value.id, Date.parse(value.updatedAt))
    })
    if (new Set(result.map(value => value.id)).size !== result.length) throw new Error()
    return result
  } catch { throw new Error('Saved drafts cannot be read. Preserve this browser’s data before saving another draft.') }
}
export function saveLaunchDraft(draft: LaunchDraft, storage?: DraftStorage): void {
  const safe = createLaunchDraft(draft, draft.id, Date.parse(draft.updatedAt))
  const existing = loadLaunchDrafts(storage)
  if (existing.length >= MAX_DRAFTS && !existing.some(item => item.id === safe.id)) throw new Error('You have 30 drafts. Export or remove one before saving another.')
  const serialized = JSON.stringify([safe, ...existing.filter(item => item.id !== safe.id)])
  if (serialized.length > MAX_STORED_CHARACTERS) throw new Error('Draft storage is full. Export or remove a draft before saving another.')
  target(storage).setItem(KEY, serialized)
  if (!loadLaunchDrafts(storage).some(item => item.id === safe.id)) throw new Error('Draft could not be saved. Check browser storage permissions.')
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vanity-drafts-changed'))
}
export function removeLaunchDraft(id: string, storage?: DraftStorage): void {
  target(storage).setItem(KEY, JSON.stringify(loadLaunchDrafts(storage).filter(item => item.id !== id)))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vanity-drafts-changed'))
}
export function restoreLaunchDraft(draft: LaunchDraft, now = Math.floor(Date.now() / 1000)) {
  const safe = createLaunchDraft(draft, draft.id, Date.parse(draft.updatedAt))
  return { currentStep: 'metadata' as const, metadata: safe.metadata, metadataUri: safe.metadataUri,bundleSettings:parseLaunchBundleSettings(safe.bundleSettings), ...(safe.artworkId ? { artworkId: safe.artworkId } : {}), config: { ...safe.config, ...(safe.config.mode === 'lock' && safe.config.unlockAt < now + 3600 ? { unlockAt: now + 30 * 86400 } : {}) } }
}
