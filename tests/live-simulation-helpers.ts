import { appendFileSync, readFileSync } from 'node:fs'
import { Connection, PublicKey, type AccountInfo, type VersionedTransaction } from '@solana/web3.js'

// This module deliberately has no key loading, signing, airdrop or broadcast path.
const READ_METHOD = /^(get[A-Z]|isBlockhashValid$|simulateTransaction$|simulateBundle$)/
export const PUBLIC_SIMULATION_PAYER = new PublicKey('ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u')

export function readonlyEndpoint() {
  const endpoint = process.env.VANITY_TEST_RPC_URL || process.env.RPC_URL || readFileSync('.env.local', 'utf8').match(/^\s*RPC_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '')
  if (!endpoint) throw new Error('An RPC with complete-bank simulateBundle support is required; no live test was skipped')
  return endpoint
}

export const readonlyFetch: typeof fetch = async (input, init) => {
  const request = JSON.parse(String(init?.body))
  for (const call of Array.isArray(request) ? request : [request]) {
    if (typeof call.method !== 'string' || !READ_METHOD.test(call.method)) throw new Error('Read-only verification rejected a non-read RPC method')
  }
  const headers = new Headers(init?.headers)
  if (process.env.VANITY_TEST_RPC_ORIGIN) headers.set('Origin', process.env.VANITY_TEST_RPC_ORIGIN)
  try { return await fetch(input, { ...init, headers, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(25_000) }) }
  catch { throw new Error('Read-only RPC request failed; provider credentials suppressed') }
}

export function readonlyConnection() {
  const connection = new Connection(readonlyEndpoint(), { commitment: 'confirmed', fetch: readonlyFetch, disableRetryOnRateLimit: true })
  connection.sendRawTransaction = async () => { throw new Error('Read-only verification forbids broadcast') }
  connection.sendTransaction = async () => { throw new Error('Read-only verification forbids broadcast') }
  return connection
}

export function recordLiveEvidence(evidence: Record<string, unknown>) {
  const result = { timestamp: new Date().toISOString(), proof: 'unsigned-mainnet-bank-simulation', walletSigned: false, broadcast: false, ...evidence }
  if (process.env.VANITY_LIVE_EVIDENCE_FILE) appendFileSync(process.env.VANITY_LIVE_EVIDENCE_FILE, JSON.stringify(result) + '\n')
  console.log(JSON.stringify(result))
}

export interface SimulatedAccount { owner: string; data: [string, string]; lamports: number; executable: boolean; rentEpoch?: number }
export function simulatedAccountInfo(account: SimulatedAccount | null): AccountInfo<Buffer> {
  if (!account) throw new Error('Expected simulated account is absent')
  return { ...account, rentEpoch: account.rentEpoch ?? 0, owner: new PublicKey(account.owner), data: Buffer.from(account.data[0], 'base64') }
}

/** Repeat the same read-only bank execution in two-account windows, matching the
 * production proxy's bounded inspection allowance. No dependent tx is simulated
 * against a fresh bank: every window executes the complete ordered bundle. */
export async function inspectCompleteSimulation(connection: Connection, transactions: VersionedTransaction[], addresses: PublicKey[], beforeAddresses: PublicKey[] = []) {
  if (transactions.length < 1 || transactions.length > 5) throw new Error('Complete simulation requires 1–5 packets')
  for (const tx of transactions) {
    if (tx.serialize().length > 1232) throw new Error('Prepared transaction exceeds the 1232-byte packet limit')
    if (tx.signatures[0].some(byte => byte !== 0)) throw new Error('Read-only simulation requires an unsigned payer')
  }
  const postAccounts: (SimulatedAccount | null)[] = [], preAccounts: (SimulatedAccount | null)[] = []
  let unitsConsumed: number[] = []
  const windows = Math.max(1, Math.ceil(addresses.length / 2), Math.ceil(beforeAddresses.length / 2))
  for (let window = 0; window < windows; window++) {
    const post = addresses.slice(window * 2, window * 2 + 2), pre = beforeAddresses.slice(window * 2, window * 2 + 2)
    const response = await readonlyFetch(connection.rpcEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [{ encodedTransactions: transactions.map(tx => Buffer.from(tx.serialize()).toString('base64')) }, {
        transactionEncoding: 'base64', skipSigVerify: true, replaceRecentBlockhash: true,
        preExecutionAccountsConfigs: transactions.map((_, index) => index === 0 && pre.length ? { encoding: 'base64', addresses: pre.map(key => key.toBase58()) } : null),
        postExecutionAccountsConfigs: transactions.map((_, index) => index === transactions.length - 1 && post.length ? { encoding: 'base64', addresses: post.map(key => key.toBase58()) } : null),
      }],
    }) })
    if (!response.ok) throw new Error(`Read-only simulation HTTP status ${response.status}`)
    const body = await response.json()
    if (body.error) throw new Error(`Complete-bank simulateBundle unavailable or rejected (RPC code ${body.error.code}); explicit live runs never skip unsupported providers`)
    const value = body.result?.value
    if (value?.summary !== 'succeeded' || value.transactionResults?.length !== transactions.length || value.transactionResults.some((item: { err: unknown }) => item.err !== null)) {
      throw new Error(`Complete-bank simulation failed: ${JSON.stringify(value?.summary)}; errors ${JSON.stringify(value?.transactionResults?.map((item: { err: unknown }) => item.err))}; logs ${JSON.stringify(value?.transactionResults?.flatMap((item: { logs?: string[] }) => item.logs ?? []).slice(-20))}`)
    }
    const results = value.transactionResults
    const returnedPost = results.at(-1).postExecutionAccounts ?? [], returnedPre = results[0].preExecutionAccounts ?? []
    if (returnedPost.length !== post.length || returnedPre.length !== pre.length) throw new Error('Provider omitted required simulated account inspection data')
    postAccounts.push(...returnedPost); preAccounts.push(...returnedPre)
    unitsConsumed = results.map((item: { unitsConsumed?: number }) => item.unitsConsumed ?? 0)
  }
  return { postAccounts, preAccounts, unitsConsumed }
}
