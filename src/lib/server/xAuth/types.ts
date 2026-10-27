export interface XPublicIdentity {
  id: string
  username: string
  name: string
  profileImageUrl?: string
  protected: boolean
}

/** Messages and codes are safe to return; provider bodies and tokens never belong here. */
export class XAuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'XAuthError' }
}

export const unavailableStorage = () => new XAuthError(503, 'storage_unavailable', 'The X connection store is unavailable. Try again later.')
export const authHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
