import { createHmac, scryptSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createAccessHandlers, createAccessSession, hasAppAccess, isPublicAccessPath, requireAppAccess, withAppAccess } from '../src/lib/server/appAccess'
import { proxy } from '../proxy'

const password = 'disposable-access-test-password'
const salt = Buffer.alloc(16, 7)
const hash = `scrypt$32768$8$1$${salt.toString('base64url')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`
const secret = Buffer.alloc(32, 8).toString('base64url')
function configure() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('APP_ACCESS_PASSWORD_HASH', hash)
  vi.stubEnv('APP_ACCESS_SESSION_SECRET', secret)
  vi.stubEnv('APP_ORIGIN', 'https://outsol.online')
  vi.stubEnv('APP_ALLOWED_ORIGINS', 'https://vanity.example')
}
function form(value = password, headers: Record<string, string> = {}) {
  return new Request('https://outsol.online/access', { method: 'POST', headers: { origin: 'https://outsol.online', 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ password: value }) })
}
function sessionRequest(token = createAccessSession()) {
  return new Request('https://outsol.online/launch', { headers: { cookie: `__Host-outsol-access=${token}` } })
}
beforeEach(configure)
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('private app sessions', () => {
  it('only grants a signed unexpired session and invalidates password or signing-key rotation', () => {
    const request = sessionRequest()
    expect(hasAppAccess(request)).toBe(true)
    expect(requireAppAccess(request)).toBeNull()
    const altered = request.headers.get('cookie')!.replace(/.$/, last => last === 'A' ? 'B' : 'A')
    expect(hasAppAccess(new Request(request.url, { headers: { cookie: altered } }))).toBe(false)
    vi.stubEnv('APP_ACCESS_PASSWORD_HASH', hash.replace(salt.toString('base64url'), Buffer.alloc(16, 9).toString('base64url')))
    expect(hasAppAccess(request)).toBe(false)
    vi.stubEnv('APP_ACCESS_PASSWORD_HASH', hash)
    vi.stubEnv('APP_ACCESS_SESSION_SECRET', Buffer.alloc(32, 6).toString('base64url'))
    expect(hasAppAccess(request)).toBe(false)
  })
  it('rejects duplicate cookies, malformed tokens and sessions outside their fixed lifetime', () => {
    const now = 1_800_000_000_000
    vi.useFakeTimers(); vi.setSystemTime(now)
    const request = sessionRequest()
    const cookie = request.headers.get('cookie')!
    expect(hasAppAccess(new Request(request.url, { headers: { cookie: `${cookie}; ${cookie}` } }))).toBe(false)
    expect(hasAppAccess(sessionRequest('v1.1.2.bad.bad'))).toBe(false)
    vi.setSystemTime(now + 8 * 60 * 60 * 1000)
    expect(hasAppAccess(request)).toBe(false)
    vi.setSystemTime(now - 60_000)
    expect(hasAppAccess(request)).toBe(false)
    vi.setSystemTime(now)
    const forgedLifetime = `v1.${Math.floor(now / 1000)}.${Math.floor(now / 1000) + 86400}.${Buffer.alloc(16).toString('base64url')}`
    const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(`${hash}\0${forgedLifetime}`).digest('base64url')
    expect(hasAppAccess(sessionRequest(`${forgedLifetime}.${signature}`))).toBe(false)
  })
  it('fails closed on absent, partial or malformed production configuration', () => {
    for (const [passwordHash, sessionSecret] of [['', ''], [hash, ''], ['', secret], ['invalid', secret], [hash, 'short']]) {
      vi.stubEnv('APP_ACCESS_PASSWORD_HASH', passwordHash); vi.stubEnv('APP_ACCESS_SESSION_SECRET', sessionSecret)
      expect(requireAppAccess(new Request('https://outsol.online/api/rpc'))?.status).toBe(503)
    }
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('APP_ACCESS_PASSWORD_HASH', ''); vi.stubEnv('APP_ACCESS_SESSION_SECRET', '')
    expect(requireAppAccess(new Request('http://localhost:3000/api/rpc'))).toBeNull()
    vi.stubEnv('APP_ACCESS_SESSION_SECRET', secret)
    expect(requireAppAccess(new Request('http://localhost:3000/api/rpc'))?.status).toBe(503)
  })
  it('keeps immutable redirects usable while preventing private responses from being cached', async () => {
    const handler = withAppAccess(() => Response.redirect('https://outsol.online/x', 303))
    const response = await handler(sessionRequest())
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://outsol.online/x')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})

describe('password entry and logout', () => {
  it('sets a secure session after password verification, with no password in response', async () => {
    const handlers = createAccessHandlers()
    const wrong = await handlers.POST(form('incorrect-test-password'))
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('set-cookie')).toBeNull()
    const result = await handlers.POST(form())
    expect(result.status).toBe(303)
    expect(result.headers.get('location')).toBe('/launch')
    const cookie = result.headers.get('set-cookie')!
    expect(cookie).toMatch(/^__Host-outsol-access=/)
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=28800']) expect(cookie).toContain(attribute)
    expect(cookie).not.toContain('Domain=')
    expect(hasAppAccess(new Request('https://outsol.online/launch', { headers: { cookie: cookie.split(';')[0] } }))).toBe(true)
    expect(result.headers.get('cache-control')).toContain('no-store')
    expect(await result.text()).not.toContain(password)
  })
  it('rejects missing, foreign or insecure origins and accepts a configured alias', async () => {
    const handlers = createAccessHandlers()
    const missing = form(); missing.headers.delete('origin')
    for (const request of [missing, form(password, { origin: 'https://attacker.example' }), form(password, { origin: 'http://outsol.online' }), form(password, { 'sec-fetch-site': 'cross-site' })]) expect((await handlers.POST(request)).status).toBe(403)
    const http = new Request('http://outsol.online/access', { method: 'POST', headers: { origin: 'https://outsol.online', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) })
    expect((await handlers.POST(http)).status).toBe(403)
    expect((await handlers.POST(form(password, { origin: 'https://vanity.example' }))).status).toBe(303)
    vi.stubEnv('APP_ORIGIN', ''); vi.stubEnv('PUBLIC_APP_URL', ''); vi.stubEnv('APP_ALLOWED_ORIGINS', '')
    expect((await handlers.POST(form())).status).toBe(403)
  })
  it('accepts forwarded HTTPS behind Railway only with a configured browser origin', async () => {
    vi.stubEnv('APP_ORIGIN', '')
    vi.stubEnv('PUBLIC_APP_URL', 'https://vanity-production-2bbb.up.railway.app')
    vi.stubEnv('APP_ALLOWED_ORIGINS', 'https://outsol.online')
    const handlers = createAccessHandlers()
    const request = (host: string, forwardedProto = 'https', origin = `https://${host}`) => new Request('http://127.0.0.1:3098/access', {
      method: 'POST', headers: { host, 'x-forwarded-proto': forwardedProto, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }),
    })
    for (const host of ['outsol.online', 'vanity-production-2bbb.up.railway.app']) expect((await handlers.POST(request(host))).status).toBe(303)
    expect((await handlers.POST(request('outsol.online', 'http'))).status).toBe(403)
    expect((await handlers.POST(request('outsol.online', 'https,http'))).status).toBe(403)
    expect((await handlers.POST(request('outsol.online', 'https', 'https://attacker.example'))).status).toBe(403)
  })
  it('rejects oversized, duplicate or unsupported form bodies before verification', async () => {
    const handlers = createAccessHandlers()
    expect((await handlers.POST(form('x'.repeat(5000)))).status).toBe(413)
    expect((await handlers.POST(form(password, { 'content-type': 'application/json' }))).status).toBe(415)
    const duplicate = new Request('https://outsol.online/access', { method: 'POST', headers: { origin: 'https://outsol.online', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=a&password=b' })
    expect((await handlers.POST(duplicate)).status).toBe(400)
  })
  it('throttles repeated attempts before doing more password work', async () => {
    const handlers = createAccessHandlers()
    for (let i = 0; i < 10; i++) expect((await handlers.POST(form('incorrect-password'))).status).toBe(401)
    const limited = await handlers.POST(form())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })
  it('caps concurrent sign-in work even when requests delay sending their body', async () => {
    const handlers = createAccessHandlers()
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const pending = [1, 2].map(() => {
      const body = new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller) } })
      return handlers.POST(new Request('https://outsol.online/access', { method: 'POST', headers: { origin: 'https://outsol.online', 'content-type': 'application/x-www-form-urlencoded' }, body, duplex: 'half' } as RequestInit))
    })
    const third = await handlers.POST(form())
    for (const controller of controllers) { controller.enqueue(new TextEncoder().encode('password=incorrect-password')); controller.close() }
    await Promise.all(pending)
    expect(third.status).toBe(429)
  })
  it('offers an accessible password form, and logout requires a trusted origin', async () => {
    const handlers = createAccessHandlers()
    const login = await handlers.GET(new Request('https://outsol.online/access'))
    const html = await login.text()
    expect(html).toContain('autocomplete="current-password"')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('<script')
    const denied = await handlers.logout(new Request('https://outsol.online/api/access/logout', { method: 'POST' }))
    expect(denied.status).toBe(403)
    const logout = await handlers.logout(new Request('https://outsol.online/api/access/logout', { method: 'POST', headers: { origin: 'https://outsol.online', cookie: sessionRequest().headers.get('cookie')! } }))
    expect(logout.status).toBe(303)
    expect(logout.headers.get('location')).toBe('/access')
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('page and public-resource boundary', () => {
  it('redirects internal standalone URLs to an allowlisted public host without trusting hostile hosts', () => {
    vi.stubEnv('APP_ORIGIN', '')
    vi.stubEnv('PUBLIC_APP_URL', 'https://vanity-production-2bbb.up.railway.app')
    vi.stubEnv('APP_ALLOWED_ORIGINS', 'https://outsol.online')
    const destination = (headers: Record<string, string>) => proxy(new NextRequest('http://127.0.0.1:3098/launch?code=private-code', { headers })).headers.get('location')
    expect(destination({ host: 'outsol.online', 'x-forwarded-proto': 'https' })).toBe('https://outsol.online/access')
    expect(destination({ host: 'vanity-production-2bbb.up.railway.app' })).toBe('https://vanity-production-2bbb.up.railway.app/access')
    expect(destination({ host: '127.0.0.1:3098', 'x-forwarded-host': 'outsol.online' })).toBe('https://outsol.online/access')
    expect(destination({ host: 'attacker.example', 'x-forwarded-host': 'attacker.example' })).toBe('https://vanity-production-2bbb.up.railway.app/access')
    expect(destination({ host: 'outsol.online.attacker.example' })).toBe('https://vanity-production-2bbb.up.railway.app/access')
    expect(destination({ host: 'attacker.example@outsol.online' })).toBe('https://vanity-production-2bbb.up.railway.app/access')
    vi.stubEnv('PUBLIC_APP_URL', ''); vi.stubEnv('APP_ALLOWED_ORIGINS', '')
    const unavailable = proxy(new NextRequest('http://127.0.0.1:3098/launch'))
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('location')).toBeNull()
  })
  it('redirects private pages without preserving query secrets and blocks APIs with no cache', () => {
    const page = proxy(new NextRequest('https://outsol.online/launch?code=secret-code'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('https://outsol.online/access')
    expect(page.headers.get('location')).not.toContain('secret-code')
    const api = proxy(new NextRequest('https://outsol.online/api/rpc', { method: 'POST' }))
    expect(api.status).toBe(401)
    expect(api.headers.get('cache-control')).toContain('no-store')
    const authenticated = proxy(new NextRequest(sessionRequest()))
    expect(authenticated.headers.get('x-middleware-next')).toBe('1')
    expect(authenticated.headers.get('cache-control')).toContain('no-store')
  })
  it('allows only exact public resources and read methods', () => {
    const asset = `/api/assets/${'a'.repeat(64)}.json`
    for (const path of ['/api/health', asset, '/_next/static/chunks/example.js', '/favicon.svg']) {
      expect(isPublicAccessPath(path, 'GET')).toBe(true)
      expect(isPublicAccessPath(path, 'HEAD')).toBe(true)
      expect(isPublicAccessPath(path, 'POST')).toBe(false)
    }
    for (const path of ['/api/health-other', `${asset}/extra`, '/api/assets/x.json', '/api/assets/' + 'A'.repeat(64) + '.json', '/api/assets/../rpc', '/_next/data/build/launch.json', '/_next/image', '/launch.js', '/access-other', '/_next/static-other/x.js']) {
      expect(isPublicAccessPath(path, 'GET')).toBe(false)
      const result = proxy(new NextRequest(`https://outsol.online${path}`, { headers: { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy', rsc: '1' } }))
      expect([307, 401]).toContain(result.status)
    }
  })
})
