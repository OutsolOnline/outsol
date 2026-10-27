import { PublicKey, SystemProgram } from '@solana/web3.js'

export const MAX_ANNOUNCEMENT_LENGTH = 280
export interface LaunchAnnouncementDetails { mint: string; name?: string; symbol?: string }

/** A syntactic mint check only. The caller must verify the launch receipt. */
export function validateAnnouncementMint(value: unknown): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw new Error('A valid confirmed mint is needed to prepare an announcement.')
  try {
    const key = new PublicKey(value)
    if (key.toBase58() !== value || key.equals(SystemProgram.programId) || !PublicKey.isOnCurve(key.toBytes())) throw new Error()
  } catch { throw new Error('A valid confirmed mint is needed to prepare an announcement.') }
  return value
}

function label(value: unknown, length: number): string {
  if (typeof value !== 'string') return ''
  let text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length)
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
  return text
}

export function createLaunchAnnouncement(details: LaunchAnnouncementDetails): string {
  const mint = validateAnnouncementMint(details.mint), name = label(details.name, 80) || 'My token', symbol = label(details.symbol, 12).replace(/^\$/, '')
  return `${name}${symbol ? ` ($${symbol})` : ''} is now live on Pump.fun.\n\nMint: ${mint}\nhttps://pump.fun/coin/${mint}`
}

/** Construct a user-reviewed composer URL; never publish or request account access. */
export function createXAnnouncementIntent(mint: string, text: unknown): string {
  validateAnnouncementMint(mint)
  if (typeof text !== 'string' || !text.trim()) throw new Error('Write an announcement before opening X.')
  if (text.length > MAX_ANNOUNCEMENT_LENGTH) throw new Error('Keep the announcement within 280 characters.')
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw new Error('Remove unsupported control characters from the announcement.')
  for (const point of text) if (point.length === 1 && /[\uD800-\uDFFF]/.test(point)) throw new Error('The announcement contains an incomplete character. Edit it before opening X.')
  const target = new URL('https://x.com/intent/post')
  target.searchParams.set('text', text)
  return target.toString()
}
