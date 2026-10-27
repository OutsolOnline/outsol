import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedResponse } from './bounded'

export const SURFPOOL_VERSION = '1.6.1'
const OWN_ENDPOINT = 'http://127.0.0.1:18999'
const UPSTREAM_ENDPOINT = 'http://127.0.0.1:18898'
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111'
const SYSVAR_OWNER = 'Sysvar1111111111111111111111111111111111111'
const READ_METHODS = new Set(['getAccountInfo', 'getBalance', 'getBlock', 'getBlockHeight', 'getBlockTime', 'getEpochInfo', 'getEpochSchedule', 'getFeeForMessage', 'getGenesisHash', 'getHealth', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption', 'getMultipleAccounts', 'getProgramAccounts', 'getRecentPrioritizationFees', 'getSignatureStatuses', 'getSignaturesForAddress', 'getSlot', 'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getTokenSupply', 'getTransaction', 'getVersion', 'isBlockhashValid'])
export function isReadonlyUpstreamMethod(method: unknown): boolean { return typeof method === 'string' && READ_METHODS.has(method) }
/** Forward the parsed, allowlisted envelope, never unvalidated original JSON text. */
export function canonicalReadonlyRpcPayload(body: string): string {
  const payload: unknown = JSON.parse(body), calls = Array.isArray(payload) ? payload : [payload]
  if (!calls.length || calls.length > 10 || calls.some(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true
    const call = value as Record<string, unknown>
    return Object.keys(call).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key)) || call.jsonrpc !== '2.0'
      || !isReadonlyUpstreamMethod(call.method) || (call.params !== undefined && call.params !== null && !Array.isArray(call.params))
      || !(call.id === null || typeof call.id === 'string' && call.id.length <= 128 || typeof call.id === 'number' && Number.isFinite(call.id))
  })) throw new Error('Read-only upstream method denied')
  // Solana's Rust client sends params:null for no-argument RPC reads.
  const normalized = calls.map(value => {
    const call = value as Record<string, unknown>
    return { jsonrpc: '2.0', id: call.id, method: call.method, params: call.params ?? [] }
  })
  return JSON.stringify(Array.isArray(payload) ? normalized : normalized[0])
}

export function assertLoopbackEndpoint(endpoint: string): URL {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Rehearsal requires a private loopback runtime')
  return url
}

export async function localRuntimeRpc<T = unknown>(endpoint: string, method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  assertLoopbackEndpoint(endpoint)
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), redirect: 'error', cache: 'no-store' })
  if (!response.ok) throw new Error('Local rehearsal RPC unavailable')
  const text = await readBoundedResponse(response, 20_000_000)
  const data = JSON.parse(text)
  if (data.error) throw new Error('Local rehearsal RPC rejected the operation')
  return data.result as T
}

interface RuntimeState { endpoint: string; child?: ChildProcess; bridge?: Server; directory?: string; upstreamAbort?: AbortController; idle?: ReturnType<typeof setTimeout> }
const globalRuntime = globalThis as typeof globalThis & { __vanityRehearsalRuntime?: RuntimeState; __vanityRehearsalExitHook?: boolean }
if (!globalRuntime.__vanityRehearsalExitHook) {
  globalRuntime.__vanityRehearsalExitHook = true
  process.once('exit', () => { globalRuntime.__vanityRehearsalRuntime?.child?.kill('SIGTERM') })
}

async function requireFreePort(port: number): Promise<void> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise<void>(resolve => probe.close(() => resolve()))
}

async function readRequest(request: import('node:http').IncomingMessage): Promise<string> {
  request.setTimeout(5000, () => request.destroy())
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 1_048_576) throw new Error('Request limit')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function startReadonlyBridge(upstream: string, controller: AbortController): Promise<Server> {
  let windowStart = Date.now(), requests = 0
  const bridge = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    try {
      const now = Date.now()
      if (now - windowStart >= 60_000) { windowStart = now; requests = 0 }
      if (++requests > 1000 || request.method !== 'POST') { response.writeHead(403); response.end('{}'); return }
      const body = await readRequest(request)
      let vettedBody: string
      try { vettedBody = canonicalReadonlyRpcPayload(body) } catch {
        response.writeHead(403); response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Read-only upstream method denied' } })); return
      }
      const remote = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: vettedBody, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]), redirect: 'error', cache: 'no-store' })
      if (!remote.ok) throw new Error('Upstream unavailable')
      const output = await readBoundedResponse(remote, 20_000_000)
      response.writeHead(200); response.end(output)
    } catch {
      response.writeHead(502); response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Read-only state source unavailable' } }))
    }
  })
  bridge.maxConnections = 20
  bridge.requestTimeout = 15_000
  await new Promise<void>((resolve, reject) => { bridge.once('error', reject); bridge.listen(18898, '127.0.0.1', resolve) })
  return bridge
}

