import { NextRequest, NextResponse } from 'next/server'
import { storePublicTokenMetadata } from '@/lib/server/publicAssets'
import { isAllowedRequestOrigin } from '@/lib/server/requestOrigin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_BODY = MAX_IMAGE + 65_536
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const ALLOWED_FIELDS = new Set(['file', 'name', 'symbol', 'description', 'showName', 'twitter', 'telegram', 'website'])
const quotas = new Map<string, { count: number; expires: number }>()
let globalQuota = { count: 0, expires: 0 }

function validImage(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const text = new TextDecoder().decode(bytes)
  if (type === 'image/gif') return text.startsWith('GIF87a') || text.startsWith('GIF89a')
  return type === 'image/webp' && text.startsWith('RIFF') && text.slice(8,12) === 'WEBP'
}

async function readBody(request: Pick<Request, 'body'>, maximum: number): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing body')
  const chunks: Uint8Array[] = []
  let size = 0
  const timer = setTimeout(() => { reader.cancel().catch(() => {}) }, 10_000)
  const started = Date.now()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (Date.now() - started >= 10_000) throw new Error('Upload timeout')
      if (done) break
      size += value.byteLength
      if (size > maximum) { await reader.cancel(); throw new RangeError('Upload too large') }
      chunks.push(value)
    }
  } finally { clearTimeout(timer); reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  return body
}

export async function POST(request: NextRequest) {
  const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
  if (!isAllowedRequestOrigin(request)) return reply('Origin not allowed', 403)
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) return reply('Multipart upload required', 415)
  if (Number(request.headers.get('content-length')) > MAX_BODY) return reply('Image must be 5 MB or smaller', 413)
  const now = Date.now()
  if (globalQuota.expires <= now) globalQuota = { count: 0, expires: now + 60_000 }
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,64) || 'unknown'
  if (quotas.size > 5000) for (const [key, quota] of quotas) if (quota.expires <= now) quotas.delete(key)
  if (quotas.size > 5000 && !quotas.has(client)) return reply('Upload service busy; retry shortly', 429)
  const previous = quotas.get(client)
  const quota = previous && previous.expires > now ? previous : { count: 0, expires: now + 60_000 }
  quotas.set(client, quota)
  if (++quota.count > 10 || ++globalQuota.count > 60) return reply('Upload rate limit; retry shortly', 429)

  try {
    let form: FormData
    try {
      const body = await readBody(request, MAX_BODY)
      form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type')! }, body: body as BodyInit }).formData()
    } catch (error) { return reply(error instanceof RangeError ? 'Image must be 5 MB or smaller' : 'Invalid or timed out upload', error instanceof RangeError ? 413 : 400) }
    const fields = Array.from(form.keys())
    if (fields.some(key => !ALLOWED_FIELDS.has(key)) || new Set(fields).size !== fields.length) return reply('Unsupported or duplicate metadata field', 400)
    const image = form.get('file')
    if (!image || typeof image === 'string' || !TYPES.has(image.type) || image.size === 0) return reply('Upload a PNG, JPEG, WebP, or GIF image', 400)
    if (image.size > MAX_IMAGE) return reply('Image must be 5 MB or smaller', 413)
    if (!validImage(new Uint8Array(await image.slice(0,12).arrayBuffer()), image.type)) return reply('Image content does not match its file type', 400)
    const limits: Record<string, number> = { name: 32, symbol: 10, description: 1000, showName: 5, twitter: 300, telegram: 300, website: 300 }
    for (const [key, limit] of Object.entries(limits)) {
      const value = form.get(key)
      if (value !== null && (typeof value !== 'string' || value.length > limit)) return reply(`Invalid ${key}`, 400)
      if ((key === 'name' || key === 'symbol') && (typeof value !== 'string' || !value.trim())) return reply(`Missing ${key}`, 400)
      if (['twitter', 'telegram', 'website'].includes(key) && value) {
        try { if (new URL(value as string).protocol !== 'https:') return reply(`Use an HTTPS ${key} link`, 400) } catch { return reply(`Invalid ${key} link`, 400) }
      }
    }
    if (process.env.PINATA_JWT) {
      const upload = async (file: Blob, filename: string): Promise<string> => {
        const payload = new FormData()
        payload.append('network', 'public')
        payload.append('file', file, filename)
        const result = await fetch('https://uploads.pinata.cloud/v3/files', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
          body: payload, signal: AbortSignal.timeout(20_000), redirect: 'error', cache: 'no-store',
        })
        if (!result.ok) throw new Error('Metadata provider unavailable')
        const data = JSON.parse(new TextDecoder().decode(await readBody(result, 65_536)))
        const cid = data?.data?.cid
        if (typeof cid !== 'string' || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/.test(cid)) throw new Error('Invalid upload CID')
        return `https://ipfs.io/ipfs/${cid}`
      }
      const imageUri = await upload(image, `token-image.${image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1]}`)
      const metadata: Record<string, string | boolean> = {
        name: String(form.get('name')).trim(), symbol: String(form.get('symbol')).trim(),
        description: String(form.get('description') || ''), image: imageUri, showName: true,
      }
      for (const key of ['twitter', 'telegram', 'website']) if (form.get(key)) metadata[key] = String(form.get(key))
      const metadataUri = await upload(new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json')
      return NextResponse.json({ metadataUri, metadata: { name: metadata.name, symbol: metadata.symbol } }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (!process.env.IPFS_API_URL && process.env.ASSET_STORAGE_DIR && process.env.PUBLIC_APP_URL) {
      const fields: Record<string, string> = {}
      for (const key of ['name', 'symbol', 'description', 'twitter', 'telegram', 'website']) {
        const value = form.get(key)
        if (typeof value === 'string') fields[key] = value
      }
      try {
        const result = await storePublicTokenMetadata(new Uint8Array(await image.arrayBuffer()), image.type, fields)
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
      } catch { return reply('Public metadata storage is full or unavailable. Use an existing public metadata URI or retry later.', 503) }
    }
    if (!process.env.IPFS_API_URL) return reply('Metadata upload is not configured. Supply an existing public metadata URI.', 503)
    const endpoint = new URL(process.env.IPFS_API_URL)
    if (endpoint.protocol !== 'https:') return reply('Upload service is not configured', 503)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const upstream = await fetch(endpoint.toString(), { method: 'POST', body: form, signal: controller.signal, redirect: 'error', cache: 'no-store' })
      if (!upstream.ok) return reply('Metadata provider unavailable. Retry later or use the manual launch flow.', upstream.status === 429 ? 429 : 502)
      if (Number(upstream.headers.get('content-length')) > 65_536) return reply('Invalid metadata provider response', 502)
      // Bound untrusted upstream responses even when Content-Length is absent.
      const data = JSON.parse(new TextDecoder().decode(await readBody(upstream, 65_536)))
      if (typeof data.metadataUri !== 'string' || data.metadataUri.length > 2048 || !['https:', 'ipfs:'].includes(new URL(data.metadataUri).protocol)) return reply('Invalid metadata provider response', 502)
      return NextResponse.json({ metadataUri: data.metadataUri, metadata: { name: String(data.metadata?.name || form.get('name')).slice(0,32), symbol: String(data.metadata?.symbol || form.get('symbol')).slice(0,10) } }, { headers: { 'Cache-Control': 'no-store' } })
    } finally { clearTimeout(timeout) }
  } catch { return reply('Metadata upload unavailable. Retry later or use the manual launch flow.', 502) }
}
