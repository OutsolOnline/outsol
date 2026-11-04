function deploymentOrigin(value: string): string {
  const expected = new URL(value)
  if (expected.hostname.includes('*') || expected.username || expected.password || expected.search || expected.hash || expected.pathname !== '/') throw new Error('Invalid deployment origin')
  if (expected.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && expected.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname))) throw new Error('Invalid deployment protocol')
  return expected.origin
}

/** Only server configuration can add production origins; host headers never extend this list. */
export function configuredRequestOrigins(request: Request): string[] {
  const configured = process.env.APP_ORIGIN || process.env.PUBLIC_APP_URL
  // Retain the previous setting for existing deployments during the domain transition.
  const lists = [process.env.APP_ADDITIONAL_ORIGINS || '', process.env.APP_ALLOWED_ORIGINS || ''].filter(Boolean)
  if (lists.reduce((length, value) => length + value.length, 0) > 4096) throw new Error('Invalid deployment origins')
  const entries = lists.flatMap(value => value.split(',').map(origin => origin.trim()))
  if (entries.length > 8 || entries.some(value => !value)) throw new Error('Invalid deployment origins')
  if (configured) entries.unshift(configured)
  else if (process.env.NODE_ENV !== 'production') entries.unshift(new URL(request.url).origin)
  return [...new Set(entries.map(deploymentOrigin))]
}

/** Deployment origins come from server configuration, never forwarded request headers. */
export function isAllowedRequestOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  try {
    const allowed = new Set(configuredRequestOrigins(request))
    if (!allowed.size) return false
    const origin = request.headers.get('origin')
    return !origin || allowed.has(origin)
  } catch { return false }
}
