'use client'

import dynamic from 'next/dynamic'

// Dynamically import LaunchContent with SSR disabled
// This prevents wallet hooks from running during server rendering
const LaunchContent = dynamic(
  () => import('@/components/launch/LaunchContent').then(mod => mod.LaunchContent),
  { 
    ssr: false,
    loading: () => (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loader-line w-24" />
      </div>
    )
  }
)

export default function LaunchPage() {
  return <LaunchContent />
}
