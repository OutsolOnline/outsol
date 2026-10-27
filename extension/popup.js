import { buildDraft, buildLaunchUrl, publicHttpsUrl } from './shared.js'
import { capturePage } from './collector.js'

const REVIEW_KEY = 'outsol-context-review-v1'
function reviewDraft(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !['page', 'selection', 'image'].includes(value.kind)) throw new Error('This draft is unsupported. Capture the page again.')
  for (const [key, limit] of [['name', 64], ['symbol', 10], ['description', 1000], ['sourceUrl', 2000]]) {
    if (typeof value[key] !== 'string' || value[key].length > limit) throw new Error('This draft contains invalid or too long fields. Capture the page again.')
  }
  if (value.imageUrl !== undefined && (typeof value.imageUrl !== 'string' || value.imageUrl.length > 2000)) throw new Error('This image URL is invalid or too long.')
  return { version: 1, kind: value.kind, name: value.name, symbol: value.symbol, description: value.description, sourceUrl: value.sourceUrl, ...(value.imageUrl ? { imageUrl: value.imageUrl } : {}) }
}

/** @param {{chromeApi?: any, documentObject?: any, locationObject?: any, historyObject?: any, storageObject?: any}} [options] */
export async function initializePopup({ chromeApi = chrome, documentObject = document, locationObject = location, historyObject = history, storageObject } = {}) {
  let storage = storageObject
  if (storage === undefined) { try { storage = typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { storage = null } }
  let recoveredReview = null
  try { recoveredReview = storage?.getItem(REVIEW_KEY) } catch { /* Storage is optional for a fresh user-requested capture. */ }
  const byId = (id) => documentObject.getElementById(id)
  const button = byId('open-draft')
  const status = byId('status')
  let draft
  let ready = false
  let contextReview = false
  let opening = false
  button.disabled = true
  const countName = () => { byId('name-count').textContent = `${new TextEncoder().encode(byId('name').value).length}/32 bytes` }
  const currentDraft = () => ({ version: 1, kind: draft.kind, name: byId('name').value, symbol: byId('symbol').value, description: byId('description').value, sourceUrl: byId('source-url').value, imageUrl: byId('image-url').value })
  const remember = () => {
    if (!contextReview || !storage) return
    try { storage.setItem(REVIEW_KEY, JSON.stringify(reviewDraft(currentDraft()))) }
    catch { status.textContent = 'Refresh recovery is unavailable. Keep this review open until you continue to OutSol.' }
  }
  for (const id of ['name', 'symbol', 'description', 'source-url', 'image-url']) byId(id).addEventListener('input', () => {
    countName()
    if (ready && !opening) { button.disabled = false; button.textContent = 'Open launch draft ↗'; remember() }
  })
  byId('draft-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!ready || button.disabled) return
    try {
      const url = buildLaunchUrl(currentDraft())
      opening = true
      button.disabled = true
      button.textContent = 'Opening OutSol…'
      await chromeApi.tabs.create({ url })
      status.textContent = 'Draft opened in OutSol. Review the details and choose artwork there.'
      button.textContent = 'Draft opened ↗'
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The draft could not be opened. Please try again.'
      button.disabled = false
      button.textContent = 'Open launch draft ↗'
    } finally {
      opening = false
    }
  })
  try {
    if (locationObject.hash.startsWith('#capture=')) {
      contextReview = true
      try { storage?.removeItem(REVIEW_KEY) } catch { /* The current review remains usable when storage is blocked. */ }
      let review
      try {
        if (locationObject.hash.length > 24000) throw new Error()
        review = JSON.parse(decodeURIComponent(locationObject.hash.slice('#capture='.length)))
      }
      catch { throw new Error('This draft could not be read. Capture the page again.') }
      finally { historyObject.replaceState(null, '', 'popup.html') }
      if (review?.error) throw new Error(typeof review.error === 'string' ? review.error.slice(0, 300) : 'This page is unsupported.')
      draft = reviewDraft(review?.draft)
      draft.sourceUrl = publicHttpsUrl(draft.sourceUrl)
      if (draft.imageUrl) draft.imageUrl = publicHttpsUrl(draft.imageUrl)
    } else if (recoveredReview) {
      contextReview = true
      const raw = recoveredReview
      if (raw.length > 12000) throw new Error('This saved review is too large. Capture the page again.')
      try { draft = reviewDraft(JSON.parse(raw)) }
      catch { throw new Error('This saved review could not be read. Capture the page again.') }
    } else {
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true })
      publicHttpsUrl(tab?.url)
      if (!Number.isInteger(tab?.id)) throw new Error('Open a public HTTPS website first.')
      let results
      try { results = await chromeApi.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage }) }
      catch { throw new Error('This page cannot be read. Try an ordinary public HTTPS website.') }
      const capture = results?.[0]?.result
      if (!capture) throw new Error('This page cannot be read. Try an ordinary public HTTPS website.')
      draft = buildDraft({ ...capture, pageUrl: publicHttpsUrl(tab.url) }, capture.selectionText?.trim() ? 'selection' : 'page')
    }
    byId('name').value = draft.name
    byId('symbol').value = draft.symbol
    byId('description').value = draft.description
    byId('source-url').value = draft.sourceUrl
    byId('image-url').value = draft.imageUrl || ''
    byId('source-kind').textContent = `${draft.kind === 'selection' ? 'Selected text' : draft.kind === 'image' ? 'Selected image' : 'Current page'} → launch draft`
    countName()
    status.textContent = 'Review what you share. Nothing is sent until you open the launch draft.'
    ready = true
    button.disabled = false
    remember()
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'This page could not be captured.'
  }
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') void initializePopup()
