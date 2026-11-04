import {withAppAccess} from '@/lib/server/appAccess'
import {backgroundJobHandlers} from '@/lib/server/backgroundJobs/handlers'
export const runtime='nodejs'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export const GET=withAppAccess(async(request:Request,context:Context)=>backgroundJobHandlers.get(request,(await context.params).id))
export const DELETE=withAppAccess(async(request:Request,context:Context)=>backgroundJobHandlers.remove(request,(await context.params).id))
