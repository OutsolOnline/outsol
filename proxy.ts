import { NextRequest, NextResponse } from 'next/server'
import { isPublicAccessPath, requireAppAccess, resolveAccessOrigin } from './src/lib/server/appAccess'

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (isPublicAccessPath(path, request.method) || path === '/access' && ['GET', 'HEAD', 'POST'].includes(request.method)) return NextResponse.next()
  const denied = requireAppAccess(request)
  if (denied) {
    if (denied.status === 401 && !path.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)) {
      const origin = resolveAccessOrigin(request)
      if (!origin) return Response.json({ error: 'Private access is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
      const response = NextResponse.redirect(new URL('/access', origin), 307)
      response.headers.set('Cache-Control', 'private, no-store, max-age=0')
      return response
    }
    return denied
  }
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}
