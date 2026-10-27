import { createRpcHandler } from '@/lib/server/rpcProxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = createRpcHandler()
