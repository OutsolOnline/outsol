import { canonicalGitHubUsername, parseVerifiedGitHubIndividual, type VerifiedGitHubIndividual } from './creatorFeeRouting'

export function assertGitHubIdentityUnchanged(previous: VerifiedGitHubIndividual | null | undefined, current: VerifiedGitHubIndividual): void {
  const identity = parseVerifiedGitHubIndividual(current)
  if (!previous) return
  const reviewed = parseVerifiedGitHubIndividual(previous)
  if (reviewed.username.toLowerCase() === identity.username.toLowerCase() && reviewed.userId !== identity.userId) throw new Error('This GitHub username now resolves to a different numeric user ID. Review the refreshed profile and prepare again before approval.')
}

/** The server verifies GitHub's public API; browsers receive only the public projection. */
export async function fetchGitHubIndividual(username: string, signal?: AbortSignal): Promise<VerifiedGitHubIndividual> {
  const login = canonicalGitHubUsername(username)
  const response = await fetch(`/api/github/recipient?username=${encodeURIComponent(login)}`, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]) })
  if (Number(response.headers.get('content-length')) > 4096) throw new Error('GitHub recipient response is too large.')
  if (!response.body) throw new Error('GitHub recipient response is empty.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4096) { void reader.cancel().catch(() => {}); throw new Error('GitHub recipient response is too large.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bodyBytes = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength }
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes))
  signal?.throwIfAborted()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GitHub recipient could not be verified.')
  const body = raw as Record<string, unknown>
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error.slice(0, 300) : 'GitHub recipient could not be verified.')
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'recipient')) throw new Error('GitHub recipient response is invalid.')
  const identity = parseVerifiedGitHubIndividual(body.recipient)
  if (identity.username.toLowerCase() !== login.toLowerCase()) throw new Error('The GitHub username changed. Refresh the recipient review.')
  return identity
}
