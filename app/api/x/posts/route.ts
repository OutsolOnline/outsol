import {createXPostsHandler} from '@/lib/server/xPosts'
import {withXAccessToken} from '@/lib/server/xAuth/service'
import { withAppAccess } from '@/lib/server/appAccess'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=withAppAccess(createXPostsHandler(withXAccessToken))
