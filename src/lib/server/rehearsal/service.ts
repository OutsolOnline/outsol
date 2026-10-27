import { isAllowedRequestOrigin } from '../requestOrigin'
import { executeRehearsal } from './execute'
import { RehearsalError, parseRehearsalInput } from './input'
import { RehearsalQueue } from './queue'

const globalService = globalThis as typeof globalThis & { __vanityRehearsalQueue?: RehearsalQueue }
const queue = globalService.__vanityRehearsalQueue ||= new RehearsalQueue(executeRehearsal)
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
function reject(status: number, error: string) { return Response.json({ error }, { status, headers }) }

async function readInput(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > 2048) throw new RehearsalError(413, 'Launch settings are too large')
  if (!request.body) throw new RehearsalError(400, 'Launch settings are required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void reader.cancel() }, 5000)
  try {
    while (true) {
      request.signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (timedOut) throw new RehearsalError(408, 'Launch settings took too long to arrive')
      if (done) break
      length += value.length
      if (length > 2048) { await reader.cancel(); throw new RehearsalError(413, 'Launch settings are too large') }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder().decode(bytes))
  } finally { clearTimeout(timer); reader.releaseLock() }
}

/** Per-process limits cap anonymous work even if forwarded client addresses vary. */
export function createRehearsalHandlers(jobs: RehearsalQueue = queue) {
  const clients = new Map<string, { count: number; expires: number }>()
  let aggregate = { count: 0, expires: 0 }
  return {
    async post(request: Request): Promise<Response> {
      try {
        if (!isAllowedRequestOrigin(request)) return reject(403, 'Origin not allowed')
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reject(415, 'JSON launch settings are required')
        const now = Date.now()
        if (aggregate.expires <= now) aggregate = { count: 0, expires: now + 60_000 }
        for (const [id, entry] of clients) if (entry.expires <= now) clients.delete(id)
        const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown'
        if (clients.size >= 1000 && !clients.has(client)) return reject(429, 'Rehearsal is busy; try again shortly')
        const quota = clients.get(client) || { count: 0, expires: now + 10 * 60_000 }
        clients.set(client, quota)
        if (++quota.count > 3 || ++aggregate.count > 6) return reject(429, 'Rehearsal limit reached; try again later')
        const input = parseRehearsalInput(await readInput(request))
        request.signal.throwIfAborted()
        return Response.json(jobs.submit(input), { status: 202, headers })
      } catch (error) {
        if (error instanceof RehearsalError) return reject(error.status, error.message)
        if (request.signal.aborted) return reject(408, 'Rehearsal request was cancelled')
        return reject(400, 'Invalid public launch settings')
      }
    },
    async get(request: Request, id: string): Promise<Response> {
      if (!isAllowedRequestOrigin(request)) return reject(403, 'Origin not allowed')
      const job = jobs.read(id)
      return job ? Response.json(job, { headers }) : reject(404, 'Rehearsal expired or was not found')
    },
    async remove(request: Request, id: string): Promise<Response> {
      if (!isAllowedRequestOrigin(request)) return reject(403, 'Origin not allowed')
      const job = jobs.cancel(id)
      return job ? Response.json(job, { headers }) : reject(404, 'Rehearsal expired or was not found')
    },
  }
}

export const rehearsalHandlers = createRehearsalHandlers()
