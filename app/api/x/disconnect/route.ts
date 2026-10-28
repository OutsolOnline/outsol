import { xAuthService } from '@/lib/server/xAuth/service'
import { withAppAccess } from '@/lib/server/appAccess'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = withAppAccess(xAuthService.disconnect)
