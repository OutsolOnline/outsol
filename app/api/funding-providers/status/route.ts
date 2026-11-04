import {withAppAccess} from '@/lib/server/appAccess'
import {createFundingHandlers} from '@/lib/server/fundingProviders/handlers'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const POST=withAppAccess(createFundingHandlers().status)
