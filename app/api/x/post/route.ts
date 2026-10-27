import {createPublicXPostHandler} from '@/lib/server/xPosts'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const POST=createPublicXPostHandler()
