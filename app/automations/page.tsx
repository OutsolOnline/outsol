import {TradingSessionsClient} from '@/components/tradingSessions/TradingSessionsClient'
import {sessionModeFromQuery} from '@/lib/tradingSessions/config'

export default async function AutomationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams
 return <TradingSessionsClient initialMode={sessionModeFromQuery(query.mode)}/>
}
