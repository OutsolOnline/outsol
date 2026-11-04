import { canonicalGitHubUsername, parseVerifiedGitHubIndividual, type VerifiedGitHubIndividual } from '../creatorFeeRouting'
import { readBoundedResponse } from './rehearsal/bounded'
import { isAllowedRequestOrigin } from './requestOrigin'

class GitHubLookupLimit extends Error {
  constructor(readonly retryAfter: number) { super('GitHub recipient lookups are busy. Try again later.') }
}

/** Public identity lookup only. No OAuth, tokens, redirects, or caller supplied URLs. */
export async function resolveGitHubIndividual(username: string, signal?: AbortSignal): Promise<VerifiedGitHubIndividual> {
  const login = canonicalGitHubUsername(username)
  const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6000)])
  try {
    boundedSignal.throwIfAborted()
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: boundedSignal, cache: 'no-store', redirect: 'error' })
    if (!response.ok || response.redirected) {
      void response.body?.cancel().catch(() => {})
      if (response.status === 404) throw new Error('This GitHub individual could not be found. Check the username.')
      if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting public lookups. Try again later.')
      throw new Error('GitHub identity lookup failed. Refresh the recipient review.')
    }
    const raw: unknown = JSON.parse(await readBoundedResponse(response, 65_536))
    boundedSignal.throwIfAborted()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GitHub returned an invalid identity.')
    const account = raw as Record<string, unknown>
    if (account.type !== 'User') throw new Error('Choose a GitHub individual user account. Organization, bot, and repository payouts are unavailable.')
    if (typeof account.id !== 'number' || !Number.isSafeInteger(account.id) || account.id <= 0) throw new Error('GitHub returned an unsafe individual user ID.')
    const recipient = parseVerifiedGitHubIndividual({ userId: String(account.id), username: account.login, profileUrl: account.html_url, accountType: 'User' })
    if (recipient.username.toLowerCase() !== login.toLowerCase()) throw new Error('This GitHub username changed or was renamed. Refresh and select the current individual explicitly.')
    return recipient
  } catch (error) {
    if (boundedSignal.aborted) throw new Error(signal?.aborted ? 'GitHub recipient lookup was cancelled.' : 'GitHub recipient lookup timed out. Try again.')
    throw error
  }
}

export function createGitHubRecipientHandler() {
  const clients = new Map<string, { count: number; until: number }>()
  const cache = new Map<string, { recipient: VerifiedGitHubIndividual; until: number }>()
  const inflight = new Map<string, Promise<VerifiedGitHubIndividual>>()
  let minute = { count: 0, until: 0 }, hour = { count: 0, until: 0 }
  const retry = (until: number, now: number) => Math.max(1, Math.ceil((until - now) / 1000))
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store' }
    try {
      if (!isAllowedRequestOrigin(request)) return Response.json({ error: 'Origin not allowed.' }, { status: 403, headers })
      const url = new URL(request.url)
      if (request.method !== 'GET' || Array.from(url.searchParams.keys()).some(key => key !== 'username') || url.searchParams.getAll('username').length !== 1) throw new Error('Provide one GitHub individual username.')
      const login = canonicalGitHubUsername(url.searchParams.get('username') || '').toLowerCase(), now = Date.now()
      for (const [key, value] of clients) if (value.until <= now) clients.delete(key)
      for (const [key, value] of cache) if (value.until <= now) cache.delete(key)
      const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown'
      if (clients.size >= 1000 && !clients.has(client)) throw new GitHubLookupLimit(60)
      const quota = clients.get(client) || { count: 0, until: now + 60_000 }
      clients.set(client, quota)
      if (++quota.count > 10) throw new GitHubLookupLimit(retry(quota.until, now))
      let recipient = cache.get(login)?.recipient
      if (!recipient) {
        let pending = inflight.get(login)
        if (!pending) {
          if (minute.until <= now) minute = { count: 0, until: now + 60_000 }
          if (hour.until <= now) hour = { count: 0, until: now + 3_600_000 }
          if (hour.count >= 60) throw new GitHubLookupLimit(retry(hour.until, now))
          if (minute.count >= 6) throw new GitHubLookupLimit(retry(minute.until, now))
          // Count failures too; changing client addresses cannot extend upstream budgets.
          minute.count++; hour.count++
          // A shared read has its own six-second deadline, independent of any one caller.
          pending = resolveGitHubIndividual(login).then(value => {
            if (cache.size >= 200) cache.delete(cache.keys().next().value!)
            cache.set(login, { recipient: value, until: Date.now() + 60_000 })
            return value
          }).finally(() => { inflight.delete(login) })
          inflight.set(login, pending)
        }
        recipient = await pending
      }
      return Response.json({ recipient }, { headers })
    } catch (error) {
      if (error instanceof GitHubLookupLimit) return Response.json({ error: error.message }, { status: 429, headers: { ...headers, 'Retry-After': String(error.retryAfter) } })
      return Response.json({ error: error instanceof Error ? error.message : 'GitHub recipient could not be verified.' }, { status: 400, headers })
    }
  }
}
