import { rehearsalHandlers } from '@/lib/server/rehearsal/service'
import { withAppAccess } from '@/lib/server/appAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
type Context = { params: Promise<{ id: string }> }
export const GET = withAppAccess(async (request: Request, context: Context) => rehearsalHandlers.get(request, (await context.params).id))
export const DELETE = withAppAccess(async (request: Request, context: Context) => rehearsalHandlers.remove(request, (await context.params).id))
