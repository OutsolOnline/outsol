import { readPublicAsset } from '@/lib/server/publicAssets'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params
  const asset = await readPublicAsset(file)
  if (!asset) return Response.json({ error: 'Asset not found' }, { status: 404 })
  return new Response(asset.bytes as BodyInit, { headers: {
    'Content-Type': asset.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } })
}