export async function verifyRehearsalRuntime(endpoint: string, signal: AbortSignal): Promise<void> {
  assertLoopbackEndpoint(endpoint)
  const version = await localRuntimeRpc<Record<string, unknown>>(endpoint, 'getVersion', [], signal)
  if (version['surfnet-version'] !== SURFPOOL_VERSION) throw new Error('Unexpected local runtime version')
  const info = await localRuntimeRpc<{ value?: { startup?: { phase?: string } } }>(endpoint, 'surfnet_getSurfnetInfo', [], signal)
  if (info.value?.startup?.phase !== 'ready') throw new Error('Local runtime is not ready')
  if (await localRuntimeRpc<string>(endpoint, 'getGenesisHash', [], signal) !== MAINNET_GENESIS) throw new Error('Local runtime is not a mainnet-state fork')
}

/** Rent is fork state too. Never invent fee-account balances to fit VM defaults. */
async function alignMainnetRent(state: RuntimeState, signal: AbortSignal): Promise<void> {
  // An attached development VM still uses an explicitly configured read-only
  // state source for this one immutable sysvar read; production always uses bridge.
  const source = state.bridge ? UPSTREAM_ENDPOINT : process.env.NODE_ENV !== 'production' ? process.env.RPC_URL : undefined
  if (!source) throw new Error('Rehearsal rent state source is unavailable')
  const request = [
    { jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [RENT_SYSVAR, { encoding: 'base64', commitment: 'confirmed' }] },
    { jsonrpc: '2.0', id: 2, method: 'getMinimumBalanceForRentExemption', params: [0] },
    { jsonrpc: '2.0', id: 3, method: 'getMinimumBalanceForRentExemption', params: [8] },
    { jsonrpc: '2.0', id: 4, method: 'getMinimumBalanceForRentExemption', params: [165] },
  ]
  const response = await fetch(source, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), redirect: 'error', cache: 'no-store' })
  if (!response.ok) throw new Error('Rehearsal rent state source is unavailable')
  const payload = JSON.parse(await readBoundedResponse(response, 100000))
  if (!Array.isArray(payload) || payload.length !== 4 || payload.some(item => item.error)) throw new Error('Invalid mainnet rent response')
  const account = payload.find(item => item.id === 1)?.result?.value
  if (!account || account.owner !== SYSVAR_OWNER || account.executable !== false || !Number.isSafeInteger(account.lamports) || account.lamports <= 0 || !Array.isArray(account.data) || account.data[1] !== 'base64' || typeof account.data[0] !== 'string') throw new Error('Invalid mainnet rent account')
  const data = Buffer.from(account.data[0], 'base64')
  if (data.length !== 17 || data.toString('base64') !== account.data[0]) throw new Error('Invalid mainnet rent encoding')
  const perByte = data.readBigUInt64LE(0), threshold = data.readDoubleLE(8), burn = data[16]
  if (perByte <= 0n || perByte > 1_000_000_000n || !Number.isFinite(threshold) || threshold < 0.1 || threshold > 100 || burn > 100) throw new Error('Invalid mainnet rent parameters')
  const sizes = [0, 8, 165]
  const expected = sizes.map((size, index) => {
    const minimum = payload.find(item => item.id === index + 2)?.result
    if (!Number.isSafeInteger(minimum) || minimum <= 0 || minimum !== Math.trunc((size + 128) * Number(perByte) * threshold)) throw new Error('Inconsistent mainnet rent state')
    return minimum as number
  })
  await localRuntimeRpc(state.endpoint, 'surfnet_setAccount', [RENT_SYSVAR, { owner: SYSVAR_OWNER, executable: false, lamports: account.lamports, data: data.toString('hex') }], signal)
  for (let index = 0; index < sizes.length; index++) {
    const actual = await localRuntimeRpc<number>(state.endpoint, 'getMinimumBalanceForRentExemption', [sizes[index]], signal)
    if (actual !== expected[index]) throw new Error('Local runtime did not adopt mainnet rent state')
  }
}

