const encoder = new TextEncoder()
const forbiddenSuffixes = ['.localhost', '.local', '.internal', '.home', '.lan', '.test', '.invalid', '.onion']

/** Accept a public HTTPS URL without credentials or private query/fragment data. */
export function publicHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Use a public HTTPS page URL.')
  let url
  try { url = new URL(value) } catch { throw new Error('Use a valid public HTTPS URL.') }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || host.startsWith('[') || host.includes('*') || forbiddenSuffixes.some((suffix) => host.endsWith(suffix))) {
    throw new Error('This page is unsupported. Open a public HTTPS website first.')
  }
  if (/^[\d.]+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) {
      throw new Error('Private and reserved network addresses are unsupported.')
    }
  }
  url.search = ''
  url.hash = ''
  const clean = url.href
  if (clean.length > 2000) throw new Error('URLs must be 2,000 characters or fewer.')
  return clean
}

function text(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : ''
}

function nameSuggestion(value) {
  let result = ''
  for (const character of text(value, 200).replace(/\s+/g, ' ')) {
    if (encoder.encode(result + character).length > 32) break
    result += character
  }
  return result.trim()
}

export function buildDraft(capture, kind = 'page') {
  const pageUrl = publicHttpsUrl(capture.pageUrl)
  let sourceUrl = pageUrl
  if (capture.canonicalUrl) {
    try {
      const canonical = publicHttpsUrl(capture.canonicalUrl)
      if (new URL(canonical).origin === new URL(pageUrl).origin) sourceUrl = canonical
    } catch { /* Untrusted metadata is only a suggestion. */ }
  }
  const selection = kind === 'selection' ? text(capture.selectionText, 1000) : ''
  const draft = {
    version: 1, kind, name: nameSuggestion(selection || capture.title), symbol: '',
    description: selection || text(capture.description, 1000), sourceUrl,
  }
  if (capture.imageUrl) {
    try { draft.imageUrl = publicHttpsUrl(capture.imageUrl) } catch { /* Optional artwork stays empty when unsupported. */ }
  }
  return draft
}

/** Rebuild the allowlisted payload; never forward extra page-supplied properties. */
export function validateDraft(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !['page', 'selection', 'image'].includes(value.kind)) throw new Error('This draft format is unsupported.')
  if (typeof value.name !== 'string' || !value.name.trim() || encoder.encode(value.name.trim()).length > 32 || /[\u0000-\u001f\u007f]/.test(value.name)) throw new Error('Name is required, must use a single line and fit 32 UTF-8 bytes.')
  if (typeof value.symbol !== 'string' || !/^[A-Za-z0-9]{1,10}$/.test(value.symbol)) throw new Error('Symbol must contain 1–10 letters or numbers.')
  if (typeof value.description !== 'string' || value.description.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.description)) throw new Error('Description must contain no unsupported characters and fit 1,000 characters.')
  if (typeof value.sourceUrl !== 'string' || value.sourceUrl.length > 2000) throw new Error('Source URL must be 2,000 characters or fewer.')
  const payload = { version: 1, kind: value.kind, name: value.name.trim(), symbol: value.symbol, description: value.description, sourceUrl: publicHttpsUrl(value.sourceUrl) }
  if (value.imageUrl !== undefined && value.imageUrl !== '') {
    if (typeof value.imageUrl !== 'string' || value.imageUrl.length > 2000) throw new Error('Image URL must be 2,000 characters or fewer.')
    payload.imageUrl = publicHttpsUrl(value.imageUrl)
  }
  return payload
}

export function buildLaunchUrl(value) {
  return `https://outsol.online/extension#import=${encodeURIComponent(JSON.stringify(validateDraft(value)))}`
}
