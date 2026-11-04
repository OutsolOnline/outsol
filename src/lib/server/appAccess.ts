import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { configuredRequestOrigins } from './requestOrigin'

const SESSION_SECONDS = 8 * 60 * 60
const NO_STORE = 'private, no-store, max-age=0'
const HASH_PATTERN = /^scrypt\$32768\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/
type AccessConfig = { mode: 'disabled' } | { mode: 'blocked' } | { mode: 'enabled'; hash: string; salt: Buffer; digest: Buffer; key: Buffer }

function decodeCanonical(value: string, length: number): Buffer | null {
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === length && bytes.toString('base64url') === value ? bytes : null
}

function configuration(): AccessConfig {
  const mode = process.env.APP_ACCESS_MODE || ''
  if (mode === 'public') return { mode: 'disabled' }
  if (mode && mode !== 'private') return { mode: 'blocked' }
  const hash = process.env.APP_ACCESS_PASSWORD_HASH || ''
  const secret = process.env.APP_ACCESS_SESSION_SECRET || ''
  if (!hash && !secret && process.env.NODE_ENV !== 'production') return { mode: 'disabled' }
  const parts = HASH_PATTERN.exec(hash)
  const key = /^[A-Za-z0-9_-]{43}$/.test(secret) ? decodeCanonical(secret, 32) : null
  const salt = parts && decodeCanonical(parts[1], 16)
  const digest = parts && decodeCanonical(parts[2], 32)
  return key && salt && digest ? { mode: 'enabled', hash, salt, digest, key } : { mode: 'blocked' }
}

function cookieName(): string { return process.env.NODE_ENV === 'production' ? '__Host-outsol-access' : 'outsol-access' }
function signature(payload: string, config: Extract<AccessConfig, { mode: 'enabled' }>): Buffer {
  return createHmac('sha256', config.key).update(`${config.hash}\0${payload}`).digest()
}

export function createAccessSession(): string {
  const config = configuration()
  if (config.mode !== 'enabled') throw new Error('Private access is not configured')
  const issued = Math.floor(Date.now() / 1000)
  const payload = `v1.${issued}.${issued + SESSION_SECONDS}.${randomBytes(16).toString('base64url')}`
  return `${payload}.${signature(payload, config).toString('base64url')}`
}

export function hasAppAccess(request: Request): boolean {
  const config = configuration()
  if (config.mode !== 'enabled') return config.mode === 'disabled'
  const header = request.headers.get('cookie') || ''
  if (header.length > 8192) return false
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName()}=`))
  if (values.length !== 1) return false
  const token = values[0].slice(cookieName().length + 1)
  const parts = /^(v1\.(\d{10})\.(\d{10})\.([A-Za-z0-9_-]{22}))\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!parts || !decodeCanonical(parts[4], 16)) return false
  const issued = Number(parts[2]), expires = Number(parts[3]), now = Math.floor(Date.now() / 1000)
  if (expires - issued !== SESSION_SECONDS || issued > now || expires <= now) return false
  const supplied = decodeCanonical(parts[5], 32)
  return supplied !== null && timingSafeEqual(supplied, signature(parts[1], config))
}

export function requireAppAccess(request: Request): Response | null {
  const config = configuration()
  if (config.mode === 'disabled' || (config.mode === 'enabled' && hasAppAccess(request))) return null
  return Response.json({ error: config.mode === 'blocked' ? 'Private access is unavailable.' : 'Sign in to use this tool.' }, { status: config.mode === 'blocked' ? 503 : 401, headers: { 'Cache-Control': NO_STORE } })
}

/** Route handlers enforce the same boundary even if a request does not pass through Proxy. */
export function withAppAccess<TRequest extends Request, TArgs extends unknown[]>(handler: (request: TRequest, ...args: TArgs) => Response | Promise<Response>) {
  return async (request: TRequest, ...args: TArgs): Promise<Response> => {
    const denied = requireAppAccess(request)
    if (denied) return denied
    const result = await handler(request, ...args)
    const headers = new Headers(result.headers)
    headers.set('Cache-Control', NO_STORE)
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers })
  }
}

export function isPublicAccessPath(path: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  return path === '/api/health' || /^\/api\/assets\/[a-f0-9]{64}\.(json|png|jpg|webp|gif)$/.test(path)
    || /^\/_next\/static\/[A-Za-z0-9_./%~@()+-]+$/.test(path) && !path.includes('..') && !path.includes('%')
    || ['/favicon.svg', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/icon.svg'].includes(path)
}

function validAccessOrigin(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) throw new Error('Invalid origin')
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid origin')
  return url.origin
}

function accessOrigins(request: Request): string[] {
  return configuredRequestOrigins(request)
}

/** Standalone servers see an internal URL; hosts may select, but never extend, this allowlist. */
export function resolveAccessOrigin(request: Request): string | null {
  try {
    const allowed = accessOrigins(request)
    const direct = new URL(request.url).origin
    if (allowed.includes(direct)) return direct
    for (const name of ['host', 'x-forwarded-host']) {
      const host = request.headers.get(name)
      if (!host || host.length > 256 || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) continue
      try {
        const candidate = new URL(`https://${host}`).origin
        if (allowed.includes(candidate)) return candidate
      } catch { /* Invalid hosts never become redirect destinations. */ }
    }
    return allowed[0] || null
  } catch { return null }
}

