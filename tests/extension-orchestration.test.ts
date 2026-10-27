import { describe, expect, it, vi } from 'vitest'
import { handleContextMenu, registerBackground } from '../extension/background.js'
import { initializePopup } from '../extension/popup.js'

function chromeStub() {
  return {
    tabs: { query: vi.fn(async () => [{ id: 17, url: 'https://example.com/article?private=1', title: 'Article' }]), create: vi.fn(async (options) => ({ id: 18, ...options })) },
    scripting: { executeScript: vi.fn(async (_options: { target: { tabId: number }; func: () => unknown }) => [{ result: { title: 'Article', pageUrl: 'https://example.com/article', description: 'Summary', selectionText: '', imageUrl: '' } }]) },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, onInstalled: { addListener: vi.fn() } },
    contextMenus: { create: vi.fn(), removeAll: vi.fn(async () => {}), onClicked: { addListener: vi.fn() } },
  }
}

function popupDocument() {
  const elements = new Map<string, { value: string; textContent: string; disabled: boolean; hidden: boolean; listeners: Record<string, (event: { preventDefault: () => void }) => unknown>; addEventListener: (name: string, listener: (event: { preventDefault: () => void }) => unknown) => void }>()
  for (const id of ['draft-form', 'name', 'symbol', 'description', 'source-url', 'image-url', 'status', 'source-kind', 'open-draft', 'name-count']) {
    const element = { value: '', textContent: '', disabled: false, hidden: false, listeners: {} as Record<string, (event: { preventDefault: () => void }) => unknown>, addEventListener(name: string, listener: (event: { preventDefault: () => void }) => unknown) { this.listeners[name] = listener } }
    elements.set(id, element)
  }
  return { getElementById: (id: string) => elements.get(id)!, elements }
}

function tabStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}

