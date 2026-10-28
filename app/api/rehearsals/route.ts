import { rehearsalHandlers } from '@/lib/server/rehearsal/service'
import { withAppAccess } from '@/lib/server/appAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const POST = withAppAccess(rehearsalHandlers.post)
