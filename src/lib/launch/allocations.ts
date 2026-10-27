const U64_MAX = BigInt('18446744073709551615')

/** Parse human-readable amounts without ever passing through floating point. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw new Error('Decimals must be an integer between 0 and 9')
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a plain positive decimal amount')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) throw new Error('Amount has more decimal places than the token supports')
  const amount = BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (amount <= BigInt(0) || amount > U64_MAX) throw new Error('Amount must fit a positive unsigned 64-bit token quantity')
  return amount
}

export function calculateDirectAllocations(totalSupply: string, decimals: number, liquidityTokenPercent: number, liquiditySol: string): { totalRaw: bigint; liquidityRaw: bigint; developerRaw: bigint; liquidityLamports: bigint } {
  const totalRaw = parseTokenAmount(totalSupply, decimals)
  const scaledPercent = Math.round(liquidityTokenPercent * 100)
  if (!Number.isFinite(liquidityTokenPercent) || Math.abs(scaledPercent / 100 - liquidityTokenPercent) > 1e-9 || scaledPercent <= 0 || scaledPercent >= 10000) {
    throw new Error('Pool allocation must be between 0 and 100%, with at most two decimal places')
  }
  const liquidityRaw = totalRaw * BigInt(scaledPercent) / BigInt(10000)
  const developerRaw = totalRaw - liquidityRaw
  if (liquidityRaw === BigInt(0) || developerRaw === BigInt(0)) throw new Error('Both pool and developer allocations must contain tokens')
  return { totalRaw, liquidityRaw, developerRaw, liquidityLamports: parseTokenAmount(liquiditySol, 9) }
}