describe('extension user gesture orchestration', () => {
  it('captures after the toolbar gesture and opens OutSol only after reviewing and submitting', async () => {
    const chromeApi = chromeStub()
    const documentObject = popupDocument()
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: '' }, historyObject: { replaceState: vi.fn() } })
    expect(chromeApi.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 17 })
    expect(documentObject.getElementById('name').value).toBe('Article')
    expect(chromeApi.tabs.create).not.toHaveBeenCalled()
    documentObject.getElementById('symbol').value = 'ART'
    await documentObject.getElementById('draft-form').listeners.submit({ preventDefault: vi.fn() })
    const handedOff = new URL(chromeApi.tabs.create.mock.calls[0][0].url)
    expect(handedOff.origin + handedOff.pathname).toBe('https://outsol.online/extension')
    expect(handedOff.search).toBe('')
    expect(JSON.parse(decodeURIComponent(handedOff.hash.slice('#import='.length)))).toEqual({ version: 1, kind: 'page', name: 'Article', symbol: 'ART', description: 'Summary', sourceUrl: 'https://example.com/article' })
  })

  it('shows a clear error on browser pages and never injects or sends the draft', async () => {
    const chromeApi = chromeStub()
    chromeApi.tabs.query.mockResolvedValue([{ id: 17, url: 'chrome://extensions', title: 'Extensions' }])
    const documentObject = popupDocument()
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: '' }, historyObject: { replaceState: vi.fn() } })
    expect(documentObject.getElementById('status').textContent).toMatch(/public HTTPS|unsupported/)
    expect(documentObject.getElementById('open-draft').disabled).toBe(true)
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled()
    expect(chromeApi.tabs.create).not.toHaveBeenCalled()
  })

  it('keeps invalid review fields local and allows retry after correction', async () => {
    const chromeApi = chromeStub()
    const documentObject = popupDocument()
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: '' }, historyObject: { replaceState: vi.fn() } })
    const submit = documentObject.getElementById('draft-form').listeners.submit
    await submit({ preventDefault: vi.fn() })
    expect(documentObject.getElementById('status').textContent).toMatch(/Symbol/)
    expect(chromeApi.tabs.create).not.toHaveBeenCalled()
    documentObject.getElementById('symbol').value = 'OK'
    await submit({ preventDefault: vi.fn() })
    expect(chromeApi.tabs.create).toHaveBeenCalledOnce()
  })

  it('opens context selection in a local review and preserves it without reading the new review tab', async () => {
    const chromeApi = chromeStub()
    chromeApi.scripting.executeScript.mockResolvedValue([{ result: { title: 'Article', pageUrl: 'https://example.com/article', description: 'Summary', selectionText: 'A selected idea', imageUrl: '' } }])
    await handleContextMenu(chromeApi, { menuItemId: 'outsol-selection', selectionText: 'A selected idea', editable: false }, { id: 17, url: 'https://example.com/article?secret=1', title: 'Article' })
    const review = new URL(chromeApi.tabs.create.mock.calls[0][0].url)
    expect(review.protocol).toBe('chrome-extension:')
    const documentObject = popupDocument()
    const replaceState = vi.fn()
    chromeApi.scripting.executeScript.mockClear()
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: review.hash }, historyObject: { replaceState } })
    expect(documentObject.getElementById('description').value).toBe('A selected idea')
    expect(documentObject.getElementById('source-url').value).toBe('https://example.com/article')
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalled()
    expect(chromeApi.tabs.create).toHaveBeenCalledOnce()
  })

  it('never copies an editable field selection into a review URL', async () => {
    const chromeApi = chromeStub()
    await handleContextMenu(chromeApi, { menuItemId: 'outsol-selection', selectionText: 'password secret', editable: true }, { id: 17, url: 'https://example.com/article', title: 'Article' })
    const review = chromeApi.tabs.create.mock.calls[0][0].url
    expect(decodeURIComponent(review)).not.toContain('password secret')
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('recovers edited context-menu suggestions after refresh without reading the review tab', async () => {
    const chromeApi = chromeStub(), storageObject = tabStorage(), documentObject = popupDocument()
    const review = { draft: { version: 1, kind: 'selection', name: 'Original', symbol: '', description: 'Selected text', sourceUrl: 'https://example.com/article' } }
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: `#capture=${encodeURIComponent(JSON.stringify(review))}` }, historyObject: { replaceState: vi.fn() }, storageObject })
    documentObject.getElementById('name').value = 'Edited name'
    documentObject.getElementById('name').listeners.input({ preventDefault: vi.fn() })
    const restored = popupDocument()
    await initializePopup({ chromeApi, documentObject: restored, locationObject: { hash: '' }, historyObject: { replaceState: vi.fn() }, storageObject })
    expect(restored.getElementById('name').value).toBe('Edited name')
    expect(restored.getElementById('description').value).toBe('Selected text')
    expect(restored.getElementById('open-draft').disabled).toBe(false)
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('bounds context-review fields before rendering and clears a malformed capture fragment', async () => {
    const chromeApi = chromeStub(), documentObject = popupDocument(), replaceState = vi.fn()
    const review = { draft: { version: 1, kind: 'page', name: 'x'.repeat(5000), symbol: '', description: '', sourceUrl: 'https://example.com' } }
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: `#capture=${encodeURIComponent(JSON.stringify(review))}` }, historyObject: { replaceState } })
    expect(documentObject.getElementById('open-draft').disabled).toBe(true)
    expect(documentObject.getElementById('status').textContent).toMatch(/unsupported|too long|invalid/i)
    expect(replaceState).toHaveBeenCalled()
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('still captures the active website when session storage is blocked', async () => {
    const chromeApi = chromeStub(), documentObject = popupDocument()
    const storageObject = { getItem: () => { throw new Error('Storage blocked') }, setItem: () => { throw new Error('Storage blocked') } }
    await initializePopup({ chromeApi, documentObject, locationObject: { hash: '' }, historyObject: { replaceState: vi.fn() }, storageObject })
    expect(documentObject.getElementById('name').value).toBe('Article')
    expect(documentObject.getElementById('open-draft').disabled).toBe(false)
  })

  it('trusts the DOM editable-range guard even when the browser menu marks a mixed selection noneditable', async () => {
    const chromeApi = chromeStub()
    await handleContextMenu(chromeApi, { menuItemId: 'outsol-selection', selectionText: 'Includes an editable secret', editable: false }, { id: 17, url: 'https://example.com/article', title: 'Article' })
    expect(decodeURIComponent(chromeApi.tabs.create.mock.calls[0][0].url)).not.toContain('editable secret')
  })

  it('uses the clicked image as a suggestion and registers all three menu gestures', async () => {
    const chromeApi = chromeStub()
    registerBackground(chromeApi)
    await chromeApi.runtime.onInstalled.addListener.mock.calls[0][0]()
    expect(chromeApi.contextMenus.create.mock.calls.map(([menu]) => menu.contexts)).toEqual([['page'], ['selection'], ['image']])
    await handleContextMenu(chromeApi, { menuItemId: 'outsol-image', srcUrl: 'https://cdn.example.com/idea.png?secret=1', editable: false }, { id: 17, url: 'https://example.com/article', title: 'Article' })
    const data = JSON.parse(decodeURIComponent(new URL(chromeApi.tabs.create.mock.calls[0][0].url).hash.slice('#capture='.length)))
    expect(data.draft.imageUrl).toBe('https://cdn.example.com/idea.png')
    expect(data.draft.kind).toBe('image')
  })
})
