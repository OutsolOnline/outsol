/** Self-contained: Chrome serializes this function into the active tab. */
export function capturePage() {
  const cleanUrl = (value) => {
    if (!value) return ''
    try {
      const url = new URL(value, location.href)
      if (url.protocol !== 'https:' || url.username || url.password) return ''
      url.search = ''
      url.hash = ''
      return url.href.length <= 2000 ? url.href : ''
    } catch { return '' }
  }
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || ''
  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  let selectionText = ''
  const selection = window.getSelection()
  if (selection && !document.activeElement?.closest(editable) && !selection.anchorNode?.parentElement?.closest(editable) && !selection.focusNode?.parentElement?.closest(editable)) {
    let touchesEditable = false
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index)
      if ([...document.querySelectorAll(editable)].some((element) => range.intersectsNode(element))) touchesEditable = true
    }
    if (!touchesEditable) selectionText = selection.toString().slice(0, 1000)
  }
  const canonical = document.querySelector('link[rel~="canonical"]')?.getAttribute('href')
  return {
    title: document.title.slice(0, 200),
    pageUrl: cleanUrl(location.href),
    canonicalUrl: canonical ? cleanUrl(canonical) : '',
    description: (meta('meta[name="description"]') || meta('meta[property="og:description"]')).slice(0, 1000),
    selectionText,
    imageUrl: cleanUrl(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]')),
  }
}
