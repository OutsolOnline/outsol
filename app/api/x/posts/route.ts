import {createXPostsHandler} from '@/lib/server/xPosts'
import {withXAccessToken} from '@/lib/server/xAuth/service'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const GET=createXPostsHandler(withXAccessToken)
