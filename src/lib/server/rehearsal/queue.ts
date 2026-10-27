import { randomBytes } from 'node:crypto'
import { RehearsalError } from './input'
import type { RehearsalInput, RehearsalJob, RehearsalReport } from './types'

type Runner = (input: RehearsalInput, signal: AbortSignal) => Promise<RehearsalReport>
interface Entry { job: RehearsalJob; input: RehearsalInput; controller: AbortController }
const TTL_MS = 10 * 60_000

export class RehearsalQueue {
  private readonly entries = new Map<string, Entry>()
  private pending: Entry[] = []
  private active?: Entry
  constructor(private readonly runner: Runner) {}

  private expire() {
    const now = Date.now()
    for (const [id, entry] of this.entries) if (Date.parse(entry.job.expiresAt) <= now && !['queued', 'running'].includes(entry.job.status)) this.entries.delete(id)
  }

  submit(input: RehearsalInput): RehearsalJob {
    this.expire()
    if (this.pending.length >= 3 || this.entries.size >= 50) throw new RehearsalError(429, 'Rehearsal is busy; try again shortly')
    const now = Date.now()
    const job: RehearsalJob = { id: randomBytes(24).toString('hex'), status: 'queued', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL_MS).toISOString() }
    const entry = { job, input: { ...input }, controller: new AbortController() }
    this.entries.set(job.id, entry)
    this.pending.push(entry)
    this.drain()
    return { ...job }
  }

  read(id: string): RehearsalJob | undefined {
    this.expire()
    if (!/^[a-f0-9]{48}$/.test(id)) return
    const job = this.entries.get(id)?.job
    return job ? structuredClone(job) : undefined
  }

  cancel(id: string): RehearsalJob | undefined {
    const entry = /^[a-f0-9]{48}$/.test(id) ? this.entries.get(id) : undefined
    if (!entry) return
    if (['queued', 'running'].includes(entry.job.status)) {
      entry.job.status = 'cancelled'
      entry.controller.abort()
      this.pending = this.pending.filter(value => value !== entry)
    }
    return this.read(id)
  }

  private drain() {
    if (this.active) return
    const entry = this.pending.shift()
    if (!entry) return
    this.active = entry
    entry.job.status = 'running'
    const timer = setTimeout(() => entry.controller.abort(), 55_000)
    void this.runner(entry.input, entry.controller.signal).then(result => {
      if (!entry.controller.signal.aborted) { entry.job.result = result; entry.job.status = 'succeeded' }
    }).catch(() => {
      if (entry.job.status !== 'cancelled') {
        entry.job.status = 'failed'
        entry.job.error = entry.controller.signal.aborted ? 'Rehearsal timed out. No real SOL was spent; try again.' : 'The local rehearsal could not complete. No real SOL was spent; try again.'
      }
    }).finally(() => {
      clearTimeout(timer)
      if (entry.controller.signal.aborted && entry.job.status === 'running') {
        entry.job.status = 'failed'
        entry.job.error = 'Rehearsal timed out. No real SOL was spent; try again.'
      }
      this.active = undefined
      this.drain()
    })
  }
}
