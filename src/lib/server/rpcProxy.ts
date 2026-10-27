import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import { isAllowedRequestOrigin } from './requestOrigin'

const METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getBalance', 'getLatestBlockhash', 'getEpochInfo', 'getGenesisHash', 'getBlockTime',
  'getBlockHeight', 'getSlot', 'getSignatureStatuses', 'getTransaction',
  'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getTokenSupply',
  'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getRecentPrioritizationFees',
  'getVersion', 'getHealth', 'isBlockhashValid', 'simulateTransaction', 'simulateBundle', 'sendTransaction',
])
const MAX_BODY = 65_536
const MAX_RESPONSE = 2_097_152

class HttpError extends Error { constructor(public status: number) { super('Request rejected') } }

async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}) }, 15_000)
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (timedOut) throw new HttpError(408)
      if (done) break
      length += value.byteLength
      if (length > limit) { await reader.cancel(); throw new HttpError(413) }
      chunks.push(value)
    }
  } finally { clearTimeout(timer); reader.releaseLock() }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(result)
}

function validateCall(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const call = value as Record<string, unknown>
  if (call.jsonrpc !== '2.0' || typeof call.method !== 'string' || !METHODS.has(call.method)) return false
  if (!(typeof call.id === 'string' || typeof call.id === 'number' || call.id === null)) return false
  if (typeof call.id === 'string' && call.id.length > 128) return false
  if (call.params !== undefined && !Array.isArray(call.params)) return false
  if (Object.keys(call).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key))) return false
  if (call.method === 'getProgramAccounts') {
    const config = (call.params as unknown[])?.[1] as { filters?: unknown[]; dataSlice?: { length?: number } } | undefined
    if (!Array.isArray(config?.filters) || !config.filters.length || config.filters.length > 8) return false
    if (config.dataSlice && (!Number.isInteger(config.dataSlice.length) || config.dataSlice.length! > 4096 || config.dataSlice.length! < 0)) return false
  }
  if (call.method === 'simulateBundle') {
    const params = call.params as unknown[]
    const bundle = params?.[0] as { encodedTransactions?: unknown[] } | undefined
    const config = params?.[1] as Record<string, unknown> | undefined
    const transactions = bundle?.encodedTransactions
    if (params?.length !== 2 || !bundle || Object.keys(bundle).some(key => key !== 'encodedTransactions')) return false
    if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > 5 || transactions.some(tx => typeof tx !== 'string' || tx.length < 1 || tx.length > 1648 || !/^[A-Za-z0-9+/]+={0,2}$/.test(tx))) return false
    if (!config || config.transactionEncoding !== 'base64' || typeof config.skipSigVerify !== 'boolean' || typeof config.replaceRecentBlockhash !== 'boolean') return false
    if (!config.skipSigVerify && config.replaceRecentBlockhash) return false
    if (Object.keys(config).some(key => !['transactionEncoding', 'skipSigVerify', 'replaceRecentBlockhash', 'preExecutionAccountsConfigs', 'postExecutionAccountsConfigs'].includes(key))) return false
    let snapshotCount = 0
    for (const key of ['preExecutionAccountsConfigs', 'postExecutionAccountsConfigs']) {
      const accounts = config[key]
      if (!Array.isArray(accounts) || accounts.length !== transactions.length) return false
      for (const value of accounts) {
        if (value === null) continue
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        if (Object.keys(value).some(field => !['encoding', 'addresses'].includes(field))) return false
        if (value.encoding !== 'base64' || !Array.isArray(value.addresses) || value.addresses.length > 20) return false
        snapshotCount += value.addresses.length
        if (snapshotCount > 40) return false
        try {
          for (const address of value.addresses) {
            if (typeof address !== 'string') return false
            new PublicKey(address)
          }
        } catch { return false }
      }
    }
  }
  if (call.method === 'sendTransaction') {
    try {
      const params = call.params as unknown[]
      if (typeof params?.[0] !== 'string' || params[0].length > 1800) return false
      if ((params[1] as { encoding?: string } | undefined)?.encoding !== 'base64') return false
      const tx = VersionedTransaction.deserialize(Buffer.from(params[0], 'base64'))
      if (!tx.signatures.length || tx.signatures.some(signature => signature.every(byte => byte === 0))) return false
    } catch { return false }
  }
  return true
}

/** Limits are per process; use Railway edge limits as an additional shared boundary. */
export function createRpcHandler(upstreamFetch: typeof fetch = fetch) {
  const clients = new Map<string, { count: number; expires: number }>()
  let globalWindow = { count: 0, expires: 0 }
  return async function handleRpc(request: Request): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
    const reject = (status: number, message: string) => Response.json({ error: message }, { status, headers })
    try {
      if (!isAllowedRequestOrigin(request)) return reject(403, 'Origin not allowed')
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reject(415, 'JSON required')
      const now = Date.now()
      if (now >= globalWindow.expires) globalWindow = { count: 0, expires: now + 60_000 }
      // A reviewed 20-wallet fund + withdraw flow needs about 250 requests,
      // including confirmation polling. Keep bounded headroom and aggregate limits.
      // Bound both client traffic and aggregate use, even if forwarded client addresses are spoofed.
      const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown'
      if (clients.size > 5000) for (const [key, value] of clients) if (value.expires <= now) clients.delete(key)
      if (clients.size > 5000 && !clients.has(client)) return reject(429, 'RPC busy; retry shortly')
      const quota = clients.get(client)
      const current = quota && quota.expires > now ? quota : { count: 0, expires: now + 60_000 }
      clients.set(client, current)
      if (++current.count > 300 || ++globalWindow.count > 600) return reject(429, 'RPC rate limit; retry shortly')
      const contentLength = Number(request.headers.get('content-length'))
      if (contentLength > MAX_BODY) return reject(413, 'Request too large')
      let body: unknown
      try { body = JSON.parse(await boundedText(request.body, MAX_BODY)) } catch (error) {
        return reject(error instanceof HttpError ? error.status : 400, 'Invalid RPC request')
      }
      const calls = Array.isArray(body) ? body : [body]
      if (!calls.length || calls.length > 10 || !calls.every(validateCall)) return reject(400, 'RPC method or parameters not allowed')
      current.count += calls.length - 1
      globalWindow.count += calls.length - 1
      if (current.count > 300 || globalWindow.count > 600) return reject(429, 'RPC rate limit; retry shortly')
      const endpoint = process.env.RPC_URL || (process.env.NODE_ENV !== 'production' ? 'https://api.mainnet-beta.solana.com' : '')
      if (!endpoint) return reject(503, 'RPC provider is not configured')
      const provider = new URL(endpoint)
      if (provider.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && provider.hostname === 'localhost')) return reject(503, 'RPC provider is not configured')
      const response = await upstreamFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'error' })
      if (!response.ok) return reject(response.status === 429 ? 429 : 502, 'RPC provider unavailable')
      const data = JSON.parse(await boundedText(response.body, MAX_RESPONSE))
      const sanitize = (item: Record<string, unknown>) => item.error
        ? { jsonrpc: '2.0', id: item.id, error: { code: (item.error as { code?: number }).code || -32603, message: 'RPC request failed' } }
        : { jsonrpc: '2.0', id: item.id, result: item.result }
      return Response.json(Array.isArray(data) ? data.map(sanitize) : sanitize(data), { headers })
    } catch { return reject(502, 'RPC provider unavailable') }
  }
}
