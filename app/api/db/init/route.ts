import { NextResponse } from 'next/server'
import { withAppAccess } from '@/lib/server/appAccess'

// Database administration never belongs on a public application route.
export const POST = withAppAccess(async (_request: Request) => {
  return NextResponse.json({ error: 'Database setup is disabled. Launch receipts are stored locally.' }, { status: 410 })
})
