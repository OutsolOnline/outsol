import type { Metadata } from 'next'
import '@fontsource-variable/inter'
import './globals.css'
import { ClientProviders } from '@/providers/ClientProviders'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'

export const metadata: Metadata = {
  title: 'OutSol',
  description: 'Prepare, rehearse and manage your tokens in a focused Pump.fun workspace on Solana. Zero OutSol platform fees, forever.',
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
