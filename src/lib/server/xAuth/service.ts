import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isAllowedRequestOrigin } from '../requestOrigin'
import { PENDING_TTL, SESSION_TTL, X_SCOPES, xAuthConfig, type XAuthConfig } from './config'
import { XAuthStore, type XRecord } from './storage'
import { authHeaders, XAuthError, type XPublicIdentity } from './types'

export { XAuthError, type XPublicIdentity } from './types'
const SESSION_COOKIE = '__Host-outsol-x', PENDING_COOKIE = '__Host-outsol-x-pending'
const HANDLE = /^[A-Za-z0-9_-]{43}$/
type Pending = XRecord & { stateHash: string; verifier: string }
type Flow = XRecord & { phase: 'active' | 'exchanging' | 'cancelled' | 'completed'; stateHash: string; sessionHandle?: string }
type Tokens = { accessToken: string; refreshToken: string; tokenExpiresAt: number }
type Session = XRecord & Tokens & { user: XPublicIdentity }
interface Options { fetcher?: typeof fetch; now?: () => number }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const newHandle = () => randomBytes(32).toString('base64url')
const notConnected = () => new XAuthError(401, 'not_connected', 'Connect your X account to continue.')
const providerUnavailable = () => new XAuthError(503, 'provider_unavailable', 'X is temporarily unavailable. Try again later.')

function cookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie') || ''
  if (raw.length > 8192) return undefined
  const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`))
  if (values.length !== 1) return undefined
  const value = values[0].slice(name.length + 1)
  return HANDLE.test(value) ? value : undefined
}
function setCookie(headers: Headers, name: string, value: string, maxAge: number) {
  headers.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`)
}
function json(value: unknown, status = 200, headers = new Headers(authHeaders)) { return Response.json(value, { status, headers }) }
function errorResponse(error: unknown) {
  const safe = error instanceof XAuthError ? error : providerUnavailable()
  return json({ error: safe.message, code: safe.code }, safe.status)
}
function validIdentity(value: unknown): XPublicIdentity {
  const data = value as Record<string, unknown> | undefined
  if (!data || typeof data.id !== 'string' || !/^[1-9][0-9]{0,24}$/.test(data.id) || typeof data.username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(data.username) || typeof data.name !== 'string' || !data.name || data.name.length > 100 || /[\x00-\x1f\x7f]/.test(data.name) || typeof data.protected !== 'boolean') throw providerUnavailable()
  let profileImageUrl: string | undefined
  const profile = data.profile_image_url ?? data.profileImageUrl
  if (profile !== undefined) {
    if (typeof profile !== 'string' || profile.length > 2048) throw providerUnavailable()
    let url: URL; try { url = new URL(profile) } catch { throw providerUnavailable() }
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || url.port || url.username || url.password || url.hash) throw providerUnavailable()
    profileImageUrl = url.toString()
  }
  return { id: data.id, username: data.username, name: data.name, protected: data.protected, ...(profileImageUrl ? { profileImageUrl } : {}) }
}

