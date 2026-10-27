import { MatchMode } from './base58'

export interface VanityConfig {
  pattern: string
  mode: MatchMode
  caseSensitive: boolean
  threads: number
  stopAfter: number
}

export interface VanityResult {
  publicKey: string
  secretKey: Uint8Array
  attempts: number
  elapsed: number
}

export interface VanityProgress {
  attempts: number
  attemptsPerSecond: number
  elapsed: number
  activeWorkers?: number
  executionMode?: 'workers' | 'main-thread'
}

export interface VanityRuntimeStatus {
  mode: 'idle' | 'workers' | 'main-thread'
  activeWorkers: number
  requestedWorkers: number
  fallbackReason?: string
}

export interface WorkerMessage {
  type: 'start' | 'stop'
  config?: VanityConfig
  workerId: number
  runId: number
}

export interface WorkerResponse {
  type: 'progress' | 'found' | 'error' | 'stopped'
  workerId: number
  runId: number
  progress?: {
    attempts: number
    elapsed: number
  }
  result?: {
    publicKey: string
    secretKey: Uint8Array | number[]
    attempts: number
    elapsed: number
  }
  error?: string
}
