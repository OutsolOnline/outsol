'use client'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { ArtworkLibrary } from '@/components/launch/ArtworkLibrary'
import { useLaunchStore } from '@/stores/launchStore'
import { readPending } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { prepareLaunchNavigation } from '@/lib/launchNavigation'
import { assertNoPendingBundleReceipt } from '@/lib/bundler/pending'
import { useBundlerStore } from '@/stores/bundlerStore'

export default function ArtworkPage() {
  const router = useRouter()
  return <div className="min-h-screen flex flex-col"><Header /><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
    <div className="page-heading"><div className="eyebrow">YOUR NEXT DESIGN STARTS HERE</div><h1>Your artwork, ready to reuse.</h1><p>A local image collection for your token designs. Nothing is uploaded while you browse or save here.</p></div>
    <div className="workspace-card max-w-5xl mx-auto"><ArtworkLibrary onSelect={(blob, preview) => {
      assertNoPendingWalletOperation(); if (readPending() || readTradePending()) throw new Error('Check the pending operation in Activity before changing your design.')
      assertNoPendingBundleReceipt()
      let store = useLaunchStore.getState()
      if (store.isLoading || useBundlerStore.getState().isExecuting) throw new Error('Finish the active signing or bundle operation before changing its artwork.')
      if (store.currentStep === 'result' && !prepareLaunchNavigation('/launch?new=1')) throw new Error(useLaunchStore.getState().error || 'The current operation must be checked before starting another design.')
      store = useLaunchStore.getState()
      if (!store.metadata) store.setMetadata({ name: '', symbol: '', description: '' })
      store.setImageFile(blob); store.setImagePreview(preview); store.setMetadataUri(''); store.setStep('metadata'); store.setError(null)
      router.push('/launch')
    }} /></div><Link href="/launch" className="secondary-action mt-6"><ArrowLeft size={16} />Back to your design</Link>
  </main><Footer /></div>
}
