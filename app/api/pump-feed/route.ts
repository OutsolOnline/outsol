import {createPumpFeedHandler} from '@/lib/server/pumpFeed'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=createPumpFeedHandler()
