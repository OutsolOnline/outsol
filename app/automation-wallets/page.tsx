import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {AutomationWalletsPanel} from '@/components/automationWallets/AutomationWalletsPanel'

export default function AutomationWalletsPage(){
 return <><Header/><main id="workspace-content" className="workspace-main" tabIndex={-1}><div className="page-heading"><div className="eyebrow">DEDICATED AUTOMATION WALLET</div><h1>Scheduled trades, without an open tab.</h1><p>Create a separate wallet, back it up, fund it and approve a bounded Pump.fun schedule.</p></div><AutomationWalletsPanel/></main><Footer/></>
}
