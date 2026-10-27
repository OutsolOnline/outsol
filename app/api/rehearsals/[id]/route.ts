import { rehearsalHandlers } from '@/lib/server/rehearsal/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) { return rehearsalHandlers.get(request, (await context.params).id) }
export async function DELETE(request: Request, context: Context) { return rehearsalHandlers.remove(request, (await context.params).id) }
