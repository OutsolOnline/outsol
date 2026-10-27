import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createXAuthService } from '../src/lib/server/xAuth/service'

let root: string
let now: number
const origin = 'https://outsol.online'
const identity = { id: '123456', username: 'outsol_test', name: 'Test account', protected: true, profile_image_url: 'https://pbs.twimg.com/profile_images/test.png' }
const tokenPayload = (access = 'test-access', refresh = 'test-refresh') => ({ token_type: 'bearer', access_token: access, refresh_token: refresh, expires_in: 7200, scope: 'tweet.read users.read offline.access' })
const request = (path: string, cookie?: string, init: RequestInit = {}) => new Request(`${origin}/api/x/${path}`, { ...init, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) } })
const post = (path: string, cookie?: string) => request(path, cookie, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => !value.endsWith('=')).join('; ')
type Service = ReturnType<typeof createXAuthService>
const authorize = async (service: Service) => {
  const response = await service.connect(post('connect'))
  expect(response.status).toBe(200)
  return { response, cookie: cookies(response), url: new URL((await response.json()).authorizeUrl) }
}
const connected = async (service: Service) => {
  const auth = await authorize(service)
  const response = await service.callback(request(`callback?state=${auth.url.searchParams.get('state')}&code=test-code`, auth.cookie))
  expect(response.headers.get('location')).toBe(`${origin}/x?connection=connected`)
  return { cookie: cookies(response), response, auth }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'outsol-x-auth-')); now = Date.UTC(2026, 9, 27)
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('X_CLIENT_ID', 'test-client')
  vi.stubEnv('X_CLIENT_SECRET', 'test-client-secret')
  vi.stubEnv('X_CALLBACK_URL', `${origin}/api/x/callback`)
  vi.stubEnv('X_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubEnv('X_STORAGE_DIR', join(root, 'private'))
  vi.stubEnv('RAILWAY_VOLUME_MOUNT_PATH', root)
  vi.stubEnv('ASSET_STORAGE_DIR', join(root, 'public'))
  vi.stubEnv('PUBLIC_APP_URL', origin)
  vi.stubEnv('APP_ORIGIN', '')
  vi.stubEnv('APP_ALLOWED_ORIGINS', 'https://vanity-production-2bbb.up.railway.app')
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

function provider(log: Array<{ url: string; init: RequestInit }> = []) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input); log.push({ url, init })
    if (url === 'https://api.x.com/2/oauth2/token') return Response.json(tokenPayload())
    if (url === 'https://api.x.com/2/users/me?user.fields=profile_image_url%2Cprotected') return Response.json({ data: identity })
    if (url === 'https://api.x.com/2/oauth2/revoke') return Response.json({ revoked: true })
    throw new Error('Unexpected upstream URL')
  }) as typeof fetch
}

