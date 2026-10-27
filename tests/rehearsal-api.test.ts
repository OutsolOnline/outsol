import { describe, expect, it } from 'vitest'
import { createRehearsalHandlers } from '../src/lib/server/rehearsal/service'
import { RehearsalQueue } from '../src/lib/server/rehearsal/queue'
import type { RehearsalReport } from '../src/lib/server/rehearsal/types'

const input = { name: 'Try', symbol: 'TRY', metadataUri: 'https://example.com/t.json', initialBuySol: '0', priorityFeeSol: '0', jitoTipSol: '0.00001' }
const makeRequest = (value: unknown = input, origin = 'https://vanity.test') => new Request('https://vanity.test/api/rehearsals', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

describe('rehearsal API', () => {
  it('rejects foreign origins and secret-bearing payloads before creating a job', async () => {
    let executions = 0
    const handlers = createRehearsalHandlers(new RehearsalQueue(async () => { executions++; return {} as RehearsalReport }))
    expect((await handlers.post(makeRequest(input, 'https://evil.test'))).status).toBe(403)
    expect((await handlers.post(makeRequest({ ...input, privateKey: 'should-never-enter-a-runner' }))).status).toBe(400)
    expect(executions).toBe(0)
  })

  it('returns an opaque job capability, allows polling, and bounds submissions', async () => {
    const handlers = createRehearsalHandlers(new RehearsalQueue(async () => ({} as RehearsalReport)))
    const accepted = await handlers.post(makeRequest())
    expect(accepted.status).toBe(202)
    const job = await accepted.json()
    expect(job.id).toMatch(/^[a-f0-9]{48}$/)
    await new Promise(resolve => setTimeout(resolve, 10))
    const read = await handlers.get(new Request(`https://vanity.test/api/rehearsals/${job.id}`), job.id)
    expect((await read.json()).status).toBe('succeeded')
    expect(read.headers.get('cache-control')).toBe('no-store')
    expect((await handlers.get(new Request('https://vanity.test/api/rehearsals/other'), 'other')).status).toBe(404)
    await handlers.post(makeRequest())
    await handlers.post(makeRequest())
    expect((await handlers.post(makeRequest())).status).toBe(429)
  })
})
