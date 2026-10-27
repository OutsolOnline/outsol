import { buildDraft, publicHttpsUrl } from './shared.js'
import { capturePage } from './collector.js'

const kinds = { 'outsol-page': 'page', 'outsol-selection': 'selection', 'outsol-image': 'image' }

export async function handleContextMenu(chromeApi, info, tab) {
  const kind = kinds[info.menuItemId]
  if (!kind) return
  let review
  try {
    if (kind === 'selection' && info.editable) throw new Error('Text inside an input or editable field is never captured. Select ordinary page text instead.')
    publicHttpsUrl(tab?.url)
    if (!Number.isInteger(tab?.id)) throw new Error('Open a public HTTPS website first.')
    let results
    const target = { tabId: tab.id }
    if (kind !== 'page' && Number.isInteger(info.frameId) && info.frameId >= 0) target.frameIds = [info.frameId]
    try { results = await chromeApi.scripting.executeScript({ target, func: capturePage }) }
    catch { throw new Error('This page cannot be read. Try an ordinary public HTTPS website.') }
    if (!results?.[0]?.result) throw new Error('This page cannot be read. Try an ordinary public HTTPS website.')
    const capture = { ...results[0].result, pageUrl: publicHttpsUrl(tab.url) }
    // Chrome's editable flag does not cover selections spanning an editable region.
    // Only the in-page range guard may authorize selected text for this review.
    if (kind === 'selection' && !capture.selectionText?.trim()) throw new Error('This selection is unavailable or touches editable content. Select ordinary page text instead.')
    if (kind === 'image') capture.imageUrl = typeof info.srcUrl === 'string' ? info.srcUrl : ''
    review = { draft: buildDraft(capture, kind) }
  } catch (error) {
    review = { error: error instanceof Error ? error.message : 'This page is unsupported.' }
  }
  await chromeApi.tabs.create({ url: `${chromeApi.runtime.getURL('popup.html')}#capture=${encodeURIComponent(JSON.stringify(review))}` })
}

export function registerBackground(chromeApi) {
  chromeApi.runtime.onInstalled.addListener(async () => {
    await chromeApi.contextMenus.removeAll()
    for (const [id, kind] of Object.entries(kinds)) {
      chromeApi.contextMenus.create({ id, title: kind === 'page' ? 'Prepare token draft with OutSol' : kind === 'selection' ? 'Prepare OutSol draft from selected text' : 'Prepare OutSol draft from this image', contexts: [kind], documentUrlPatterns: ['https://*/*'] })
    }
  })
  chromeApi.contextMenus.onClicked.addListener((info, tab) => { void handleContextMenu(chromeApi, info, tab) })
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) registerBackground(chrome)
