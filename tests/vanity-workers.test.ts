import { afterEach, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { VanityController, type VanityWorkerHandle } from '../src/lib/vanity/controller'
import type { VanityConfig, WorkerMessage, WorkerResponse } from '../src/lib/vanity/types'

class FakeWorker implements VanityWorkerHandle {
  messages: WorkerMessage[] = []
  terminated = false
  handlers!: { onMessage: (message: unknown) => void; onError: () => void }
  setHandlers(handlers: FakeWorker['handlers']) { this.handlers = handlers }
  postMessage(message: WorkerMessage) { this.messages.push(message) }
  terminate() { this.terminated = true }
  emit(message: Omit<WorkerResponse, 'runId' | 'workerId'>) {
    const start = this.messages[0]
    this.handlers.onMessage({ runId: start.runId, workerId: start.workerId, ...message })
  }
}
const config: VanityConfig = { pattern: 'zzzzzz', mode: 'prefix', caseSensitive: true, threads: 3, stopAfter: 1 }
function callbacks() { return { onProgress: vi.fn(), onFound: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() } }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('starts the requested worker pool and aggregates each worker’s attempts using elapsed wall time', () => {
  const workers: FakeWorker[] = []
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const controller = new VanityController(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
  const events = callbacks()
  controller.start(config, events)
  expect(workers).toHaveLength(3)
  expect(workers.map(worker => worker.messages[0].type)).toEqual(['start', 'start', 'start'])
  clock.mockReturnValue(2000)
  workers[0].emit({ type: 'progress', progress: { attempts: 100, elapsed: 1 } })
  workers[1].emit({ type: 'progress', progress: { attempts: 200, elapsed: 1 } })
  workers[2].emit({ type: 'progress', progress: { attempts: 3, elapsed: 1 } })
  expect(events.onProgress.mock.lastCall?.[0]).toMatchObject({ attempts: 303, elapsed: 1, attemptsPerSecond: 303, activeWorkers: 3, executionMode: 'workers' })
  controller.destroy()
})

it('accepts only the first verified match and terminates every worker before publishing it', () => {
  const workers: FakeWorker[] = []
  const key = Keypair.generate()
  const controller = new VanityController(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
  const events = callbacks()
  events.onFound.mockImplementation(() => expect(workers.every(worker => worker.terminated)).toBe(true))
  controller.start({ ...config, pattern: key.publicKey.toBase58().slice(0, 1) }, events)
  workers[1].emit({ type: 'progress', progress: { attempts: 5, elapsed: 1 } })
  const found = { type: 'found' as const, result: { publicKey: key.publicKey.toBase58(), secretKey: Array.from(key.secretKey), attempts: 12, elapsed: 1 } }
  workers[0].emit(found)
  workers[1].emit(found)
  expect(events.onFound).toHaveBeenCalledTimes(1)
  expect(events.onFound.mock.lastCall?.[0].publicKey).toBe(key.publicKey.toBase58())
  expect(events.onFound.mock.lastCall?.[0].attempts).toBe(17)
  expect(events.onProgress.mock.lastCall?.[0]).toMatchObject({ attempts: 17, activeWorkers: 0 })
  expect(controller.getState()).toBe('found')
})

it('ignores late messages after stopping or replacing a run', () => {
  const workers: FakeWorker[] = []
  const controller = new VanityController(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
  const first = callbacks(); const second = callbacks()
  controller.start(config, first)
  const old = workers[0]
  controller.stop()
  expect(workers.every(worker => worker.terminated)).toBe(true)
  const previousProgress = first.onProgress.mock.calls.length
  old.emit({ type: 'progress', progress: { attempts: 999, elapsed: 1 } })
  expect(first.onProgress.mock.calls).toHaveLength(previousProgress)
  controller.start(config, second)
  const nextProgress = second.onProgress.mock.calls.length
  old.emit({ type: 'progress', progress: { attempts: 999, elapsed: 1 } })
  expect(second.onProgress.mock.calls).toHaveLength(nextProgress)
  controller.destroy()
})

it('falls back to one actual main-thread worker on construction or runtime failure and clears its timer on destroy', () => {
  vi.useFakeTimers()
  const created = new FakeWorker(); let factories = 0
  const controller = new VanityController(() => { if (++factories > 1) throw new Error('unsupported'); return created })
  controller.start(config, callbacks())
  expect(created.terminated).toBe(true)
  expect(controller.getRuntimeStatus()).toMatchObject({ mode: 'main-thread', activeWorkers: 1, requestedWorkers: 3 })
  expect(vi.getTimerCount()).toBe(1)
  controller.destroy()
  expect(vi.getTimerCount()).toBe(0)
  const worker = new FakeWorker()
  const runtimeController = new VanityController(() => worker)
  runtimeController.start({ ...config, threads: 1 }, callbacks())
  worker.handlers.onError()
  expect(worker.terminated).toBe(true)
  expect(runtimeController.getRuntimeStatus()).toMatchObject({ mode: 'main-thread', activeWorkers: 1 })
  runtimeController.destroy()
})

it('rejects a forged worker result whose claimed address does not derive from its secret', () => {
  vi.useFakeTimers()
  const worker = new FakeWorker(); const events = callbacks()
  const controller = new VanityController(() => worker)
  const key = Keypair.generate()
  controller.start({ ...config, pattern: '1', mode: 'contains', threads: 1 }, events)
  worker.emit({ type: 'found', result: { publicKey: Keypair.generate().publicKey.toBase58(), secretKey: Array.from(key.secretKey), attempts: 1, elapsed: 1 } })
  expect(events.onFound).not.toHaveBeenCalled()
  expect(controller.getRuntimeStatus().mode).toBe('main-thread')
  controller.destroy()
})

it('does not publish a valid keypair that fails the requested pattern', () => {
  vi.useFakeTimers()
  const worker = new FakeWorker(); const events = callbacks()
  const controller = new VanityController(() => worker)
  const key = Keypair.generate()
  const different = key.publicKey.toBase58().startsWith('A') ? 'B' : 'A'
  controller.start({ ...config, pattern: different, threads: 1 }, events)
  worker.emit({ type: 'found', result: { publicKey: key.publicKey.toBase58(), secretKey: Array.from(key.secretKey), attempts: 1, elapsed: 1 } })
  expect(events.onFound).not.toHaveBeenCalled()
  expect(worker.terminated).toBe(true)
  controller.destroy()
})
