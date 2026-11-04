import type { Metadata } from 'next'
import '@fontsource-variable/inter'
import './globals.css'
import { ClientProviders } from '@/providers/ClientProviders'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LAUNCHPIER_X_HANDLE } from '@/lib/publicBrand'

export const metadata: Metadata = {
  metadataBase: new URL('https://launchpier.net'),
  title: 'LaunchPier',
  description: 'Prepare, rehearse, launch and manage Pump.fun tokens in one clear Solana workspace. LaunchPier charges 0% platform fees; network and protocol costs apply.',
  openGraph: {
    title: 'LaunchPier',
    description: 'Prepare. Rehearse. Launch. A focused Solana workspace with 0% LaunchPier platform fees. Network and third-party costs apply.',
    type: 'website',
    images: [{ url: '/brand/launchpier-banner.png', width: 2172, height: 724, alt: 'LaunchPier — Prepare. Rehearse. Launch. 0% platform fees; network and third-party costs apply.' }],
  },
  twitter: {
    card: 'summary_large_image',
    site: LAUNCHPIER_X_HANDLE,
    creator: LAUNCHPIER_X_HANDLE,
    title: 'LaunchPier',
    description: 'Prepare, rehearse and launch on Solana with 0% LaunchPier platform fees. Network and third-party costs apply.',
    images: ['/brand/launchpier-banner.png'],
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }, { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' }],
    shortcut: '/favicon.ico',
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <ClientProviders>
          <TooltipProvider>
            <div className="min-h-screen bg-background">
              {children}
            </div>
            <Toaster />
          </TooltipProvider>
        </ClientProviders>
      </body>
    </html>
  )
}
