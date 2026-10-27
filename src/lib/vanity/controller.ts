import { Keypair } from '@solana/web3.js'
import { matchesPattern, validatePattern } from './base58'
import type { VanityConfig, VanityResult, VanityProgress, VanityRuntimeStatus, WorkerMessage, WorkerResponse } from './types'

export type VanityControllerState = 'idle' | 'running' | 'found' | 'stopped'
export interface VanityControllerCallbacks {
  onProgress: (progress: VanityProgress) => void
  onFound: (result: VanityResult) => void
  onError: (error: string) => void
  onStateChange: (state: VanityControllerState) => void
}
export interface VanityWorkerHandle {
  setHandlers: (handlers: { onMessage: (message: unknown) => void; onError: () => void }) => void
  postMessage: (message: WorkerMessage) => void
  terminate: () => void
}

function createBrowserWorker(): VanityWorkerHandle {
  if (typeof Worker === 'undefined') throw new Error('Workers unavailable')
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'vanity-generator' })
  return {
    setHandlers: handlers => {
      worker.onmessage = event => handlers.onMessage(event.data)
      worker.onerror = event => { event.preventDefault(); handlers.onError() }
      worker.onmessageerror = () => handlers.onError()
    },
    postMessage: message => worker.postMessage(message),
    terminate: () => { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate() },
  }
}

/** One run owns its pool. No keys, messages or scripts leave this browser. */
export class VanityController {
  private state: VanityControllerState = 'idle'
  private callbacks: VanityControllerCallbacks | null = null
  private config: VanityConfig | null = null
  private runId = 0
  private startedAt = 0
  private completedAttempts = 0
  private fallbackAttempts = 0
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private workers = new Map<number, { handle: VanityWorkerHandle; attempts: number }>()
  private runtime: VanityRuntimeStatus = { mode: 'idle', activeWorkers: 0, requestedWorkers: 0 }
  private runtimeListeners = new Set<(status: VanityRuntimeStatus) => void>()

  constructor(private readonly createWorker: () => VanityWorkerHandle = createBrowserWorker) {}

