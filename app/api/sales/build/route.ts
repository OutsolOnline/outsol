import {withAppAccess} from '@/lib/server/appAccess'
import {createMarketBuildHandler} from '@/lib/sales/provider'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const POST=withAppAccess(createMarketBuildHandler())