/** OAuth credentials stay inside this server module and the encrypted private store. */
export function createXAuthService(options: Options = {}) {
  const fetcher = options.fetcher || fetch, now = options.now || Date.now
  const clients = new Map<string, { count: number; expires: number }>(), aggregate = new Map<string, { count: number; expires: number }>()
  const storeFor = (config: XAuthConfig) => new XAuthStore({ directory: config.directory, key: config.key, now })
  const limit = (operation: string, request: Request, individual: number, total: number) => {
    const time = now(), key = `${operation}:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown'}`
    for (const [id, entry] of clients) if (entry.expires <= time) clients.delete(id)
    if (clients.size >= 2000 && !clients.has(key)) throw new XAuthError(429, 'rate_limited', 'X connection requests are busy. Try again shortly.')
    const global = aggregate.get(operation), group = global && global.expires > time ? global : { count: 0, expires: time + 60_000 }
    const previous = clients.get(key), client = previous && previous.expires > time ? previous : { count: 0, expires: time + 60_000 }
    aggregate.set(operation, group); clients.set(key, client)
    if (++client.count > individual || ++group.count > total) throw new XAuthError(429, 'rate_limited', 'Too many X connection requests. Try again shortly.')
  }
  const checkOrigin = (request: Request) => {
    if (!isAllowedRequestOrigin(request)) throw new XAuthError(403, 'origin_not_allowed', 'Origin not allowed.')
  }
  const readBytes = async (body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal) => {
    if (!body) return ''
    const reader = body.getReader(), chunks: Uint8Array[] = []; let bytes = 0
    const cancel = () => { void reader.cancel().catch(() => {}) }; signal.addEventListener('abort', cancel, { once: true })
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        bytes += value.byteLength
        if (bytes > maximum) throw providerUnavailable()
        chunks.push(value)
      }
      const result = new Uint8Array(bytes); let offset = 0
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
      return new TextDecoder('utf-8', { fatal: true }).decode(result)
    } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  const checkPost = async (request: Request) => {
    checkOrigin(request)
    if (!request.headers.get('origin')) throw new XAuthError(403, 'origin_not_allowed', 'Origin not allowed.')
    if (request.method !== 'POST' || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new XAuthError(415, 'invalid_request', 'Send a JSON request.')
    if (Number(request.headers.get('content-length')) > 1024) throw new XAuthError(413, 'invalid_request', 'The request is too large.')
    try {
      const body = JSON.parse(await readBytes(request.body, 1024, AbortSignal.timeout(5000)))
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new Error()
    } catch { throw new XAuthError(400, 'invalid_request', 'Send an empty JSON object.') }
  }
  const remote = async (path: 'token' | 'me' | 'revoke', init: RequestInit): Promise<unknown> => {
    const destination = path === 'me' ? 'https://api.x.com/2/users/me?user.fields=profile_image_url%2Cprotected' : `https://api.x.com/2/oauth2/${path}`
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(destination, { ...init, signal: controller.signal, redirect: 'error', cache: 'no-store' })
          if (!response.ok) {
            void response.body?.cancel().catch(() => {})
            if (response.status === 429) throw new XAuthError(429, 'rate_limited', 'X request limit reached. Try again later.')
            if (path === 'token' && [400, 401, 403].includes(response.status)) throw new XAuthError(401, 'connection_expired', 'Your X connection expired. Connect again.')
            throw providerUnavailable()
          }
          if (Number(response.headers.get('content-length')) > 65_536) { void response.body?.cancel().catch(() => {}); throw providerUnavailable() }
          const text = await readBytes(response.body, 65_536, controller.signal)
          return path === 'revoke' ? null : JSON.parse(text)
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(providerUnavailable()) }, 10_000) }),
      ])
    } catch (error) { if (error instanceof XAuthError) throw error; throw providerUnavailable() }
    finally { if (timer) clearTimeout(timer); controller.abort() }
  }
  const basic = (config: XAuthConfig) => `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
  const tokenRequest = async (config: XAuthConfig, fields: Record<string, string>): Promise<Tokens> => {
    const data = await remote('token', { method: 'POST', headers: { Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }) as Record<string, unknown>
    const validToken = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192 && /^[\x21-\x7e]+$/.test(value)
    if (!data || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || !validToken(data.access_token) || !validToken(data.refresh_token) || !Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0 || Number(data.expires_in) > 86400 || typeof data.scope !== 'string' || data.scope.length > 512) throw providerUnavailable()
    const scopes = data.scope.split(' ').filter(Boolean)
    if (scopes.length !== X_SCOPES.length || X_SCOPES.some(scope => !scopes.includes(scope))) throw providerUnavailable()
    return { accessToken: data.access_token, refreshToken: data.refresh_token, tokenExpiresAt: now() + Number(data.expires_in) * 1000 }
  }
  const revoke = async (config: XAuthConfig, tokens: Tokens) => {
    const results = await Promise.all([tokens.accessToken, tokens.refreshToken].map(async token => {
      try { await remote('revoke', { method: 'POST', headers: { Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }); return true } catch { return false }
    }))
    return results.every(Boolean)
  }
  const readSession = async (store: XAuthStore, handle: string): Promise<Session | null> => {
    const value = await store.get<Session>('session', handle)
    if (!value) return null
    if (typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' || !Number.isSafeInteger(value.tokenExpiresAt) || value.expiresAt > now() + SESSION_TTL) throw new XAuthError(503, 'storage_unavailable', 'The X connection store is unavailable. Try again later.')
    return { ...value, user: validIdentity(value.user) }
  }
  const readFlow = async (store: XAuthStore, handle: string): Promise<Flow | null> => {
    const value = await store.get<Flow>('flow', handle)
    if (value && (!['active', 'exchanging', 'cancelled', 'completed'].includes(value.phase) || typeof value.stateHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.stateHash) || value.sessionHandle !== undefined && !HANDLE.test(value.sessionHandle) || value.phase === 'completed' && !value.sessionHandle)) throw new XAuthError(503, 'storage_unavailable', 'The X connection store is unavailable. Try again later.')
    return value
  }
  const matchesState = (flow: Flow, state: string) => HANDLE.test(state) && timingSafeEqual(Buffer.from(hash(state), 'hex'), Buffer.from(flow.stateHash, 'hex'))
  const cancelFlow = async (store: XAuthStore, handle: string, expectedState?: string): Promise<Session | null> => store.lock(`flow:${hash(handle)}`, async () => {
    const flow = await readFlow(store, handle)
    // Unknown/stale cookies never allocate tombstones. An old callback cannot
    // cancel a newer browser flow whose state belongs to another authorization.
    if (!flow || expectedState !== undefined && !matchesState(flow, expectedState)) return null
    if (flow.phase !== 'cancelled') await store.put('flow', handle, { phase: 'cancelled', stateHash: flow.stateHash, ...(flow.sessionHandle ? { sessionHandle: flow.sessionHandle } : {}), expiresAt: now() + PENDING_TTL })
    await store.remove('pending', handle)
    if (!flow.sessionHandle) return null
    const completed = flow.sessionHandle
    return store.lock(`session:${hash(completed)}`, async () => {
      const session = await readSession(store, completed)
      await store.remove('session', completed)
      return session
    })
  })
  const safeCallbackOrigin = () => {
    try { const url = new URL(process.env.X_CALLBACK_URL || ''); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/api/x/callback' && !url.search && !url.hash) return url.origin } catch { /* fixed trusted fallback below */ }
    return 'https://outsol.online'
  }
  const redirect = (result: 'connected' | 'cancelled' | 'error', sessionHandle?: string) => {
    const headers = new Headers(authHeaders)
    headers.set('Location', `${safeCallbackOrigin()}/x?connection=${result}`)
    // Keep the short-lived pending cookie until expiry/disconnect. An older
    // callback response must not erase a newer flow's cookie in another tab.
    if (sessionHandle) setCookie(headers, SESSION_COOKIE, sessionHandle, SESSION_TTL / 1000)
    return new Response(null, { status: 303, headers })
  }

  return {
    async connect(request: Request): Promise<Response> {
      try {
        await checkPost(request); limit('connect', request, 6, 40)
        const config = xAuthConfig()
        if (new URL(request.url).origin !== config.callback.origin) return json({ continueUrl: `${config.callback.origin}/x` })
        const store = storeFor(config), pendingHandle = newHandle(), state = newHandle(), verifier = newHandle()
        const previous = cookie(request, PENDING_COOKIE)
        if (previous) { const superseded = await cancelFlow(store, previous); if (superseded) await revoke(config, superseded) }
        await store.put('flow', pendingHandle, { phase: 'active', stateHash: hash(state), expiresAt: now() + PENDING_TTL })
        try { await store.put('pending', pendingHandle, { stateHash: hash(state), verifier, expiresAt: now() + PENDING_TTL }) }
        catch (error) { await store.remove('flow', pendingHandle).catch(() => {}); throw error }
        const url = new URL('https://x.com/i/oauth2/authorize')
        url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.callback.toString(), scope: X_SCOPES.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
        const headers = new Headers(authHeaders); setCookie(headers, PENDING_COOKIE, pendingHandle, PENDING_TTL / 1000)
        return json({ authorizeUrl: url.toString() }, 200, headers)
      } catch (error) { return errorResponse(error) }
    },
    async callback(request: Request): Promise<Response> {
      let config: XAuthConfig | undefined, tokens: Tokens | undefined, saved: string | undefined, callbackHandle: string | undefined, callbackState: string | undefined
      try {
        config = xAuthConfig(); limit('callback', request, 20, 80)
        const url = new URL(request.url), handle = cookie(request, PENDING_COOKIE)
        if (request.method !== 'GET' || url.origin !== config.callback.origin || url.pathname !== config.callback.pathname || !handle) throw new Error()
        callbackHandle = handle
        callbackState = url.searchParams.getAll('state').length === 1 ? url.searchParams.get('state') || undefined : undefined
        const store = storeFor(config), pending = await store.lock(`flow:${hash(handle)}`, async () => {
          const flow = await readFlow(store, handle)
          if (!flow || !callbackState || !matchesState(flow, callbackState) || flow.phase !== 'active') throw new Error()
          const value = await store.take<Pending>('pending', handle)
          if (!value) throw new Error()
          await store.put('flow', handle, { phase: 'exchanging', stateHash: flow.stateHash, expiresAt: value.expiresAt })
          return value
        })
        if (!pending || url.toString().length > 4096 || [...url.searchParams.keys()].some(key => !['code', 'state', 'error', 'error_description'].includes(key)) || [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1)) throw new Error()
        const state = url.searchParams.get('state') || ''
        if (!HANDLE.test(state) || typeof pending.stateHash !== 'string' || !/^[a-f0-9]{64}$/.test(pending.stateHash) || !timingSafeEqual(Buffer.from(hash(state), 'hex'), Buffer.from(pending.stateHash, 'hex')) || !HANDLE.test(pending.verifier)) throw new Error()
        if (url.searchParams.get('error') === 'access_denied' && !url.searchParams.has('code')) { await cancelFlow(store, handle, state); return redirect('cancelled') }
        const code = url.searchParams.get('code') || ''
        if (url.searchParams.has('error') || !code || code.length > 2048 || /[\x00-\x20\x7f]/.test(code)) throw new Error()
        tokens = await tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.callback.toString(), code_verifier: pending.verifier })
        const profile = await remote('me', { method: 'GET', headers: { Authorization: `Bearer ${tokens.accessToken}` } }) as { data?: unknown }
        const user = validIdentity(profile?.data), next = newHandle()
        return await store.lock(`flow:${hash(handle)}`, async () => {
          const flow = await readFlow(store, handle)
          if (!flow || flow.phase !== 'exchanging') throw new Error()
          // Persist the link first: an older-cookie disconnect can find this session
          // even before the callback's Set-Cookie has reached the browser.
          saved = next
          await store.put('flow', handle, { phase: 'completed', stateHash: flow.stateHash, sessionHandle: next, expiresAt: now() + PENDING_TTL })
          await store.put('session', next, { ...tokens!, user, expiresAt: now() + SESSION_TTL })
          const prior = cookie(request, SESSION_COOKIE)
          if (prior) await store.lock(`session:${hash(prior)}`, () => store.remove('session', prior))
          return redirect('connected', next)
        })
      } catch {
        let cancelled: Session | null = null
        if (config && callbackHandle && callbackState) cancelled = await cancelFlow(storeFor(config), callbackHandle, callbackState).catch(() => null)
        if (config && saved) await storeFor(config).remove('session', saved).catch(() => {})
        const obtained = tokens ? [tokens] : []
        if (cancelled && (!tokens || cancelled.accessToken !== tokens.accessToken || cancelled.refreshToken !== tokens.refreshToken)) obtained.push(cancelled)
        if (config) await Promise.all(obtained.map(value => revoke(config!, value)))
        return redirect('error')
      }
    },
    async session(request: Request): Promise<Response> {
      try {
        checkOrigin(request); limit('session', request, 60, 600)
        let config: XAuthConfig
        try { config = xAuthConfig() } catch { return json({ available: false, connected: false }) }
        const handle = cookie(request, SESSION_COOKIE), session = handle ? await readSession(storeFor(config), handle) : null
        return json({ available: true, connected: !!session, ...(session ? { user: session.user, expiresAt: new Date(session.expiresAt).toISOString() } : {}) })
      } catch (error) { return errorResponse(error) }
    },
    async disconnect(request: Request): Promise<Response> {
      try {
        await checkPost(request); limit('disconnect', request, 10, 80)
        const config = xAuthConfig(), store = storeFor(config), handle = cookie(request, SESSION_COOKIE), pending = cookie(request, PENDING_COOKIE)
        const tokens: Session[] = [], removed = new Set<string>()
        const removeSession = async (id: string) => {
          if (removed.has(id)) return
          const existing = await store.lock(`session:${hash(id)}`, async () => { const value = await readSession(store, id); await store.remove('session', id); return value })
          removed.add(id); if (existing) tokens.push(existing)
        }
        if (pending) { const completed = await cancelFlow(store, pending); if (completed) tokens.push(completed) }
        if (handle) await removeSession(handle)
        const revocations = await Promise.all(tokens.map(value => revoke(config, value)))
        const providerRevoked = revocations.length > 0 && revocations.every(Boolean)
        const headers = new Headers(authHeaders); setCookie(headers, SESSION_COOKIE, '', 0); setCookie(headers, PENDING_COOKIE, '', 0)
        return json({ disconnected: true, providerRevoked }, 200, headers)
      } catch (error) { return errorResponse(error) }
    },
    async withAccessToken<T>(request: Request, operation: (token: string, user: XPublicIdentity) => Promise<T>): Promise<T> {
      checkOrigin(request)
      const config = xAuthConfig(), handle = cookie(request, SESSION_COOKIE)
      if (!handle) throw notConnected()
      const store = storeFor(config)
      const session = await store.lock(`session:${hash(handle)}`, async () => {
        const current = await readSession(store, handle)
        if (!current) throw notConnected()
        if (current.tokenExpiresAt > now() + 60_000) return current
        limit('refresh', request, 6, 40)
        let refreshed: Tokens
        try { refreshed = await tokenRequest(config, { grant_type: 'refresh_token', refresh_token: current.refreshToken }) }
        catch (error) { if (error instanceof XAuthError && error.code === 'connection_expired') await store.remove('session', handle); throw error }
        const next: Session = { ...current, ...refreshed }
        try { await store.put('session', handle, next) }
        catch (error) { await store.remove('session', handle).catch(() => {}); await revoke(config, refreshed); throw error }
        return next
      })
      try { return await operation(session.accessToken, { ...session.user }) }
      catch (error) {
        const rejected = error as { status?: unknown; code?: unknown } | null
        if (rejected?.status === 401 && ['not_connected', 'connection_expired'].includes(String(rejected.code))) {
          await store.lock(`session:${hash(handle)}`, async () => {
            const current = await readSession(store, handle)
            // A newer refresh may have completed while this request was in flight.
            if (current?.accessToken === session.accessToken) await store.remove('session', handle)
          })
        }
        throw error
      }
    },
  }
}

const state = globalThis as typeof globalThis & { __outsolXAuthService?: ReturnType<typeof createXAuthService> }
export const xAuthService = state.__outsolXAuthService ||= createXAuthService()
export async function withXAccessToken<T>(request: Request, operation: (token: string, user: XPublicIdentity) => Promise<T>): Promise<T> {
  return xAuthService.withAccessToken(request, operation)
}
