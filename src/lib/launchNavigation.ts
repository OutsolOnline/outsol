import { useLaunchStore } from '@/stores/launchStore'
import { readPending } from './launchHistory'
import { shouldStartNewLaunch } from './launchFlow'
import { launchSelectionFromSearch } from './workspaceCatalog'
import { readTradePending } from './venues/tradeHistory'
import { assertNoPendingWalletOperation } from './walletOperations/history'
import { assertNoPendingBundleReceipt } from './bundler/pending'
import { useBundlerStore } from '@/stores/bundlerStore'
import { createLaunchDraft, loadLaunchDrafts, saveLaunchDraft } from './launchDrafts'
import { knownArtworkId } from './artworkLibrary'
import {assertNoPendingGroupOperation} from './walletGroups/history'

let activeDesignId: string | undefined

type LaunchLinkClick = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented' | 'preventDefault'>

/** Only the current tab's ordinary link click may prepare or reset its design. */
export function prepareLaunchLinkNavigation(event: LaunchLinkClick, href: string): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true
  if (prepareLaunchNavigation(href)) return true
  event.preventDefault()
  return false
}

/** Per-tab identity. The shared refresh pointer must never select an overwrite target. */
export function setActiveDesignForNavigation(id: string | undefined): void {
  if (id !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Invalid active design identifier.')
  activeDesignId = id
}

/** Also handles choosing a launch link whose URL already matches the open result page. */
export function prepareLaunchNavigation(href: string): boolean {
  const store = useLaunchStore.getState()
  try {
    const url = new URL(href, 'https://vanity.example')
    if (url.origin !== 'https://vanity.example' || url.pathname !== '/launch' || (url.searchParams.get('new') !== '1' && !shouldStartNewLaunch(store.currentStep, url.searchParams))) return true
    const available = () => {
      if (readPending() || readTradePending()) throw new Error('Check the pending launch or trade in Activity before starting another design.')
      assertNoPendingWalletOperation(); assertNoPendingBundleReceipt()
      assertNoPendingGroupOperation()
      if (useLaunchStore.getState().isLoading || useBundlerStore.getState().isExecuting) throw new Error('Finish the active signing or bundle operation before starting another design.')
    }
    available()
    if (store.currentStep !== 'result' && (store.metadata || store.imageFile || store.metadataUri)) {
      const artworkId = store.imageFile ? knownArtworkId(store.imageFile) : undefined
      if (store.imageFile && !artworkId) throw new Error('Use Save design to store your current artwork before starting a new design. Your current work has been preserved.')
      const existing = activeDesignId ? loadLaunchDrafts().find(draft => draft.id === activeDesignId) : undefined
      const retainedArtworkId = artworkId || existing?.artworkId
      const draft = createLaunchDraft({ name: existing?.name || store.metadata?.name || 'Untitled design', metadata: store.metadata || { name: '', symbol: '', description: '' }, metadataUri: store.metadataUri || '', config: store.config,bundleSettings:store.bundleSettings, ...(retainedArtworkId ? { artworkId: retainedArtworkId } : {}) }, existing?.id)
      saveLaunchDraft(draft)
      localStorage.setItem('vanity-active-design-v1', draft.id)
      available()
    }
    store.reset()
    activeDesignId = undefined
    store.setConfig(launchSelectionFromSearch(url.searchParams, Math.floor(Date.now() / 1000)))
    return true
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'The current design could not be preserved. Save it before starting another.')
    return false
  }
}
