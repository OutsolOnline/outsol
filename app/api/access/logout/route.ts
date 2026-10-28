import { accessHandlers, withAppAccess } from '@/lib/server/appAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = withAppAccess(accessHandlers.logout)
