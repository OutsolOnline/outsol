import { describe, expect, it } from 'vitest'
import { Connection, Keypair } from '@solana/web3.js'
import { buildCreateTransaction } from '../src/lib/pumpfun/api'
import { readTokenFacts } from '../src/lib/tokenFacts'
import { confirmSignatures, sendAndConfirmTransaction } from '../src/lib/transactions/send'

describe.skipIf(process.env.RUN_TOKEN_FACTS_LOCAL !== '1')('token facts from an actually executed fresh Pump mint', () => {
  it('reports actual immutable mint metadata, authorities, supply and reserves', async () => {
    const endpoint = 'http://127.0.0.1:8899'
    const rpc = async (method: string) => (await (await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) })).json()).result
    expect((await rpc('getVersion'))['surfnet-version']).toBe('1.6.1')
    expect((await rpc('surfnet_getSurfnetInfo')).value.startup.phase).toBe('ready')
    const payer = Keypair.generate(), mint = Keypair.generate()
    const localFetch: typeof fetch = (resource, init) => {
      if (new URL(String(resource)).origin !== new URL(endpoint).origin) throw new Error('Non-local request rejected')
      return fetch(resource, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) })
    }
    const connection = new Connection(endpoint, { commitment: 'confirmed', fetch: localFetch })
    const airdrop = await connection.requestAirdrop(payer.publicKey, 100_000_000_000)
    expect((await confirmSignatures(connection, [airdrop], { timeoutMs: 10_000, pollIntervalMs: 100 })).status).toBe('confirmed')
    const built = await buildCreateTransaction({ connection, userPublicKey: payer.publicKey.toBase58(), mintKeypair: mint, metadata: { name: 'Token Facts Proof', symbol: 'FACTS', description: '' }, metadataUri: 'https://example.com/facts.json', initialBuyAmount: 0.01, priorityFee: 0 })
    expect(built.success, built.error).toBe(true)
    expect(built.requiresAtomicBundle).toBe(false)
    const tx = built.transaction!; tx.sign([payer])
    expect((await sendAndConfirmTransaction(connection, tx, { timeoutMs: 20_000, pollIntervalMs: 100 })).status).toBe('confirmed')
    const facts = await readTokenFacts(connection, mint.publicKey.toBase58())
    expect(facts).toMatchObject({ mint: mint.publicKey.toBase58(), name: 'Token Facts Proof', symbol: 'FACTS', metadataUri: 'https://example.com/facts.json', mintAuthority: null, freezeAuthority: null, metadataAuthority: null, curveStatus: 'active', creator: payer.publicKey.toBase58() })
    expect(facts.supplyRaw).toBe(built.nativeContext!.global.tokenTotalSupply.toString())
    expect(facts.metadataPointerAuthority).toBeNull()
    expect(facts.curveSolRaw).toBe(built.nativeContext!.curve.realQuoteReserves.toString())
    expect(BigInt(facts.curveSolRaw!)).toBeGreaterThan(0n)
    expect(facts.slot).toBeGreaterThan(0)
  }, 40_000)
})
