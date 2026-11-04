import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {BackgroundJobsPanel} from '@/components/backgroundJobs/BackgroundJobsPanel'

export default function HistoryPage(){
 return <><Header/><main id="workspace-content" className="workspace-main" tabIndex={-1}><div className="page-heading"><div className="eyebrow">DURABLE CHAIN READS</div><h1>History indexing</h1><p>Collect a bounded transaction history while your browser is closed.</p></div><BackgroundJobsPanel/></main><Footer/></>
}
