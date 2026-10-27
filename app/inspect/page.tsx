import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { WalletInspector } from '@/components/wallet/WalletInspector'

export default function InspectPage() {
  return <div className="min-h-screen flex flex-col">
    <Header />
    <main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
      <div className="page-heading"><div><div className="eyebrow">WALLET UTILITIES</div><h1>Wallet Inspector</h1><p>Balances, token accounts and potential account rent. One read-only scan.</p></div></div>
      <WalletInspector />
    </main>
    <Footer />
  </div>
}
