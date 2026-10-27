import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { executeRehearsal } from '../src/lib/server/rehearsal/execute'
import { acquireRehearsalRuntime, localRuntimeRpc, releaseRehearsalRuntime, stopRehearsalRuntime } from '../src/lib/server/rehearsal/runtime'
import { createRehearsalHandlers } from '../src/lib/server/rehearsal/service'
import { RehearsalQueue } from '../src/lib/server/rehearsal/queue'

describe.skipIf(process.env.RUN_REHEARSAL_LOCAL !== '1')('product rehearsal on a dedicated real Surfpool VM', () => {
  afterAll(async () => { await stopRehearsalRuntime() })
  it.each([
    { name: 'Try a launch', symbol: 'TRY', metadataUri: 'https://example.com/token.json', initialBuySol: '0', priorityFeeSol: '0', jitoTipSol: '0.00001' },
    { name: 'N'.repeat(32), symbol: 'S'.repeat(10), metadataUri: 'https://example.com/'.padEnd(200, 'm'), initialBuySol: '0.1', priorityFeeSol: '0.00002', jitoTipSol: '0.00001' },
  ])('executes $initialBuySol fake SOL and reports actual post-state', async input => {
    const report = await executeRehearsal(input, AbortSignal.timeout(55_000))
    expect(report.network).toBe('local-mainnet-fork')
    expect(report.runtimeVersion).toBe('1.6.1')
    expect(report.mintAuthority).toBeNull()
    expect(report.freezeAuthority).toBeNull()
    expect(report.metadataImmutable).toBe(true)
    expect(report.platformFeeLamports).toBe('0')
    expect(BigInt(report.supplyRaw)).toBeGreaterThan(0n)
    expect(BigInt(report.totalCostLamports)).toBe(BigInt(report.payerBeforeLamports) - BigInt(report.payerAfterLamports))
    expect(BigInt(report.networkFeeLamports)).toBeGreaterThan(0n)
    if (input.initialBuySol === '0') {
      expect(report.walletTokenRaw).toBe('0')
      expect(report.execution).toBe('single')
    } else {
      expect(BigInt(report.walletTokenRaw)).toBeGreaterThan(0n)
      expect(BigInt(report.curveRealSolReservesLamports)).toBeGreaterThan(0n)
      expect(report.execution).toBe('atomic-bundle')
    }
    expect(report.unsupported).toEqual({ devLock: 'not-configured', lp: 'not-configured' })
    expect(JSON.stringify(report)).not.toMatch(/secretKey|privateKey|RPC_URL|api-key/i)
    if (process.env.REHEARSAL_REPORT_FILE) writeFileSync(process.env.REHEARSAL_REPORT_FILE, JSON.stringify(report, null, 2))
  }, 60_000)

  it('runs the public POST and polling workflow against the real VM', async () => {
    const handlers = createRehearsalHandlers(new RehearsalQueue(executeRehearsal))
    const input = { name: 'Public rehearsal', symbol: 'PUBLIC', metadataUri: 'https://example.com/public.json', initialBuySol: '0.02', priorityFeeSol: '0', jitoTipSol: '0.00001' }
    const accepted = await handlers.post(new Request('https://vanity.test/api/rehearsals', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://vanity.test' }, body: JSON.stringify(input) }))
    expect(accepted.status).toBe(202)
    const { id } = await accepted.json()
    const deadline = Date.now() + 55_000
    while (Date.now() < deadline) {
      const response = await handlers.get(new Request(`https://vanity.test/api/rehearsals/${id}`), id)
      const job = await response.json()
      if (job.status === 'succeeded') {
        expect(job.result.name).toBe(input.name)
        expect(BigInt(job.result.walletTokenRaw)).toBeGreaterThan(0n)
        expect(BigInt(job.result.totalCostLamports)).toBe(BigInt(job.result.payerBeforeLamports) - BigInt(job.result.payerAfterLamports))
        return
      }
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || 'Public workflow failed')
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error('Public rehearsal did not finish within its bound')
  }, 60_000)

  it('blocks actual upstream submission requests before forwarding them', async () => {
    const signal = AbortSignal.timeout(25_000)
    const endpoint = await acquireRehearsalRuntime(signal)
    expect(endpoint).toBe('http://127.0.0.1:18999')
    const blocked = await fetch('http://127.0.0.1:18898', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: ['MUST_NEVER_FORWARD'] }) })
    expect(blocked.status).toBe(403)
    const genesis = await localRuntimeRpc(endpoint, 'getGenesisHash', [], signal)
    expect(genesis).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    await releaseRehearsalRuntime()
  }, 30_000)

  it('cancels real runtime work and runs the next job with fresh isolated state', async () => {
    const jobs = new RehearsalQueue(executeRehearsal)
    const input = { name: 'Cancelled plan', symbol: 'CANCEL', metadataUri: 'https://example.com/cancel.json', initialBuySol: '0.01', priorityFeeSol: '0', jitoTipSol: '0.00001' }
    const first = jobs.submit(input)
    expect(jobs.cancel(first.id)?.status).toBe('cancelled')
    const second = jobs.submit({ ...input, name: 'Fresh after cancellation', symbol: 'FRESH' })
    const deadline = Date.now() + 55_000
    while (Date.now() < deadline) {
      const job = jobs.read(second.id)!
      if (job.status === 'succeeded') {
        expect(job.result?.name).toBe('Fresh after cancellation')
        expect(job.result?.payerBeforeLamports).toBe('1010010000')
        expect(jobs.read(first.id)?.status).toBe('cancelled')
        return
      }
      if (job.status === 'failed') throw new Error(job.error)
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error('Job following cancellation did not finish')
  }, 60_000)
})
