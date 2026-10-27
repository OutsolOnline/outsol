import { afterEach, describe, expect, it, vi } from 'vitest'
import { readBoundedResponse } from '../src/lib/server/rehearsal/bounded'

afterEach(() => vi.useRealTimers())
describe('rehearsal response byte limits', () => {
  it('decodes split UTF-8 only after enforcing the encoded byte limit', async () => {
    const bytes = new TextEncoder().encode('ş🙂')
    const stream = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.slice(0,1));controller.enqueue(bytes.slice(1,4));controller.enqueue(bytes.slice(4));controller.close()}})
    expect(await readBoundedResponse(new Response(stream),6)).toBe('ş🙂')
    await expect(readBoundedResponse(new Response(bytes),5)).rejects.toThrow(/limit|large/i)
  })
  it('cancels an oversized streaming response before accumulating the rest of its body', async () => {
    let cancelled = false, pulls = 0
    const stream = new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(100))},cancel(){cancelled=true}})
    await expect(readBoundedResponse(new Response(stream),150)).rejects.toThrow(/limit|large/i)
    expect(cancelled).toBe(true);expect(pulls).toBeLessThanOrEqual(3)
  })
  it('rejects an oversized declared content length without reading the body', async () => {
    let cancelled=false
    const response=new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true}}),{headers:{'Content-Length':'1000000'}})
    await expect(readBoundedResponse(response,100)).rejects.toThrow(/limit|large/i)
    expect(cancelled).toBe(true)
  })
  it('times out and cancels a response body that never produces a chunk', async () => {
    vi.useFakeTimers();let cancelled=false
    const response=new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true}}))
    const promise=readBoundedResponse(response,100).then(()=>null,error=>error as Error)
    await vi.advanceTimersByTimeAsync(10001)
    expect((await promise)?.message).toMatch(/time/i);expect(cancelled).toBe(true)
  })
  it('does not disable its cap when given a non-finite or negative limit', async () => {
    for(const limit of [NaN,Infinity,-1,0,1.5])await expect(readBoundedResponse(new Response('small'),limit)).rejects.toThrow(/limit/i)
  })
})
