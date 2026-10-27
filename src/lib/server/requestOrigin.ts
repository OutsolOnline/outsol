/** Deployment origins come from server configuration, never forwarded request headers. */
export function isAllowedRequestOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  try {
    const configured = process.env.APP_ORIGIN || process.env.PUBLIC_APP_URL
    const aliases = process.env.APP_ALLOWED_ORIGINS || ''
    if (aliases.length > 4096) return false
    const entries = aliases ? aliases.split(',').map(value => value.trim()) : []
    if (entries.length > 8 || entries.some(value => !value)) return false
    const deploymentOrigin = (value: string): string => {
      const expected = new URL(value)
      if (expected.hostname.includes('*') || expected.username || expected.password || expected.search || expected.hash || expected.pathname !== '/') throw new Error('Invalid deployment origin')
      if (expected.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && expected.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname))) throw new Error('Invalid deployment protocol')
      return expected.origin
    }
    // Domain aliases are explicit server configuration; no request header can add one.
    const allowed = new Set(entries.map(deploymentOrigin))
    allowed.add(configured ? deploymentOrigin(configured) : new URL(request.url).origin)
    const origin = request.headers.get('origin')
    return !origin || allowed.has(origin)
  } catch { return false }
}
