import { dirname, isAbsolute, resolve } from 'node:path'
import { XAuthError } from './types'

export const X_SCOPES = ['tweet.read', 'users.read', 'offline.access'] as const
export const PENDING_TTL = 10 * 60_000
export const SESSION_TTL = 7 * 24 * 60 * 60_000
export interface XAuthConfig { clientId: string; clientSecret: string; callback: URL; directory: string; key: Buffer }

export function xAuthConfig(): XAuthConfig {
  try {
    const clientId = process.env.X_CLIENT_ID || '', clientSecret = process.env.X_CLIENT_SECRET || ''
    const callbackValue = process.env.X_CALLBACK_URL || '', directoryValue = process.env.X_STORAGE_DIR || ''
    const encodedKey = process.env.X_TOKEN_ENCRYPTION_KEY || ''
    if (!clientId || clientId.length > 1000 || /[\s\x00-\x1f\x7f:]/.test(clientId) || !clientSecret || clientSecret.length > 2000 || /[\x00-\x1f\x7f]/.test(clientSecret)) throw new Error()
    const callback = new URL(callbackValue)
    if (callback.protocol !== 'https:' || callback.username || callback.password || callback.port || callback.pathname !== '/api/x/callback' || callback.search || callback.hash || callback.hostname.includes('*') || callbackValue !== callback.toString()) throw new Error()
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) throw new Error()
    const key = Buffer.from(encodedKey, 'base64')
    if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error()
    if (!isAbsolute(directoryValue)) throw new Error()
    const directory = resolve(directoryValue), volume = resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data')
    const assets = process.env.ASSET_STORAGE_DIR ? resolve(process.env.ASSET_STORAGE_DIR) : undefined
    if (dirname(directory) !== volume || directory === volume || directory === assets || assets && dirname(assets) !== volume) throw new Error()
    return { clientId, clientSecret, callback, directory, key }
  } catch { throw new XAuthError(503, 'setup_required', 'X connection setup is required. Ask the site owner to complete the X settings.') }
}
