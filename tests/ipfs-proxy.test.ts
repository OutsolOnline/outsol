import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

function request(file: Blob, origin = 'https://vanity.example') {
  const form = new FormData()
  form.append('file', file, 'token.png')
  form.append('name', 'Test')
  form.append('symbol', 'TEST')
  form.append('description', 'Test description')
  return new NextRequest('https://vanity.example/api/ipfs', { method: 'POST', headers: { origin }, body: form })
}
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('rejects SVG and cross-origin uploads before contacting upstream', async () => {
  vi.stubGlobal('fetch', () => { throw new Error('must not call upstream') })
  const { POST } = await import('../app/api/ipfs/route')
  expect((await POST(request(new Blob(['<svg/>'], { type: 'image/svg+xml' })))).status).toBe(400)
  expect((await POST(request(new Blob(['x'], { type: 'image/png' }), 'https://evil.example'))).status).toBe(403)
})

it('rejects an oversized upload without buffering its body', async () => {
  const { POST } = await import('../app/api/ipfs/route')
  const req = request(new Blob(['x'], { type: 'image/png' }))
  req.headers.set('content-length', String(6 * 1024 * 1024))
  expect((await POST(req)).status).toBe(413)
})

it('accepts the public browser origin behind the deployment proxy and rejects foreign origins', async () => {
  vi.stubEnv('PUBLIC_APP_URL', 'https://vanity.example')
  const { POST } = await import('../app/api/ipfs/route')
  const proxied = (origin: string) => new NextRequest('http://localhost:3000/api/ipfs', {
    method: 'POST', headers: { origin, 'x-forwarded-host': 'evil.example' },
  })
  // Correct-origin requests reach content validation; foreign origins stop first.
  expect((await POST(proxied('https://vanity.example'))).status).toBe(415)
  expect((await POST(proxied('https://evil.example'))).status).toBe(403)
  expect((await POST(proxied('http://localhost:3000'))).status).toBe(403)
})

it('forwards a valid raster upload and returns only public metadata fields', async () => {
  vi.stubEnv('IPFS_API_URL', 'https://metadata.example/upload')
  vi.stubGlobal('fetch', async () => Response.json({ metadataUri: 'https://ipfs.example/test', metadata: { name: 'Test', symbol: 'TEST' }, internal: 'do-not-return' }))
  const { POST } = await import('../app/api/ipfs/route')
  const response = await POST(request(new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' })))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ metadataUri: 'https://ipfs.example/test', metadata: { name: 'Test', symbol: 'TEST' } })
})

it('uploads public image and metadata to Pinata while keeping its credential server-side', async () => {
  vi.stubEnv('PINATA_JWT', 'test-provider-credential')
  const imageCid = 'Qm' + 'a'.repeat(44)
  const metadataCid = 'Qm' + 'b'.repeat(44)
  const uploaded: FormData[] = []
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    expect(url).toBe('https://uploads.pinata.cloud/v3/files')
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-provider-credential')
    const form = options.body as FormData
    expect(form.get('network')).toBe('public')
    uploaded.push(form)
    return Response.json({ data: { cid: uploaded.length === 1 ? imageCid : metadataCid } })
  })
  const { POST } = await import('../app/api/ipfs/route')
  const response = await POST(request(new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' })))
  expect(response.status).toBe(200)
  expect(uploaded).toHaveLength(2)
  const metadata = JSON.parse(await (uploaded[1].get('file') as Blob).text())
  expect(metadata.image).toBe(`https://ipfs.io/ipfs/${imageCid}`)
  expect(metadata.name).toBe('Test')
  const result = await response.text()
  expect(result).toContain(metadataCid)
  expect(result).not.toContain('test-provider-credential')
})