function trustedPost(request: Request): boolean {
  if (request.method !== 'POST' || request.headers.get('sec-fetch-site') === 'cross-site') return false
  try {
    const production = process.env.NODE_ENV === 'production'
    // Railway terminates HTTPS before forwarding to the standalone HTTP server.
    // This transport signal never replaces the explicit browser-origin allowlist.
    if (production && new URL(request.url).protocol !== 'https:' && request.headers.get('x-forwarded-proto') !== 'https') return false
    const origin = request.headers.get('origin')
    if (!origin) return false
    return accessOrigins(request).includes(validAccessOrigin(origin))
  } catch { return false }
}

function sessionCookie(token: string, maxAge: number): string {
  return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

function redirect(location: '/' | '/launch' | '/access', cookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': NO_STORE })
  if (cookie) headers.set('Set-Cookie', cookie)
  return new Response(null, { status: 303, headers })
}

function accessPage(message = '', status = 200, signedIn = false): Response {
  const form = signedIn
    ? '<a class="button" href="/launch">Continue to tools <span aria-hidden="true">→</span></a><form action="/api/access/logout" method="post"><button class="secondary" type="submit">Sign out</button></form>'
    : '<form action="/access" method="post"><label for="password">Access password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus placeholder="Enter your password"><button type="submit">Unlock workspace <span aria-hidden="true">→</span></button></form>'
  const content = status === 503 ? '<p class="notice" role="status">Private access is being configured. Please try again shortly.</p>' : `${message ? `<p class="notice" role="alert">${message}</p>` : ''}${form}`
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>LaunchPier</title><style>:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#EDF2FF;background:#0E1322}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:28px;background:radial-gradient(ellipse at 50% 0%,#1B2C57 0,transparent 58%),#0E1322}main{width:100%;max-width:430px}.brand{font-size:26px;font-weight:650;letter-spacing:-1px;display:flex;align-items:center;gap:11px;margin-bottom:54px}.mark{height:34px;width:34px;color:#9fb6ff;display:inline-block;flex:none}.tag{color:#9FB6FF;text-transform:uppercase;font-size:11px;letter-spacing:2px;font-weight:700}h1{font-size:36px;letter-spacing:-1.2px;line-height:1.1;margin:15px 0}p{color:#B1BED3;line-height:1.6;font-size:15px}form{margin-top:30px}label{display:block;font-size:13px;margin-bottom:10px;color:#D6E1FA}input{width:100%;background:#151D30;border:1px solid #34415F;color:#fff;border-radius:11px;padding:15px 16px;font:inherit;min-width:0}input:focus-visible{outline:2px solid #9FB6FF;outline-offset:3px}button,.button{display:flex;align-items:center;justify-content:space-between;width:100%;padding:15px 18px;border:0;border-radius:11px;margin-top:15px;background:#9FB6FF;color:#10182B;font:600 14px system-ui;text-decoration:none;cursor:pointer}button:hover,.button:hover{background:#BDD0FF}.secondary{background:#202B43;color:#CAD5EB;justify-content:center}.notice{padding:13px 15px;background:#24251a;border:1px solid #57543a;border-radius:10px;color:#e2d9b9;font-size:14px;margin-top:24px}.foot{font-size:12px;color:#9BAAC4;margin-top:30px;border-top:1px solid #2D3B56;padding-top:20px}@media(max-width:480px){body{padding:24px}.brand{margin-bottom:42px}h1{font-size:32px}}</style></head><body><main><div class="brand"><svg class="mark" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M15 16H31V68H84V84H15Z"/><path d="M44 16H84V56H68V43L49 62L38 51L57 32H44Z"/></svg>LaunchPier</div><span class="tag">Private workspace</span><h1>${signedIn ? 'You’re signed in.' : 'Your tools. Your access.'}</h1><p>${signedIn ? 'Continue to your launch tools, or end this session.' : 'Enter the access password to open this workspace.'}</p>${content}<p class="foot">${signedIn ? 'Sessions expire after 8 hours.' : 'This workspace is available by invitation.'}</p></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': NO_STORE, 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } })
}

async function readPassword(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > 2048) throw new RangeError('Body too large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing body')
  const chunks: Uint8Array[] = []
  let size = 0, timedOut = false
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}) }, 5000)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (timedOut) throw new Error('Timed out')
      if (done) break
      size += value.byteLength
      if (size > 2048) { await reader.cancel(); throw new RangeError('Body too large') }
      chunks.push(value)
    }
  } finally { clearTimeout(timer); reader.releaseLock() }
  const body = Buffer.concat(chunks)
  const fields = new URLSearchParams(body.toString('utf8'))
  if (Array.from(fields.keys()).length !== 1 || !fields.has('password')) throw new Error('Invalid form')
  const password = fields.get('password')!
  if (!password || Buffer.byteLength(password) > 256) throw new Error('Invalid password')
  return password
}