  getState(): VanityControllerState { return this.state }
  getRuntimeStatus(): VanityRuntimeStatus { return { ...this.runtime } }
  subscribeRuntime(listener: (status: VanityRuntimeStatus) => void): () => void {
    this.runtimeListeners.add(listener)
    return () => { this.runtimeListeners.delete(listener) }
  }
  private reportRuntime(status: VanityRuntimeStatus) {
    this.runtime = status
    for (const listener of this.runtimeListeners) listener({ ...status })
  }
  private workerAttempts(): number { return [...this.workers.values()].reduce((sum, worker) => Math.min(Number.MAX_SAFE_INTEGER, sum + worker.attempts), 0) }
  private totalAttempts(): number { return Math.min(Number.MAX_SAFE_INTEGER, this.completedAttempts + this.fallbackAttempts + this.workerAttempts()) }
  private reportProgress() {
    if (this.state !== 'running') return
    const elapsed = Math.max(0, performance.now() - this.startedAt) / 1000
    const attempts = this.totalAttempts()
    this.callbacks?.onProgress({ attempts, elapsed, attemptsPerSecond: elapsed > 0 ? attempts / elapsed : 0, activeWorkers: this.runtime.activeWorkers, executionMode: this.runtime.mode === 'workers' ? 'workers' : 'main-thread' })
  }
  private terminateWorkers() {
    for (const worker of this.workers.values()) worker.handle.terminate()
    this.workers.clear()
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer)
    this.fallbackTimer = null
  }

  start(config: VanityConfig, callbacks: VanityControllerCallbacks): void {
    this.stop()
    this.callbacks = callbacks
    if (!validatePattern(config.pattern).isValid || config.pattern.length > 44 || !['prefix', 'suffix', 'contains'].includes(config.mode) || !Number.isInteger(config.threads) || config.threads < 1) {
      callbacks.onError('Choose a valid Base58 pattern, match mode and worker count.')
      return
    }
    const run = ++this.runId
    this.config = { ...config, threads: Math.min(16, config.threads), stopAfter: 1 }
    this.startedAt = performance.now()
    this.completedAttempts = 0
    this.fallbackAttempts = 0
    this.state = 'running'
    this.reportRuntime({ mode: 'workers', activeWorkers: 0, requestedWorkers: this.config.threads })
    callbacks.onStateChange('running')
    try {
      for (let workerId = 0; workerId < this.config.threads; workerId++) {
        if (run !== this.runId || this.state !== 'running' || this.runtime.mode !== 'workers') return
        const handle = this.createWorker()
        this.workers.set(workerId, { handle, attempts: 0 })
        handle.setHandlers({ onMessage: message => this.receiveWorker(run, workerId, message), onError: () => {
          if (run === this.runId && this.state === 'running' && this.workers.has(workerId)) this.startFallback(run)
        } })
        handle.postMessage({ type: 'start', runId: run, workerId, config: this.config })
      }
      if (run !== this.runId || this.state !== 'running' || this.runtime.mode !== 'workers') return
      this.reportRuntime({ mode: 'workers', activeWorkers: this.workers.size, requestedWorkers: this.config.threads })
      this.reportProgress()
    } catch { this.startFallback(run) }
  }

  private receiveWorker(run: number, workerId: number, value: unknown) {
    if (run !== this.runId || this.state !== 'running' || !this.workers.has(workerId) || !value || typeof value !== 'object') return
    const message = value as WorkerResponse
    if (message.runId !== run || message.workerId !== workerId) return
    const worker = this.workers.get(workerId)!
    if (message.type === 'progress') {
      const attempts = message.progress?.attempts
      if (!Number.isSafeInteger(attempts) || attempts! < worker.attempts) return
      worker.attempts = attempts!
      this.reportProgress()
    } else if (message.type === 'found') {
      try {
        const found = message.result
        if (!found || !Number.isSafeInteger(found.attempts) || found.attempts < worker.attempts || typeof found.publicKey !== 'string') throw new Error('Invalid result')
        const bytes = found.secretKey
        if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) throw new Error('Invalid result')
        if (bytes.length !== 64 || Array.from(bytes).some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Invalid result')
        const keypair = Keypair.fromSecretKey(new Uint8Array(bytes))
        const publicKey = keypair.publicKey.toBase58()
        if (publicKey !== found.publicKey || !this.config || !matchesPattern(publicKey, this.config.pattern, this.config.mode, this.config.caseSensitive)) throw new Error('Invalid result')
        worker.attempts = found.attempts
        this.publishFound(keypair)
      } catch { this.startFallback(run) }
    } else if (message.type === 'error' || message.type === 'stopped') this.startFallback(run)
  }

  private startFallback(run: number) {
    if (run !== this.runId || this.state !== 'running' || this.runtime.mode === 'main-thread') return
    this.completedAttempts += this.workerAttempts()
    this.terminateWorkers()
    this.fallbackAttempts = 0
    this.reportRuntime({ mode: 'main-thread', activeWorkers: 1, requestedWorkers: this.config?.threads || 1, fallbackReason: 'Background workers are unavailable; using one cooperative browser task.' })
    this.reportProgress()
    this.fallbackTimer = setTimeout(() => this.grindFallback(run), 0)
  }
  private grindFallback(run: number) {
    this.fallbackTimer = null
    if (run !== this.runId || this.state !== 'running' || !this.config) return
    const started = performance.now()
    try {
      for (let count = 0; count < 128 && run === this.runId && this.state === 'running'; count++) {
        const keypair = Keypair.generate()
        this.fallbackAttempts++
        if (matchesPattern(keypair.publicKey.toBase58(), this.config.pattern, this.config.mode, this.config.caseSensitive)) { this.publishFound(keypair); return }
        if (performance.now() - started >= 8) break
      }
      this.reportProgress()
      if (run === this.runId && this.state === 'running') this.fallbackTimer = setTimeout(() => this.grindFallback(run), 0)
    } catch {
      this.callbacks?.onError('Local address generation failed. Stop and try again in an updated browser.')
      this.stop()
    }
  }
  private publishFound(keypair: Keypair) {
    const result: VanityResult = { publicKey: keypair.publicKey.toBase58(), secretKey: new Uint8Array(keypair.secretKey), attempts: this.totalAttempts(), elapsed: Math.max(0, performance.now() - this.startedAt) }
    const callbacks = this.callbacks
    const executionMode = this.runtime.mode === 'workers' ? 'workers' : 'main-thread'
    this.state = 'found'
    this.runId++
    this.terminateWorkers()
    this.reportRuntime({ mode: 'idle', activeWorkers: 0, requestedWorkers: this.config?.threads || 0 })
    const elapsed = result.elapsed / 1000
    callbacks?.onProgress({ attempts: result.attempts, elapsed, attemptsPerSecond: elapsed > 0 ? result.attempts / elapsed : 0, activeWorkers: 0, executionMode })
    callbacks?.onStateChange('found')
    callbacks?.onFound(result)
  }
  stop(): void {
    const wasRunning = this.state === 'running'
    this.runId++
    this.terminateWorkers()
    this.reportRuntime({ mode: 'idle', activeWorkers: 0, requestedWorkers: this.runtime.requestedWorkers })
    if (wasRunning) { this.state = 'stopped'; this.callbacks?.onStateChange('stopped') }
  }
  destroy(): void { this.stop(); this.callbacks = null; this.config = null }
}

let controllerInstance: VanityController | null = null
export function getVanityController(): VanityController {
  if (!controllerInstance) controllerInstance = new VanityController()
  return controllerInstance
}
