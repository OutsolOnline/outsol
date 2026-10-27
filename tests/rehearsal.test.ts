import { describe, expect, it } from 'vitest'
import { parseRehearsalInput } from '../src/lib/server/rehearsal/input'
import { RehearsalQueue } from '../src/lib/server/rehearsal/queue'
import { isReadonlyUpstreamMethod, assertLoopbackEndpoint, canonicalReadonlyRpcPayload } from '../src/lib/server/rehearsal/runtime'
import type { RehearsalReport } from '../src/lib/server/rehearsal/types'

const input = { name: 'Rehearsal', symbol: 'TRY', metadataUri: 'https://example.com/metadata.json', initialBuySol: '0.1', priorityFeeSol: '0', jitoTipSol: '0.00001' }

describe('public rehearsal boundaries', () => {
  it('accepts only the six public plan fields with exact decimal SOL amounts', () => {
    expect(parseRehearsalInput(input)).toEqual({...input,creatorFeeSelection:{kind:'deployer'}})
    for (const key of ['privateKey', 'transactions', 'rpcUrl', 'payer', 'mint']) expect(() => parseRehearsalInput({ ...input, [key]: 'never-accepted' })).toThrow()
    for (const initialBuySol of ['-1', '1e2', '0.0000000001', '1001', 1]) expect(() => parseRehearsalInput({ ...input, initialBuySol })).toThrow()
    expect(() => parseRehearsalInput({ ...input, name: '😀'.repeat(9) })).toThrow()
    expect(() => parseRehearsalInput({ ...input, metadataUri: 'file:///etc/passwd' })).toThrow()
  })

  it('allows remote reads and physically rejects every upstream submission surface', () => {
    for (const method of ['getAccountInfo', 'getMultipleAccounts', 'getGenesisHash', 'getEpochInfo']) expect(isReadonlyUpstreamMethod(method)).toBe(true)
    for (const method of ['sendTransaction', 'sendBundle', 'requestAirdrop', 'simulateBundle', 'surfnet_setAccount', 'getUnknown']) expect(isReadonlyUpstreamMethod(method)).toBe(false)
    expect(() => assertLoopbackEndpoint('https://api.mainnet-beta.solana.com')).toThrow()
    expect(() => assertLoopbackEndpoint('http://127.0.0.1:18999?rpc=bad')).toThrow()
    expect(() => assertLoopbackEndpoint('http://127.0.0.1:18999')).not.toThrow()
  })
  it('forwards only normalized, vetted RPC envelopes so raw duplicate method fields cannot reach upstream',()=>{
    const normalized=canonicalReadonlyRpcPayload('{"jsonrpc":"2.0","id":1,"method":"sendTransaction","method":"getBalance","params":[]}')
    expect(normalized).not.toContain('sendTransaction')
    expect(JSON.parse(normalized)).toEqual({jsonrpc:'2.0',id:1,method:'getBalance',params:[]})
    for(const value of [{jsonrpc:'2.0',id:1,method:'sendTransaction',params:[]},{jsonrpc:'2.0',id:1,method:'getBalance',params:[],forwardMethod:'sendTransaction'},{jsonrpc:'2.0',id:1,method:'getBalance',params:'wrong'},[]])expect(()=>canonicalReadonlyRpcPayload(JSON.stringify(value))).toThrow()
  })
  it('normalizes Surfpool Rust RPC no-argument reads with params:null', () => {
    for (const method of ['getEpochSchedule', 'getGenesisHash']) expect(JSON.parse(canonicalReadonlyRpcPayload(JSON.stringify({ jsonrpc: '2.0', id: 0, method, params: null })))).toEqual({ jsonrpc: '2.0', id: 0, method, params: [] })
  })
})

describe('bounded rehearsal queue', () => {
  it('runs one job, queues three, refuses excess work, and cancels pending work', async () => {
    let release!: () => void
    let active = 0, peak = 0
    const wait = new Promise<void>(resolve => { release = resolve })
    const queue = new RehearsalQueue(async () => { active++; peak = Math.max(peak, active); await wait; active--; return {} as RehearsalReport })
    const first = queue.submit(input)
    const queued = [queue.submit(input), queue.submit(input), queue.submit(input)]
    expect(() => queue.submit(input)).toThrow('busy')
    expect(queue.read(first.id)?.status).toBe('running')
    expect(queue.cancel(queued[0].id)?.status).toBe('cancelled')
    release()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(peak).toBe(1)
    expect(queue.read(first.id)?.status).toBe('succeeded')
    expect(queue.read(queued[0].id)?.status).toBe('cancelled')
  })

  it('aborts active work and returns a bounded public error', async () => {
    const queue = new RehearsalQueue(async (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('https://provider.invalid/private-token')))))
    const job = queue.submit(input)
    queue.cancel(job.id)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(queue.read(job.id)?.status).toBe('cancelled')
    expect(JSON.stringify(queue.read(job.id))).not.toContain('private-token')
    expect(queue.read('not-an-opaque-id')).toBeUndefined()
  })
})