export function createAccessHandlers() {
  const perClient = new Map<string, { count: number; until: number }>()
  let aggregate = { count: 0, until: 0 }, active = 0
  const limited = (request: Request): boolean => {
    const now = Date.now()
    if (aggregate.until <= now) aggregate = { count: 0, until: now + 15 * 60_000 }
    const client = (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown').slice(0, 64)
    for (const [key, entry] of perClient) if (entry.until <= now) perClient.delete(key)
    if (perClient.size >= 1000 && !perClient.has(client)) return true
    const entry = perClient.get(client) || { count: 0, until: now + 15 * 60_000 }
    perClient.set(client, entry)
    return ++entry.count > 10 || ++aggregate.count > 60 || active >= 2
  }
  return {
    async GET(request: Request): Promise<Response> {
      const config = configuration()
      if (config.mode === 'disabled') return redirect('/')
      return config.mode === 'blocked' ? accessPage('', 503) : accessPage('', 200, hasAppAccess(request))
    },
    async POST(request: Request): Promise<Response> {
      if (!trustedPost(request)) return accessPage('This request could not be accepted. Open the sign-in page and try again.', 403)
      const config = configuration()
      if (config.mode === 'blocked') return accessPage('', 503)
      if (config.mode === 'disabled') return redirect('/launch')
      if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return accessPage('Use the password form to sign in.', 415)
      if (limited(request)) {
        const response = accessPage('Too many attempts. Please try again in 15 minutes.', 429)
        response.headers.set('Retry-After', '900')
        return response
      }
      active++
      try {
        let password: string
        try { password = await readPassword(request) } catch (error) { return accessPage('The sign-in form could not be read.', error instanceof RangeError ? 413 : 400) }
        const derived = await new Promise<Buffer>((resolve, reject) => scrypt(password, config.salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)))
        if (!timingSafeEqual(derived, config.digest)) return accessPage('That password was not accepted. Try again.', 401)
        return redirect('/launch', sessionCookie(createAccessSession(), SESSION_SECONDS))
      } catch { return accessPage('Sign-in is temporarily unavailable. Please try again.', 503) }
      finally { active-- }
    },
    async logout(request: Request): Promise<Response> {
      if (!trustedPost(request)) return Response.json({ error: 'Request not allowed.' }, { status: 403, headers: { 'Cache-Control': NO_STORE } })
      return redirect('/access', sessionCookie('', 0))
    },
  }
}

export const accessHandlers = createAccessHandlers()
