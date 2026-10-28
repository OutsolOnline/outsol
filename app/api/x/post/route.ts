import {createPublicXPostHandler} from '@/lib/server/xPosts'
import { withAppAccess } from '@/lib/server/appAccess'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const POST=withAppAccess(createPublicXPostHandler())
