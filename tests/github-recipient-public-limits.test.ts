import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createGitHubRecipientHandler } from '../src/lib/server/githubRecipient'

let now = 1_800_000_000_000
const request = (username = 'alice', client = 'one', origin = 'https://launchpier.net') => new Request(`https://launchpier.net/api/github/recipient?username=${username}`, { headers: { origin, 'x-forwarded-for': client } })
beforeEach(() => {
  now = 1_800_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.stubEnv('APP_ORIGIN', 'https://launchpier.net')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const login = new URL(url).pathname.split('/').at(-1)!
    return Response.json({ id: 12345, login, type: 'User', html_url: `https://github.com/${login}` })
  }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('rejects other browser origins before spending the shared GitHub allowance', async () => {
  expect((await createGitHubRecipientHandler()(request('alice', 'one', 'https://evil.example'))).status).toBe(403)
  expect(fetch).not.toHaveBeenCalled()
})
it('shares repeated and overlapping lookups while refreshing identities after 60 seconds', async () => {
  const handler = createGitHubRecipientHandler()
  const rows = await Promise.all([handler(request('alice')), handler(request('ALICE'))])
  expect(rows.map(row => row.status)).toEqual([200, 200])
  expect(fetch).toHaveBeenCalledTimes(1)
  now += 59_999
  expect((await handler(request())).status).toBe(200)
  expect(fetch).toHaveBeenCalledTimes(1)
  now++
  expect((await handler(request())).status).toBe(200)
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('caps aggregate new upstream work at six each minute despite rotating client addresses', async () => {
  const handler = createGitHubRecipientHandler()
  for (let i = 0; i < 6; i++) expect((await handler(request(`person${i}`, `client${i}`))).status).toBe(200)
  const denied = await handler(request('seventh', 'rotated'))
  expect(denied.status).toBe(429)
  expect(denied.headers.get('retry-after')).toBe('60')
  expect(fetch).toHaveBeenCalledTimes(6)
  now += 60_000
  expect((await handler(request('seventh', 'rotated'))).status).toBe(200)
})
it('caps one client at ten requests each minute including cache hits', async () => {
  const handler = createGitHubRecipientHandler()
  for (let i = 0; i < 10; i++) expect((await handler(request())).status).toBe(200)
  expect((await handler(request())).status).toBe(429)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('counts failed upstream reads against the same aggregate allowance', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 500 })))
  const handler = createGitHubRecipientHandler()
  for (let i = 0; i < 6; i++) expect((await handler(request(`missing${i}`, `client${i}`))).status).toBe(400)
  const denied = await handler(request('missing7', 'another'))
  expect(denied.status).toBe(429)
  expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0)
  expect(fetch).toHaveBeenCalledTimes(6)
})
it('reserves no more than sixty upstream requests in an hour across minute resets', async () => {
  const handler = createGitHubRecipientHandler()
  for (let minute = 0; minute < 10; minute++) {
    for (let i = 0; i < 6; i++) expect((await handler(request(`person${minute}x${i}`, `client${i}`))).status).toBe(200)
    now += 60_000
  }
  const denied = await handler(request('sixtyfirst', 'another'))
  expect(denied.status).toBe(429)
  expect(denied.headers.get('retry-after')).toBe('3000')
  expect(fetch).toHaveBeenCalledTimes(60)
  now += 3_000_000
  expect((await handler(request('sixtyfirst', 'another'))).status).toBe(200)
})
it('rejects malformed usernames and arbitrary fields without fetching', async () => {
  const handler = createGitHubRecipientHandler()
  expect((await handler(request('alice/repository'))).status).toBe(400)
  expect((await handler(new Request('https://launchpier.net/api/github/recipient?username=alice&url=evil'))).status).toBe(400)
  expect(fetch).not.toHaveBeenCalled()
})