export async function stopRehearsalRuntime(): Promise<void> {
  const state = globalRuntime.__vanityRehearsalRuntime
  if (!state) return
  delete globalRuntime.__vanityRehearsalRuntime
  if (state.idle) clearTimeout(state.idle)
  state.upstreamAbort?.abort()
  if (state.child && state.child.exitCode === null) {
    const child = state.child
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.kill('SIGTERM')
    })
  }
  state.bridge?.closeAllConnections()
  if (state.bridge) await new Promise<void>(resolve => state.bridge!.close(() => resolve()))
  if (state.directory) await rm(state.directory, { recursive: true, force: true })
}

export async function acquireRehearsalRuntime(signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  let state = globalRuntime.__vanityRehearsalRuntime
  if (state?.idle) clearTimeout(state.idle)
  if (!state) {
    const external = process.env.NODE_ENV !== 'production' ? process.env.LOCAL_REHEARSAL_RPC_URL : undefined
    if (external) {
      // Development may attach a dedicated fork. Never reset the separate audit fork.
      if (assertLoopbackEndpoint(external).port !== '18999') throw new Error('Use the dedicated rehearsal port')
      state = { endpoint: external }
      globalRuntime.__vanityRehearsalRuntime = state
    } else {
      const upstream = process.env.RPC_URL
      if (!upstream) throw new Error('Rehearsal state source is not configured')
      const source = new URL(upstream)
      if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Invalid rehearsal state source')
      const directory = await mkdtemp(join(tmpdir(), 'vanity-rehearsal-'))
      state = { endpoint: OWN_ENDPOINT, directory, upstreamAbort: new AbortController() }
      globalRuntime.__vanityRehearsalRuntime = state
      try {
        // Do not accidentally attach to another Surfpool process on these ports.
        await requireFreePort(18999)
        await requireFreePort(19000)
        state.bridge = await startReadonlyBridge(upstream, state.upstreamAbort!)
        signal.throwIfAborted()
        const binary = process.env.NODE_ENV === 'production' ? '/usr/local/bin/surfpool' : process.env.REHEARSAL_SURFPOOL_BINARY || '/usr/local/bin/surfpool'
        const child = spawn(binary, ['start', '--host', '127.0.0.1', '--port', '18999', '--ws-port', '19000', '--ci', '--no-deploy', '--airdrop-amount', '0'], { cwd: directory, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: directory, TMPDIR: directory, SURFPOOL_DATASOURCE_RPC_URL: UPSTREAM_ENDPOINT }, windowsHide: true, stdio: 'ignore' })
        state.child = child
        // Avoid exposing native process errors or any state-source details to API responses.
        child.on('error', () => {})
        const deadline = Date.now() + 20_000
        let ready = false
        while (Date.now() < deadline && !signal.aborted && child.exitCode === null) {
          try { await verifyRehearsalRuntime(state.endpoint, AbortSignal.any([signal, AbortSignal.timeout(1500)])); ready = true; break } catch { /* readiness is bounded by the deadline */ }
          await new Promise(resolve => setTimeout(resolve, 150))
        }
        if (!ready) throw new Error('Local rehearsal runtime failed to start')
      } catch (error) { await stopRehearsalRuntime(); throw error }
    }
  }
  try {
    await verifyRehearsalRuntime(state.endpoint, signal)
    await localRuntimeRpc(state.endpoint, 'surfnet_resetNetwork', [], signal)
    await verifyRehearsalRuntime(state.endpoint, signal)
    await alignMainnetRent(state, signal)
    return state.endpoint
  } catch (error) { await stopRehearsalRuntime(); throw error }
}

export async function releaseRehearsalRuntime(aborted = false): Promise<void> {
  const state = globalRuntime.__vanityRehearsalRuntime
  if (!state) return
  if (aborted && state.child) { await stopRehearsalRuntime(); return }
  try { await localRuntimeRpc(state.endpoint, 'surfnet_resetNetwork', [], AbortSignal.timeout(5000)) } catch { await stopRehearsalRuntime(); return }
  state.idle = setTimeout(() => { void stopRehearsalRuntime() }, 60_000)
  state.idle.unref?.()
}
