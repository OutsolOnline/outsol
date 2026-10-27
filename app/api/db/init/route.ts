import { NextResponse } from 'next/server'

// Database administration never belongs on a public application route.
export async function POST() {
  return NextResponse.json({ error: 'Database setup is disabled. Launch receipts are stored locally.' }, { status: 410 })
}
