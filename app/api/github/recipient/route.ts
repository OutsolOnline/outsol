import { createGitHubRecipientHandler } from '@/lib/server/githubRecipient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = createGitHubRecipientHandler()
