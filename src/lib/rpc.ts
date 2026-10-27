/** Browser requests keep the provider credential on the server. */
export function getRpcEndpoint(): string {
  return typeof window !== 'undefined'
    ? new URL('/api/rpc', window.location.origin).toString()
    : 'https://api.mainnet-beta.solana.com'
}
