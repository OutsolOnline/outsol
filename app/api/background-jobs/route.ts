import {withAppAccess} from '@/lib/server/appAccess'
import {backgroundJobHandlers} from '@/lib/server/backgroundJobs/handlers'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=withAppAccess(backgroundJobHandlers.status)
export const POST=withAppAccess(backgroundJobHandlers.create)
