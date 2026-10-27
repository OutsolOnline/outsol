import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildDraft, buildLaunchUrl, publicHttpsUrl, validateDraft } from '../extension/shared.js'
import { capturePage } from '../extension/collector.js'

afterEach(() => vi.unstubAllGlobals())

describe('extension capture boundary', () => {
  it('removes private URL components and blocks nonpublic or unsupported sources', () => {
    expect(publicHttpsUrl('https://example.com/story?secret=yes#private')).toBe('https://example.com/story')
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'chrome://settings', 'https://localhost/a', 'https://127.1/a', 'https://10.1.2.3/a', 'https://192.168.0.1/a', 'https://[::1]/a', 'https://[::ffff:192.168.1.1]/a', 'https://intranet/a', 'https://home.local/a']) {
      expect(() => publicHttpsUrl(url), url).toThrow()
    }
  })

  it('builds an editable draft with UTF8-safe names and a public image suggestion', () => {
    expect(buildDraft({ title: '😀'.repeat(10), description: 'Page description', pageUrl: 'https://example.com/a?private=x', canonicalUrl: 'https://example.com/article#section', imageUrl: 'https://cdn.example.com/photo.png?token=x' }, 'page')).toEqual({
      version: 1, kind: 'page', name: '😀'.repeat(8), symbol: '', description: 'Page description', sourceUrl: 'https://example.com/article', imageUrl: 'https://cdn.example.com/photo.png',
    })
  })

  it('uses selection only for the explicit selection mode and omits invalid image suggestions', () => {
    const input = { title: 'Article', pageUrl: 'https://example.com/a', selectionText: 'A selected idea', imageUrl: 'data:image/png,secret' }
    expect(buildDraft(input, 'selection')).toEqual({ version: 1, kind: 'selection', name: 'A selected idea', symbol: '', description: 'A selected idea', sourceUrl: 'https://example.com/a' })
    expect(buildDraft(input, 'page').description).toBe('')
  })

  it('validates all review fields before producing the fixed fragment-only handoff', () => {
    const draft = { version: 1, kind: 'page', name: 'Fresh idea', symbol: 'IDEA', description: 'Reviewed', sourceUrl: 'https://example.com/a?secret=1#x' }
    expect(buildLaunchUrl(draft)).toBe('https://outsol.online/extension#import=%7B%22version%22%3A1%2C%22kind%22%3A%22page%22%2C%22name%22%3A%22Fresh%20idea%22%2C%22symbol%22%3A%22IDEA%22%2C%22description%22%3A%22Reviewed%22%2C%22sourceUrl%22%3A%22https%3A%2F%2Fexample.com%2Fa%22%7D')
    for (const change of [{ name: '' }, { name: '😀'.repeat(9) }, { symbol: '' }, { symbol: 'TOO_LONG_12' }, { symbol: 'é' }, { description: 'x'.repeat(1001) }, { sourceUrl: 'https://localhost/a' }, { imageUrl: 'javascript:bad' }, { version: 2 }, { kind: 'unknown' }]) {
      expect(() => validateDraft({ ...draft, ...change })).toThrow()
    }
    expect(validateDraft({ ...draft, extra: 'secret' })).not.toHaveProperty('extra')
  })

  it('never creates a name containing selection line breaks or forwards rejected control characters', () => {
    const draft = buildDraft({ title: 'Article', pageUrl: 'https://example.com/a', selectionText: 'First line\n\tsecond line' }, 'selection')
    expect(draft.name).toBe('First line second line')
    expect(draft.description).toBe('First line\n\tsecond line')
    for (const change of [{ name: 'Bad\nname' }, { description: 'Bad\u0000description' }]) {
      expect(() => validateDraft({ ...draft, symbol: 'IDEA', ...change })).toThrow()
    }
  })

  it('reads only metadata and a safe document selection; an editable selection is never captured', () => {
    const selected = { toString: () => 'Selected idea', anchorNode: { parentElement: { closest: (): object | null => null } }, focusNode: { parentElement: { closest: () => null } }, rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => false }) }
    vi.stubGlobal('location', { href: 'https://example.com/a?secret=1#x' })
    vi.stubGlobal('window', { getSelection: () => selected })
    vi.stubGlobal('document', {
      title: 'The article', activeElement: { closest: () => null },
      querySelector: (selector: string) => ({ getAttribute: () => selector.includes('canonical') ? '/article?tracking=1' : selector.includes('description') ? 'Page summary' : null }),
      querySelectorAll: () => [],
    })
    expect(capturePage()).toEqual({ title: 'The article', pageUrl: 'https://example.com/a', canonicalUrl: 'https://example.com/article', description: 'Page summary', selectionText: 'Selected idea', imageUrl: '' })
    selected.anchorNode.parentElement.closest = () => ({})
    expect(capturePage().selectionText).toBe('')
  })
})