describe('server X connection', () => {
  it('reports missing setup honestly without making upstream calls', async () => {
    vi.stubEnv('X_CLIENT_SECRET', '')
    const fetcher = provider(), service = createXAuthService({ fetcher, now: () => now })
    expect(await (await service.session(request('session'))).json()).toEqual({ available: false, connected: false })
    expect((await service.connect(post('connect'))).status).toBe(503)
    await expect(service.withAccessToken(request('posts'), async () => null)).rejects.toMatchObject({ status: 503, code: 'setup_required' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses S256, private cookie state, and only the configured canonical origin', async () => {
    const service = createXAuthService({ fetcher: provider(), now: () => now })
    const alias = new Request('https://vanity-production-2bbb.up.railway.app/api/x/connect', { method: 'POST', headers: { Origin: 'https://vanity-production-2bbb.up.railway.app', 'Content-Type': 'application/json', 'x-forwarded-host': 'evil.example' }, body: '{}' })
    const redirect = await service.connect(alias)
    expect(await redirect.json()).toEqual({ continueUrl: `${origin}/x` })
    expect(redirect.headers.get('set-cookie')).toBeNull()
    const { response, url } = await authorize(service)
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/api/x/callback`)
    expect(url.searchParams.get('scope')).toBe('tweet.read users.read offline.access')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(response.headers.get('set-cookie')).toMatch(/__Host-outsol-x-pending=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax/)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(JSON.stringify(await (await service.session(request('session'))).json())).not.toContain('test-client-secret')
  })

  it('accepts a legitimate cross-site callback, rotates the session, and keeps tokens server-only', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const service = createXAuthService({ fetcher: provider(calls), now: () => now })
    const auth = await authorize(service)
    const callback = new Request(`${origin}/api/x/callback?state=${auth.url.searchParams.get('state')}&code=test-code`, { headers: { Cookie: auth.cookie, 'Sec-Fetch-Site': 'cross-site' } })
    const response = await service.callback(callback)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=connected`)
    const cookie = cookies(response)
    expect(cookie).toContain('__Host-outsol-x=')
    expect(cookie).not.toContain(auth.cookie)
    const exchange = new URLSearchParams(String(calls[0].init.body))
    expect(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url')).toBe(auth.url.searchParams.get('code_challenge'))
    expect(new Headers(calls[0].init.headers).get('authorization')).toMatch(/^Basic /)
    const status = await service.session(request('session', cookie)), data = await status.json()
    expect(data).toMatchObject({ available: true, connected: true, user: { id: identity.id, username: identity.username, protected: true } })
    expect(JSON.stringify(data)).not.toMatch(/test-access|test-refresh|test-client-secret|code_verifier/)
    expect(calls).toHaveLength(2)
    expect(calls.every(call => call.init.redirect === 'error' && call.init.cache === 'no-store' && !!call.init.signal)).toBe(true)
    await expect(service.withAccessToken(request('posts', cookie), async (token, user) => `${token}:${user.id}`)).resolves.toBe('test-access:123456')
    expect(calls).toHaveLength(2)
  })

  it('rejects missing cookie, mismatched state, and expired state before exchange', async () => {
    const fetcher = provider(), service = createXAuthService({ fetcher, now: () => now })
    const first = await authorize(service)
    const callbackPath = `callback?state=${first.url.searchParams.get('state')}&code=test-code`
    expect((await service.callback(request(callbackPath))).headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await service.callback(request('callback?state=wrong&code=test-code', first.cookie))).headers.get('location')).toBe(`${origin}/x?connection=error`)
    const second = await authorize(service)
    now += 10 * 60_000 + 1
    expect((await service.callback(request(`callback?state=${second.url.searchParams.get('state')}&code=test-code`, second.cookie))).headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('consumes a successful callback exactly once and rejects duplicate query fields', async () => {
    const fetcher = provider(), service = createXAuthService({ fetcher, now: () => now })
    const { auth, cookie } = await connected(service)
    const callbackPath = `callback?state=${auth.url.searchParams.get('state')}&code=test-code`
    expect((await service.callback(request(callbackPath, auth.cookie))).headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await (await service.session(request('session', cookie))).json()).connected).toBe(false)
    const next = await authorize(service)
    expect((await service.callback(request(`callback?state=${next.url.searchParams.get('state')}&code=one&code=two`, next.cookie))).headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect(fetcher).toHaveBeenCalledTimes(4) // Original token/profile requests plus revocation of both credentials.
  })

  it('sanitizes provider errors and handles cancellation without token exchange', async () => {
    const fetcher = vi.fn(async () => { throw new Error('leaked test-client-secret') }) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), auth = await authorize(service)
    const cancelled = await service.callback(request(`callback?state=${auth.url.searchParams.get('state')}&error=access_denied`, auth.cookie))
    expect(cancelled.headers.get('location')).toBe(`${origin}/x?connection=cancelled`)
    expect(fetcher).not.toHaveBeenCalled()
    const retry = await authorize(service)
    const error = await service.callback(request(`callback?state=${retry.url.searchParams.get('state')}&code=private-code`, retry.cookie))
    expect(error.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect(await error.text()).not.toMatch(/private-code|test-client-secret/)
  })

  it('shares one refresh between concurrent requests and persists the rotated pair', async () => {
    let refreshes = 0
    const initial = provider()
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (new URLSearchParams(String(init?.body || '')).get('grant_type') === 'refresh_token') {
        refreshes++; await new Promise(resolve => setTimeout(resolve, 15)); return Response.json(tokenPayload('rotated-access', 'rotated-refresh'))
      }
      return initial(input, init)
    }) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), { cookie } = await connected(service)
    now += 7200_000
    const results = await Promise.all(Array.from({ length: 4 }, () => service.withAccessToken(request('posts', cookie), async token => token)))
    expect(results).toEqual(Array(4).fill('rotated-access'))
    expect(refreshes).toBe(1)
    const restarted = createXAuthService({ fetcher, now: () => now })
    await expect(restarted.withAccessToken(request('posts', cookie), async token => token)).resolves.toBe('rotated-access')
    expect(refreshes).toBe(1)
  })

  it('drops local credentials on disconnect and reports failed provider revocation accurately', async () => {
    const initial = provider()
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => String(input).endsWith('/revoke') ? new Response('private upstream detail', { status: 503 }) : initial(input, init)) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), { cookie } = await connected(service)
    const response = await service.disconnect(post('disconnect', cookie))
    expect(await response.json()).toEqual({ disconnected: true, providerRevoked: false })
    expect((await (await service.session(request('session', cookie))).json()).connected).toBe(false)
    await expect(service.withAccessToken(request('posts', cookie), async () => null)).rejects.toMatchObject({ status: 401, code: 'not_connected' })
    expect((await readdir(join(root, 'private'))).filter(file => !file.startsWith('flow-'))).toHaveLength(0)
  })

  it('rejects foreign mutation origins, malformed keys, public storage reuse, and unbounded setup', async () => {
    const service = createXAuthService({ fetcher: provider(), now: () => now })
    const foreign = new Request(`${origin}/api/x/connect`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })
    expect((await service.connect(foreign)).status).toBe(403)
    vi.stubEnv('X_TOKEN_ENCRYPTION_KEY', 'not-a-key')
    expect((await service.connect(post('connect'))).status).toBe(503)
    vi.stubEnv('X_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
    vi.stubEnv('X_STORAGE_DIR', join(root, 'public'))
    expect((await service.connect(post('connect'))).status).toBe(503)
  })

  // This exercises repeated real durable writes; allow full-suite Windows disk contention.
  it('restores pending authorization after restart and bounds anonymous connection requests', async () => {
    const fetcher = provider(), first = createXAuthService({ fetcher, now: () => now }), auth = await authorize(first)
    const restarted = createXAuthService({ fetcher, now: () => now })
    const response = await restarted.callback(request(`callback?state=${auth.url.searchParams.get('state')}&code=test-code`, auth.cookie))
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=connected`)
    for (let index = 0; index < 6; index++) expect((await restarted.connect(post('connect'))).status).toBe(200)
    expect((await restarted.connect(post('connect'))).status).toBe(429)
    expect(fetcher).toHaveBeenCalledTimes(2)
  }, 15_000)

  it('removes an expired grant after refresh rejection instead of retrying its rotated credential', async () => {
    const initial = provider()
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => new URLSearchParams(String(init?.body || '')).get('grant_type') === 'refresh_token' ? new Response('private-token diagnostic', { status: 400 }) : initial(input, init)) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), { cookie } = await connected(service)
    now += 7200_000
    await expect(service.withAccessToken(request('posts', cookie), async () => null)).rejects.toMatchObject({ status: 401, code: 'connection_expired' })
    await expect(service.withAccessToken(request('posts', cookie), async () => null)).rejects.toMatchObject({ status: 401, code: 'not_connected' })
    expect((await readdir(join(root, 'private'))).filter(file => !file.startsWith('flow-'))).toHaveLength(0)
  })

  it.each(['redirect', 'oversized', 'write-scope'])('fails closed for an unsafe %s provider response', async mode => {
    const fetcher = vi.fn(async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }) : mode === 'oversized' ? new Response('x'.repeat(65_537)) : Response.json({ ...tokenPayload(), scope: 'tweet.read users.read offline.access tweet.write' })) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), auth = await authorize(service)
    const response = await service.callback(request(`callback?state=${auth.url.searchParams.get('state')}&code=test-code`, auth.cookie))
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await readdir(join(root, 'private'))).filter(file => !file.startsWith('flow-'))).toHaveLength(0)
    expect(await response.text()).toBe('')
  })

  it('expires the browser connection absolutely without refreshing or fetching profiles', async () => {
    const fetcher = provider(), service = createXAuthService({ fetcher, now: () => now }), { cookie } = await connected(service)
    now += 7 * 24 * 60 * 60_000 + 1
    expect(await (await service.session(request('session', cookie))).json()).toEqual({ available: true, connected: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports successful provider revocation only after revoking both stored credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const service = createXAuthService({ fetcher: provider(calls), now: () => now }), { cookie } = await connected(service)
    expect(await (await service.disconnect(post('disconnect', cookie))).json()).toEqual({ disconnected: true, providerRevoked: true })
    const revocations = calls.filter(call => call.url.endsWith('/revoke'))
    expect(revocations.map(call => new URLSearchParams(String(call.init.body)).get('token')).sort()).toEqual(['test-access', 'test-refresh'])
  })

  it.each(['exchange', 'profile'])('keeps a disconnect final while the callback is awaiting its %s', async phase => {
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
    const calls: Array<{ url: string; init: RequestInit }> = [], initial = provider(calls)
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (phase === 'exchange' && String(input).endsWith('/token') || phase === 'profile' && String(input).includes('/users/me?')) { entered(); await gate }
      return initial(input, init)
    }) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), auth = await authorize(service)
    const callback = service.callback(request(`callback?state=${auth.url.searchParams.get('state')}&code=test-code`, auth.cookie))
    await reached
    const otherRouteInstance = createXAuthService({ fetcher: provider(calls), now: () => now })
    const disconnected = await otherRouteInstance.disconnect(post('disconnect', auth.cookie))
    expect(disconnected.status).toBe(200)
    release()
    const response = await callback
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await (await service.session(request('session', cookies(response)))).json()).connected).toBe(false)
    expect((await readdir(join(root, 'private'))).filter(file => file.startsWith('session-'))).toHaveLength(0)
    expect(calls.filter(call => call.url.endsWith('/revoke')).map(call => new URLSearchParams(String(call.init.body)).get('token')).sort()).toEqual(['test-access', 'test-refresh'])
  })

  it('disconnects a committed callback using the old pending cookie before the new response cookie lands', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [], service = createXAuthService({ fetcher: provider(calls), now: () => now })
    const old = await connected(service)
    const auth = await authorize(service)
    const oldCookies = `${old.cookie}; ${auth.cookie}`
    const response = await service.callback(request(`callback?state=${auth.url.searchParams.get('state')}&code=test-code`, oldCookies))
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=connected`)
    // A second tab still has the request's old pending cookie until the callback response arrives.
    const restarted = createXAuthService({ fetcher: provider(calls), now: () => now })
    expect(await (await restarted.disconnect(post('disconnect', oldCookies))).json()).toEqual({ disconnected: true, providerRevoked: true })
    expect((await (await restarted.session(request('session', cookies(response)))).json()).connected).toBe(false)
    expect((await readdir(join(root, 'private'))).filter(file => file.startsWith('session-'))).toHaveLength(0)
    expect(calls.filter(call => call.url.endsWith('/revoke'))).toHaveLength(2)
  })

  it('invalidates an unexpired stored credential when its operation receives a revoked-grant 401', async () => {
    const service = createXAuthService({ fetcher: provider(), now: () => now }), { cookie } = await connected(service)
    const rejected = Object.assign(new Error('Connect again.'), { status: 401, code: 'not_connected' })
    await expect(service.withAccessToken(request('posts', cookie), async () => { throw rejected })).rejects.toBe(rejected)
    expect((await (await service.session(request('session', cookie))).json()).connected).toBe(false)
  })

  it('preserves a newer refreshed credential when an older in-flight operation later receives 401', async () => {
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
    const initial = provider()
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => new URLSearchParams(String(init?.body || '')).get('grant_type') === 'refresh_token' ? Response.json(tokenPayload('new-access', 'new-refresh')) : initial(input, init)) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), { cookie } = await connected(service)
    const rejected = Object.assign(new Error('Connect again.'), { status: 401, code: 'not_connected' })
    const older = service.withAccessToken(request('posts', cookie), async token => { expect(token).toBe('test-access'); entered(); await gate; throw rejected })
    const checked = expect(older).rejects.toBe(rejected)
    await reached
    now += 7200_000
    await expect(service.withAccessToken(request('posts', cookie), async token => token)).resolves.toBe('new-access')
    release(); await checked
    expect((await (await service.session(request('session', cookie))).json()).connected).toBe(true)
    await expect(service.withAccessToken(request('posts', cookie), async token => token)).resolves.toBe('new-access')
  })

  it.each([403, 429, 503])('preserves a connection after an operation returns HTTP %s', async status => {
    const service = createXAuthService({ fetcher: provider(), now: () => now }), { cookie } = await connected(service)
    const rejected = Object.assign(new Error('Try later.'), { status, code: 'unavailable' })
    await expect(service.withAccessToken(request('posts', cookie), async () => { throw rejected })).rejects.toBe(rejected)
    expect((await (await service.session(request('session', cookie))).json()).connected).toBe(true)
  })

  it('cancels an older exchanging flow when a new connect replaces its pending cookie', async () => {
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
    const calls: Array<{ url: string; init: RequestInit }> = [], initial = provider(calls)
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/users/me?')) { entered(); await gate }
      return initial(input, init)
    }) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), first = await authorize(service)
    const callback = service.callback(request(`callback?state=${first.url.searchParams.get('state')}&code=test-code`, first.cookie))
    await reached
    const replacement = await service.connect(post('connect', first.cookie))
    expect(replacement.status).toBe(200)
    expect((await service.disconnect(post('disconnect', cookies(replacement)))).status).toBe(200)
    release()
    const response = await callback
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await readdir(join(root, 'private'))).filter(file => file.startsWith('session-'))).toHaveLength(0)
    expect(calls.filter(call => call.url.endsWith('/revoke'))).toHaveLength(2)
  })

  it('cancels the matching in-flight flow before a duplicate callback error can lose its cookie', async () => {
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
    const calls: Array<{ url: string; init: RequestInit }> = [], initial = provider(calls)
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/users/me?')) { entered(); await gate }
      return initial(input, init)
    }) as typeof fetch
    const service = createXAuthService({ fetcher, now: () => now }), auth = await authorize(service)
    const callbackPath = `callback?state=${auth.url.searchParams.get('state')}&code=test-code`
    const callback = service.callback(request(callbackPath, auth.cookie))
    await reached
    const duplicate = await service.callback(request(callbackPath, auth.cookie))
    expect(duplicate.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await service.disconnect(post('disconnect'))).status).toBe(200)
    release()
    const response = await callback
    expect(response.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect((await readdir(join(root, 'private'))).filter(file => file.startsWith('session-'))).toHaveLength(0)
    expect(calls.filter(call => call.url.endsWith('/revoke'))).toHaveLength(2)
  })

  it('cancels a completed old flow on replacement before its new session cookie arrives', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [], service = createXAuthService({ fetcher: provider(calls), now: () => now })
    const auth = await authorize(service)
    const response = await service.callback(request(`callback?state=${auth.url.searchParams.get('state')}&code=test-code`, auth.cookie))
    expect((await service.connect(post('connect', auth.cookie))).status).toBe(200)
    expect((await (await service.session(request('session', cookies(response)))).json()).connected).toBe(false)
    expect(calls.filter(call => call.url.endsWith('/revoke'))).toHaveLength(2)
  })

  it('keeps a newer flow intact when an older callback arrives with the newer browser cookie', async () => {
    const service = createXAuthService({ fetcher: provider(), now: () => now }), first = await authorize(service)
    const replacement = await service.connect(post('connect', first.cookie)), secondCookie = cookies(replacement)
    const secondUrl = new URL((await replacement.json()).authorizeUrl)
    const older = await service.callback(request(`callback?state=${first.url.searchParams.get('state')}&code=old-code`, secondCookie))
    expect(older.headers.get('location')).toBe(`${origin}/x?connection=error`)
    expect(older.headers.get('set-cookie')).toBeNull()
    const newer = await service.callback(request(`callback?state=${secondUrl.searchParams.get('state')}&code=new-code`, secondCookie))
    expect(newer.headers.get('location')).toBe(`${origin}/x?connection=connected`)
  })

  it('does not create flow tombstones for unknown browser handles', async () => {
    const service = createXAuthService({ fetcher: provider(), now: () => now })
    expect((await service.disconnect(post('disconnect', `__Host-outsol-x-pending=${'z'.repeat(43)}`))).status).toBe(200)
    expect(await readdir(join(root, 'private'))).toHaveLength(0)
  })
})
