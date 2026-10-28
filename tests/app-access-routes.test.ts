import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST as databaseSetup } from '../app/api/db/init/route'
import { POST as rpc } from '../app/api/rpc/route'
import { POST as upload } from '../app/api/ipfs/route'
import { POST as rehearse } from '../app/api/rehearsals/route'
import { GET as rehearsalStatus, DELETE as rehearsalDelete } from '../app/api/rehearsals/[id]/route'
import { GET as pumpFeed } from '../app/api/pump-feed/route'
import { GET as githubRecipient } from '../app/api/github/recipient/route'
import { GET as xSession } from '../app/api/x/session/route'
import { GET as xPosts } from '../app/api/x/posts/route'
import { POST as xPost } from '../app/api/x/post/route'
import { POST as xConnect } from '../app/api/x/connect/route'
import { POST as xDisconnect } from '../app/api/x/disconnect/route'
import { GET as xCallback } from '../app/api/x/callback/route'
import { NextRequest } from 'next/server'

afterEach(() => vi.unstubAllEnvs())
describe('private route access', () => {
  it('denies an unauthenticated production API request before the route runs', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_ACCESS_PASSWORD_HASH', '')
    vi.stubEnv('APP_ACCESS_SESSION_SECRET', '')
    const result = await databaseSetup(new Request('https://outsol.online/api/db/init', { method: 'POST' }))
    expect(result.status).toBe(503)
    expect(result.headers.get('cache-control')).toContain('no-store')
  })
  it('denies every private API route before provider or storage operations without relying on proxy', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_ACCESS_PASSWORD_HASH', '')
    vi.stubEnv('APP_ACCESS_SESSION_SECRET', '')
    const request = new NextRequest('https://outsol.online/api/private', { method: 'POST' })
    const context = { params: Promise.resolve({ id: 'disposable-test-id' }) }
    const responses = await Promise.all([
      rpc(request), upload(request), rehearse(request), rehearsalStatus(request, context), rehearsalDelete(request, context),
      pumpFeed(request), githubRecipient(request), xSession(request), xPosts(request), xPost(request), xConnect(request), xDisconnect(request), xCallback(request),
    ])
    expect(responses.map(response => response.status)).toEqual(Array(13).fill(503))
  })
})
