import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair, VersionedTransaction, TransactionMessage, SystemProgram } from '@solana/web3.js'
import { encryptWalletSecret, decryptWalletSecret } from '../src/lib/walletVault'
import { createRpcHandler } from '../src/lib/server/rpcProxy'

afterEach(() => vi.unstubAllEnvs())

describe('browser wallet vault', () => {
  it('encrypts a secret with a passphrase and restores it only with that passphrase', async () => {
    const secret = 'test-only-wallet-secret'
    const vault = await encryptWalletSecret(secret, 'a long test passphrase', 'public-address')
    expect(JSON.stringify(vault)).not.toContain(secret)
    expect(await decryptWalletSecret(vault, 'a long test passphrase')).toBe(secret)
    await expect(decryptWalletSecret(vault, 'wrong passphrase')).rejects.toThrow()
  })
  it('rejects short passphrases and tampered ciphertext', async () => {
    await expect(encryptWalletSecret('secret', 'short', 'public')).rejects.toThrow()
    const vault = await encryptWalletSecret('secret', 'a long test passphrase', 'public')
    vault.publicKey = 'changed-address'
    await expect(decryptWalletSecret(vault, 'a long test passphrase')).rejects.toThrow()
  })
})

describe('bounded Solana RPC proxy', () => {
  function request(body: unknown, origin = 'https://vanity.example') {
    return new Request('https://vanity.example/api/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
    })
  }
  it('rejects cross-origin and signing methods without contacting the provider', async () => {
    let calls = 0
    const handler = createRpcHandler(async () => { calls++; return new Response('{}') })
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [] }, 'https://evil.example'))).status).toBe(403)
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'signTransaction', params: ['secret'] }))).status).toBe(400)
    expect(calls).toBe(0)
  })
  it('forwards an allowed read using only the private provider URL', async () => {
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    let destination = ''
    const handler = createRpcHandler(async (url) => { destination = String(url); return Response.json({ jsonrpc: '2.0', id: 1, result: 42 }) })
    const response = await handler(request({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }))
    expect(destination).toBe('https://rpc.example/private-token')
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: 42 })
  })
  it('uses the configured public origin behind a reverse proxy without trusting forwarded hosts', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://vanity.example')
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    const upstream = vi.fn(async () => Response.json({ jsonrpc: '2.0', id: 1, result: 42 }))
    const handler = createRpcHandler(upstream)
    const proxied = (origin: string) => new Request('http://localhost:3000/api/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }),
    })
    expect((await handler(proxied('https://vanity.example'))).status).toBe(200)
    expect((await handler(proxied('https://evil.example'))).status).toBe(403)
    expect((await handler(proxied('http://localhost:3000'))).status).toBe(403)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it('rejects unsigned transaction submission and oversized requests', async () => {
    const payer = Keypair.generate()
    const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message()
    const unsigned = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64')
    const handler = createRpcHandler(async () => { throw new Error('must not forward') })
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [unsigned, { encoding: 'base64' }] }))).status).toBe(400)
    expect((await handler(request({ padding: 'x'.repeat(65537) }))).status).toBe(413)
  })
  it('does not expose a provider credential when the provider fails', async () => {
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    const handler = createRpcHandler(async () => { throw new Error('https://rpc.example/private-token failed') })
    const response = await handler(request({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-token')
  })
  it('throttles repeated requests and refuses unfiltered program scans', async () => {
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    const handler = createRpcHandler(async () => Response.json({ jsonrpc: '2.0', id: 1, result: 42 }))
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: ['program'] }))).status).toBe(400)
    for (let index = 0; index < 299; index++) expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }))).status).toBe(200)
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }))).status).toBe(429)
  })
  it('scrubs provider errors and refuses an oversized provider response', async () => {
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    const handler = createRpcHandler(async () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'private-token', data: 'private-token' } }))
    const response = await handler(request({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }))
    expect(await response.text()).not.toContain('private-token')
    const oversized = createRpcHandler(async () => new Response('x'.repeat(2_097_153)))
    expect((await oversized(request({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [] }))).status).toBe(502)
  })
  it('allows bounded read-only bundle simulation and rejects oversized bundles', async () => {
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    const handler = createRpcHandler(async () => Response.json({ jsonrpc: '2.0', id: 1, result: { summary: 'succeeded' } }))
    const params = [{ encodedTransactions: ['AQ=='] }, { transactionEncoding: 'base64', skipSigVerify: true, replaceRecentBlockhash: true, preExecutionAccountsConfigs: [null], postExecutionAccountsConfigs: [null] }]
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params }))).status).toBe(200)
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [params[0], { ...params[1], skipSigVerify: false, replaceRecentBlockhash: false }] }))).status).toBe(200)
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [{ encodedTransactions: Array(6).fill('AQ==') }, params[1]] }))).status).toBe(400)
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [{ encodedTransactions: ['a'.repeat(1649)] }, params[1]] }))).status).toBe(400)
  })
  it('allows bounded wallet balance snapshots without account overrides', async () => {
    vi.stubEnv('RPC_URL', 'https://rpc.example/private-token')
    const handler = createRpcHandler(async () => Response.json({ jsonrpc: '2.0', id: 1, result: { summary: 'succeeded' } }))
    const address = Keypair.generate().publicKey.toBase58()
    const config = { transactionEncoding: 'base64', skipSigVerify: true, replaceRecentBlockhash: true, preExecutionAccountsConfigs: [{ encoding: 'base64', addresses: [address, address] }], postExecutionAccountsConfigs: [{ encoding: 'base64', addresses: [address] }] }
    const call = (options: unknown) => request({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [{ encodedTransactions: ['AQ=='] }, options] })
    expect((await handler(call(config))).status).toBe(200)
    expect((await handler(call({ ...config, postExecutionAccountsConfigs: [{ encoding: 'base64', addresses: ['not-a-public-key'] }] }))).status).toBe(400)
    expect((await handler(call({ ...config, preExecutionAccountsConfigs: [{ encoding: 'base64', addresses: Array(20).fill(address) }], postExecutionAccountsConfigs: [{ encoding: 'base64', addresses: Array(20).fill(address) }] }))).status).toBe(200)
    expect((await handler(call({ ...config, postExecutionAccountsConfigs: [{ encoding: 'base64', addresses: Array(21).fill(address) }] }))).status).toBe(400)
    const snapshot = { encoding: 'base64', addresses: Array(11).fill(address) }
    expect((await handler(request({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [{ encodedTransactions: ['AQ==','AQ=='] }, { ...config, preExecutionAccountsConfigs: [snapshot,snapshot], postExecutionAccountsConfigs: [snapshot,snapshot] }] }))).status).toBe(400)
    expect((await handler(call({ ...config, postExecutionAccountsConfigs: [{ encoding: 'base64', addresses: [address], overrides: {} }] }))).status).toBe(400)
  })
})
