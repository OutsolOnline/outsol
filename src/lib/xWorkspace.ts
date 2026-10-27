import { normalizeXImageUrl, parseXPostUrl, type XPost } from './xPosts'

export type XWorkspaceEndpoint = '/api/x/session' | '/api/x/connect' | '/api/x/disconnect' | '/api/x/post' | '/api/x/posts'
export interface XSession {
  available: boolean
  connected: boolean
  user?: { id: string; username: string; name: string; profileImageUrl?: string; protected: boolean }
  expiresAt?: string
}

export class XWorkspaceError extends Error {
  constructor(message: string, public readonly status = 0) { super(message); this.name = 'XWorkspaceError' }
}

/** Public post references only. The server independently validates all input. */
export function canonicalXPostUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Paste a public X post link, such as https://x.com/account/status/123.') }
  if (value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value) || url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) || !/^\/[A-Za-z0-9_]{1,15}\/status\/\d{1,22}\/?$/.test(url.pathname) || /^\/i\//.test(url.pathname)) throw new Error('Paste a public X post link, such as https://x.com/account/status/123.')
  return parseXPostUrl(`https://x.com${url.pathname.replace(/\/$/, '')}`).url
}

/** Server-provided navigation is still restricted before leaving the workspace. */
export function safeXConnectionUrl(value: { authorizeUrl?: unknown; continueUrl?: unknown }): string {
  const target = value.authorizeUrl ?? value.continueUrl
  if (typeof target !== 'string' || target.length > 4000) throw new XWorkspaceError('X connection could not be started. Try again.')
  let url: URL
  try { url = new URL(target) } catch { throw new XWorkspaceError('X connection could not be started. Try again.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new XWorkspaceError('X connection could not be started. Try again.')
  if (value.authorizeUrl !== undefined && url.hostname === 'x.com' && url.pathname === '/i/oauth2/authorize') return url.toString()
  if (value.authorizeUrl === undefined && url.origin === 'https://outsol.online' && url.pathname === '/x' && [...url.searchParams.keys()].every(key => key === 'connection') && url.searchParams.getAll('connection').length <= 1 && (!url.search || ['connected', 'cancelled', 'error'].includes(url.searchParams.get('connection') || ''))) return url.toString()
  throw new XWorkspaceError('X connection could not be started. Try again.')
}

function requestError(status: number, endpoint: XWorkspaceEndpoint): string {
  if (status === 401) return 'Your X connection has expired. Reconnect to load your posts.'
  if (status === 403) return 'This content is restricted. Use a public post you have permission to reuse.'
  if (status === 429) return 'X is limiting requests. Wait a little, then try again.'
  if (status === 503) return endpoint === '/api/x/post' ? 'X could not provide this post right now. Try again or prepare it manually.' : 'Account connection is not enabled yet. You can still import a public post or prepare one manually.'
  if (status === 404) return 'This post is unavailable. Check the link and that the post is public.'
  return endpoint === '/api/x/post' ? 'The post could not be imported. Check the link, try again or prepare it manually.' : 'X could not complete this request. Try again.'
}

/** Same-origin, bounded requests. Provider errors are never reflected into the page. */
export async function xWorkspaceRequest<T = unknown>(endpoint: XWorkspaceEndpoint, options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal } = {}, fetcher: typeof fetch = fetch): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 18_000)
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetcher(endpoint, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal, ...(options.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) } : {}) })
    if (!response.ok) throw new XWorkspaceError(requestError(response.status, endpoint), response.status)
    return await response.json() as T
  } catch (error) {
    if (timedOut) throw new XWorkspaceError('The request timed out. Try again when X is available.')
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof XWorkspaceError) throw error
    throw new XWorkspaceError('X could not be reached. Check your connection and try again.')
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}

export function readXSession(value: unknown): XSession {
  if (!value || typeof value !== 'object') throw new XWorkspaceError('Your X connection could not be checked. Try again.')
  const session = value as XSession
  if (typeof session.available !== 'boolean' || typeof session.connected !== 'boolean' || (session.connected && (!session.available || !session.user || typeof session.user.id !== 'string' || session.user.id.length > 100 || typeof session.user.username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(session.user.username) || typeof session.user.name !== 'string' || session.user.name.length > 200 || typeof session.user.protected !== 'boolean'))) throw new XWorkspaceError('Your X connection could not be checked. Try again.')
  return session
}

export function readXPost(value: unknown): XPost {
  const post = value as XPost | null
  if (!post || typeof post !== 'object' || typeof post.id !== 'string' || !/^\d{1,22}$/.test(post.id) || typeof post.url !== 'string' || typeof post.text !== 'string' || post.text.length > 30000 || !post.author || typeof post.author.username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(post.author.username) || typeof post.author.name !== 'string' || post.author.name.length > 200 || !['x-api', 'oembed'].includes(post.source) || !Array.isArray(post.images) || post.images.length > 4 || (post.createdAt !== undefined && (typeof post.createdAt !== 'string' || post.createdAt.length > 64 || Number.isNaN(Date.parse(post.createdAt))))) throw new XWorkspaceError('The post details could not be read. Try another public post or prepare it manually.')
  const source = parseXPostUrl(canonicalXPostUrl(post.url))
  if (source.id !== post.id || source.username.toLowerCase() !== post.author.username.toLowerCase()) throw new XWorkspaceError('The post source did not match its author. Try another public post.')
  for (const image of post.images) {
    if (!image || typeof image !== 'object' || !normalizeXImageUrl(image.url) || (image.alt !== undefined && (typeof image.alt !== 'string' || image.alt.length > 2000))) throw new XWorkspaceError('The post image reference could not be read.')
  }
  return post
}
