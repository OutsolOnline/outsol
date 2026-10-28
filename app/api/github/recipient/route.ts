import { createGitHubRecipientHandler } from '@/lib/server/githubRecipient'
import { withAppAccess } from '@/lib/server/appAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = withAppAccess(createGitHubRecipientHandler())
