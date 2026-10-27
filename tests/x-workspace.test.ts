import { describe, expect, it, vi } from 'vitest'
import { canonicalXPostUrl, readXPost, readXSession, safeXConnectionUrl, xWorkspaceRequest, XWorkspaceError } from '../src/lib/xWorkspace'
import { postToWebCapture } from '../src/lib/xPosts'
import { parseWebCapture } from '../src/lib/webCapture'

describe('X workspace public input and connection boundaries', () => {
  it('normalizes only individual public X posts before sending a request', () => {
    expect(canonicalXPostUrl(' https://twitter.com/creator/status/123456?s=20#details ')).toBe('https://x.com/creator/status/123456')
    for (const value of ['https://x.com/creator', 'https://x.com/i/status/123', 'http://x.com/creator/status/123', 'https://x.com.evil.test/a/status/1', 'https://user@x.com/a/status/1', 'https://x.com/a/status/1/photo/1', 'https://x.com/a/status/not-a-number', 'https://x.com/creat\nor/status/123']) {
      expect(() => canonicalXPostUrl(value)).toThrow()
    }
  })

  it('hands a validated public source into the existing capture review with an empty symbol', () => {
    const post = { id: '123', url: 'https://x.com/creator/status/123', text: '😀 A new idea\nReview this text.', author: { username: 'creator', name: 'Creator' }, images: [{ url: 'https://pbs.twimg.com/media/art.jpg' }], source: 'oembed' }
    const capture = postToWebCapture(readXPost(post))
    expect(parseWebCapture('#import=' + encodeURIComponent(JSON.stringify(capture)))).toEqual(capture)
    expect(capture.symbol).toBe('')
    expect(capture.sourceUrl).toBe(post.url)
    expect(capture.imageUrl).toBe(post.images[0].url)
    expect(Object.keys(capture)).not.toContain('mint')
    for (const invalid of [{ ...post, images: [{ url: 'https://evil.test/track.jpg' }] }, { ...post, id: '999' }, { ...post, images: [null] }, { ...post, createdAt: 'not a date' }]) expect(() => readXPost(invalid)).toThrow()
    expect(readXSession({ available: false, connected: false })).toEqual({ available: false, connected: false })
    expect(() => readXSession({ available: false, connected: true, user: { username: 'creator' } })).toThrow()
  })

  it('allows only the expected OAuth page or canonical local continuation', () => {
    expect(safeXConnectionUrl({ authorizeUrl: 'https://x.com/i/oauth2/authorize?state=opaque' })).toBe('https://x.com/i/oauth2/authorize?state=opaque')
    expect(safeXConnectionUrl({ continueUrl: 'https://outsol.online/x?connection=connected' })).toBe('https://outsol.online/x?connection=connected')
    for (const value of [{ authorizeUrl: 'https://x.com/creator' }, { authorizeUrl: 'https://evil.test/i/oauth2/authorize' }, { continueUrl: 'https://outsol.online/x/other' }, { continueUrl: 'https://outsol.online/x?next=https://evil.test' }, { continueUrl: '//outsol.online/x' }, { authorizeUrl: 'https://user@x.com/i/oauth2/authorize' }, {}]) {
      expect(() => safeXConnectionUrl(value)).toThrow()
    }
  })

  it('uses local requests without caches or following redirects and sends only the reviewed URL', async () => {
    let receivedUrl = '', received: RequestInit | undefined
    const fetcher = async (url: string | URL | Request, options?: RequestInit) => {
      receivedUrl = String(url); received = options
      return Response.json({ post: { id: '123' } })
    }
    const controller = new AbortController()
    const result = await xWorkspaceRequest('/api/x/post', { method: 'POST', body: { url: canonicalXPostUrl('https://x.com/creator/status/123?s=1') }, signal: controller.signal }, fetcher as typeof fetch)
    expect(result).toEqual({ post: { id: '123' } })
    expect(receivedUrl).toBe('/api/x/post')
    expect(received).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error', body: '{"url":"https://x.com/creator/status/123"}' })
    expect(received?.signal).toBeInstanceOf(AbortSignal)
  })

  it('exposes reconnect and limit errors without reflecting untrusted provider text', async () => {
    const fetcher = async () => Response.json({ error: '<script>provider secret</script>', code: 'expired' }, { status: 401 })
    await expect(xWorkspaceRequest('/api/x/posts', {}, fetcher as typeof fetch)).rejects.toMatchObject({ status: 401, message: 'Your X connection has expired. Reconnect to load your posts.' })
    const limit = async () => Response.json({ error: 'internal provider details' }, { status: 429 })
    await expect(xWorkspaceRequest('/api/x/post', {}, limit as typeof fetch)).rejects.toThrow('X is limiting requests. Wait a little, then try again.')
  })

  it('bounds waiting and preserves cancellation through the supplied signal', async () => {
    vi.useFakeTimers()
    const fetcher = (_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    const pending = xWorkspaceRequest('/api/x/session', {}, fetcher as typeof fetch).catch(error => error)
    await vi.advanceTimersByTimeAsync(18_000)
    expect(await pending).toBeInstanceOf(XWorkspaceError)
    expect(await pending).toMatchObject({ message: expect.stringContaining('timed out') })
    vi.useRealTimers()
    const controller = new AbortController(); controller.abort()
    await expect(xWorkspaceRequest('/api/x/session', { signal: controller.signal }, fetch as typeof fetch)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
