import {withAppAccess} from '@/lib/server/appAccess'
import {automationHandlers} from '@/lib/server/automationWallets/handlers'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=withAppAccess(automationHandlers.GET)
export const POST=withAppAccess(automationHandlers.POST)
