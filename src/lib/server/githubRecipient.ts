import { canonicalGitHubUsername, parseVerifiedGitHubIndividual, type VerifiedGitHubIndividual } from '../creatorFeeRouting'
import { readBoundedResponse } from './rehearsal/bounded'

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
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store' }
    try {
      const url = new URL(request.url)
      if (Array.from(url.searchParams.keys()).some(key => key !== 'username') || url.searchParams.getAll('username').length !== 1) throw new Error('Provide one GitHub individual username.')
      const recipient = await resolveGitHubIndividual(url.searchParams.get('username') || '', request.signal)
      return Response.json({ recipient }, { headers })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'GitHub recipient could not be verified.' }, { status: 400, headers })
    }
  }
}
