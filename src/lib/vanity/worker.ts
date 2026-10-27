import { Keypair } from '@solana/web3.js'
import { matchesPattern, validatePattern } from './base58'
import type { VanityConfig, WorkerMessage, WorkerResponse } from './types'

type WorkerScope = { document?: unknown; onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null; postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void }
const scope = globalThis as unknown as WorkerScope
let generation = 0
let timer: ReturnType<typeof setTimeout> | null = null

function stop() { generation++; if (timer !== null) clearTimeout(timer); timer = null }

function start(config: VanityConfig, runId: number, workerId: number) {
  stop()
  const current = generation
  let attempts = 0
  const startedAt = performance.now()
  const grind = () => {
    timer = null
    if (generation !== current) return
    try {
      const batchStarted = performance.now()
      for (let index = 0; index < 256; index++) {
        const keypair = Keypair.generate()
        attempts++
        const publicKey = keypair.publicKey.toBase58()
        if (matchesPattern(publicKey, config.pattern, config.mode, config.caseSensitive)) {
          const secretKey = new Uint8Array(keypair.secretKey)
          scope.postMessage({ type: 'found', runId, workerId, result: { publicKey, secretKey, attempts, elapsed: performance.now() - startedAt } }, [secretKey.buffer])
          generation++
          return
        }
        if (performance.now() - batchStarted >= 25) break
      }
      scope.postMessage({ type: 'progress', runId, workerId, progress: { attempts, elapsed: (performance.now() - startedAt) / 1000 } })
      if (generation === current) timer = setTimeout(grind, 0)
    } catch { stop(); scope.postMessage({ type: 'error', runId, workerId, error: 'Local worker generation failed' }) }
  }
  timer = setTimeout(grind, 0)
}

if (typeof scope.postMessage === 'function' && typeof scope.document === 'undefined') {
  scope.onmessage = event => {
    const message = event.data
    if (!message || !Number.isSafeInteger(message.runId) || !Number.isInteger(message.workerId)) return
    if (message.type === 'stop') { stop(); scope.postMessage({ type: 'stopped', runId: message.runId, workerId: message.workerId }); return }
    if (message.type !== 'start' || !message.config || !validatePattern(message.config.pattern).isValid || !['prefix', 'suffix', 'contains'].includes(message.config.mode)) {
      scope.postMessage({ type: 'error', runId: message.runId, workerId: message.workerId, error: 'Invalid worker configuration' }); return
    }
    start(message.config, message.runId, message.workerId)
  }
}
