import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAllowedRequestOrigin } from '../src/lib/server/requestOrigin'
import { createAccessHandlers, requireAppAccess, resolveAccessOrigin } from '../src/lib/server/appAccess'
import { safeXConnectionUrl } from '../src/lib/xWorkspace'

const origins = ['https://launchpier.net', 'https://www.launchpier.net', 'https://outsol.online', 'https://vanity-production-2bbb.up.railway.app']
const request = (origin: string, headers: Record<string, string> = {}) => new Request('http://127.0.0.1:3000/api/rpc', { headers: { origin, 'x-forwarded-proto': 'https', ...headers } })

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('APP_ORIGIN', 'https://launchpier.net')
  vi.stubEnv('PUBLIC_APP_URL', 'https://launchpier.net')
  vi.stubEnv('APP_ALLOWED_ORIGINS', '')
  vi.stubEnv('APP_ADDITIONAL_ORIGINS', 'https://www.launchpier.net,https://outsol.online,https://vanity-production-2bbb.up.railway.app')
  vi.stubEnv('APP_ACCESS_PASSWORD_HASH', '')
  vi.stubEnv('APP_ACCESS_SESSION_SECRET', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('LaunchPier domain transition', () => {
  it.each(origins)('allows configured API callers at %s without bypassing private access', origin => {
    expect(isAllowedRequestOrigin(request(origin))).toBe(true)
    expect(requireAppAccess(request(origin))?.status).toBe(503)
  })

  it.each(origins)('keeps access redirects and logout on the selected address %s', async origin => {
    const host = new URL(origin).host
    expect(resolveAccessOrigin(request(origin, { host }))).toBe(origin)
    const logout = await createAccessHandlers().logout(new Request('http://127.0.0.1:3000/api/access/logout', { method: 'POST', headers: { origin, host, 'x-forwarded-proto': 'https' } }))
    expect(logout.status).toBe(303)
    expect(logout.headers.get('location')).toBe('/access')
    expect(logout.headers.get('set-cookie')).not.toContain('Domain=')
  })

  it('rejects third-party and cross-site requests even with spoofed public host headers', async () => {
    for (const origin of ['https://launchpier.net.attacker.example', 'https://other.launchpier.net', 'https://attacker.example', 'http://launchpier.net']) {
      expect(isAllowedRequestOrigin(request(origin, { host: 'launchpier.net', 'x-forwarded-host': 'launchpier.net' }))).toBe(false)
      expect((await createAccessHandlers().logout(new Request('https://launchpier.net/api/access/logout', { method: 'POST', headers: { origin } }))).status).toBe(403)
    }
    expect(isAllowedRequestOrigin(request('https://outsol.online', { 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(resolveAccessOrigin(request('https://attacker.example', { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' }))).toBe('https://launchpier.net')
  })

  it.each(['https://*.launchpier.net', 'https://outsol.online/path', 'https://user:pass@outsol.online', 'https://outsol.online,,https://www.launchpier.net', Array.from({ length: 9 }, (_, index) => `https://site${index}.example`).join(','), 'a'.repeat(4097)])('fails closed for malformed or excessive additional origins', aliases => {
    vi.stubEnv('APP_ADDITIONAL_ORIGINS', aliases)
    expect(isAllowedRequestOrigin(request('https://launchpier.net'))).toBe(false)
    expect(resolveAccessOrigin(request('https://launchpier.net', { host: 'launchpier.net' }))).toBeNull()
  })

  it('continues to support explicitly configured legacy aliases', () => {
    vi.stubEnv('APP_ADDITIONAL_ORIGINS', 'https://www.launchpier.net')
    vi.stubEnv('APP_ALLOWED_ORIGINS', 'https://outsol.online,https://vanity-production-2bbb.up.railway.app')
    for (const origin of origins) expect(isAllowedRequestOrigin(request(origin))).toBe(true)
  })

  it('fails closed when production has no configured deployment origins', () => {
    vi.stubEnv('APP_ORIGIN', '')
    vi.stubEnv('PUBLIC_APP_URL', '')
    vi.stubEnv('APP_ADDITIONAL_ORIGINS', '')
    expect(isAllowedRequestOrigin(new Request('https://attacker.example/api/rpc', { headers: { origin: 'https://attacker.example' } }))).toBe(false)
  })

  it.each(origins)('accepts an exact known X continuation at %s', origin => {
    expect(safeXConnectionUrl({ continueUrl: `${origin}/x?connection=connected` })).toBe(`${origin}/x?connection=connected`)
  })

  it('rejects X continuation lookalikes and unreviewed paths', () => {
    for (const continueUrl of ['https://launchpier.net.attacker.example/x', 'https://other.launchpier.net/x', 'https://launchpier.net/x?next=https://attacker.example', 'https://launchpier.net/x/other']) expect(() => safeXConnectionUrl({ continueUrl })).toThrow()
  })
})
