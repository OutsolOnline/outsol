import { describe, expect, it, vi } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { formatInspectorSol, formatTokenAmount, inspectWallet, parseTokenAccountInventory, validateInspectorAddress } from '../src/lib/walletInspector'

const wallet = '11111111111111111111111111111111'
const other = 'So11111111111111111111111111111111111111112'
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const tokenAccount = new PublicKey(new Uint8Array(32).fill(3))

function account(overrides: Record<string, unknown> = {}, program = TOKEN_PROGRAM_ID, lamports = 2_039_280) {
  return {
    pubkey: tokenAccount,
    account: {
      executable: false, owner: program, lamports,
      data: { program: program.equals(TOKEN_PROGRAM_ID) ? 'spl-token' : 'spl-token-2022', space: 165, parsed: {
        type: 'account', info: { owner: wallet, mint, isNative: false, state: 'initialized', tokenAmount: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' }, ...overrides },
      } },
      rentEpoch: 0,
    },
  }
}

function inventory(entry = account(), program: 'spl-token' | 'token-2022' = 'spl-token', reserve: bigint | null = 2_039_280n) {
  return parseTokenAccountInventory({ context: { slot: 1 }, value: [entry] }, wallet, program, reserve)
}

describe('Wallet Inspector account assessment', () => {
  it('counts an empty initialized SPL account with owner fallback as potentially reclaimable', () => {
    const result = inventory()
    expect(result.emptyAccountCount).toBe(1)
    expect(result.potentialAccountCount).toBe(1)
    expect(result.potentialRentLamports).toBe(2_039_280n)
    expect(result.accounts[0].rentStatus).toBe('potential')
  })

  it('caps the estimate at the current base account reserve instead of surplus SOL', () => {
    expect(inventory(account({}, TOKEN_PROGRAM_ID, 9_000_000)).potentialRentLamports).toBe(2_039_280n)
    expect(inventory(account({}, TOKEN_PROGRAM_ID, 500)).potentialRentLamports).toBe(500n)
  })

  it('uses the explicit close authority rather than assuming the owner can close', () => {
    const result = inventory(account({ closeAuthority: other }))
    expect(result.potentialAccountCount).toBe(0)
    expect(result.accounts[0].rentStatus).toBe('different-close-authority')
    expect(inventory(account({ closeAuthority: wallet })).potentialAccountCount).toBe(1)
  })

  it.each([
    [{ state: 'frozen' }, 'frozen'],
    [{ state: 'uninitialized' }, 'uninitialized'],
    [{ isNative: true }, 'native'],
    [{ tokenAmount: { amount: '1', decimals: 6 } }, 'has-balance'],
  ])('conservatively excludes %j from the rent estimate', (overrides, status) => {
    const result = inventory(account(overrides))
    expect(result.potentialAccountCount).toBe(0)
    expect(result.accounts[0].rentStatus).toBe(status)
  })

  it('inventories empty Token-2022 accounts without assuming extension closure eligibility', () => {
    const result = inventory(account({}, TOKEN_2022_PROGRAM_ID), 'token-2022')
    expect(result.emptyAccountCount).toBe(1)
    expect(result.potentialAccountCount).toBe(0)
    expect(result.potentialRentLamports).toBe(0n)
    expect(result.accounts[0].rentStatus).toBe('extension-review')
  })

  it('keeps the eligibility count but reports an unavailable estimate if the rent read failed', () => {
    const result = inventory(account(), 'spl-token', null)
    expect(result.potentialAccountCount).toBe(1)
    expect(result.potentialRentLamports).toBeNull()
  })

  it.each([
    { owner: other }, { mint: 'invalid' }, { closeAuthority: 5 }, { isNative: 'false' }, { state: 'unknown' },
    { tokenAmount: { amount: '-1', decimals: 6 } },
    { tokenAmount: { amount: '18446744073709551616', decimals: 6 } },
    { tokenAmount: { amount: '0', decimals: 256 } },
    { tokenAmount: { amount: '0', decimals: -1 } },
  ])('rejects malformed or unrelated parsed fields %j instead of counting rent', overrides => {
    const result = inventory(account(overrides))
    expect(result.accounts).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
    expect(result.potentialAccountCount).toBe(0)
  })

  it('rejects unsafe numeric account lamports and mismatched program ownership', () => {
    expect(inventory(account({}, TOKEN_PROGRAM_ID, Number.MAX_SAFE_INTEGER + 1)).rejectedCount).toBe(1)
    expect(inventory(account({}, TOKEN_2022_PROGRAM_ID)).rejectedCount).toBe(1)
  })

  it('bounds oversized inventories and rejects duplicate accounts without double counting', () => {
    const result = parseTokenAccountInventory({ value: Array.from({ length: 1_005 }, () => account()) }, wallet, 'spl-token', 2_039_280n)
    expect(result.accounts).toHaveLength(1)
    expect(result.rejectedCount).toBe(999)
    expect(result.omittedCount).toBe(5)
    expect(result.potentialRentLamports).toBe(2_039_280n)
  })

  it('rejects malformed top-level inventory responses', () => {
    expect(() => parseTokenAccountInventory({ value: null }, wallet, 'spl-token', 1n)).toThrow()
  })
})

describe('Wallet Inspector exact balances and input validation', () => {
  it.each([
    ['18446744073709551615', 6, '18446744073709.551615'],
    ['9007199254740993', 0, '9007199254740993'],
    ['1', 9, '0.000000001'],
    ['1200000', 6, '1.2'],
    ['0', 255, '0'],
  ])('formats %s with %s decimals without floating point loss', (raw, decimals, expected) => {
    expect(formatTokenAmount(raw, decimals)).toBe(expected)
  })

  it('rejects malformed amounts and decimals before formatting', () => {
    expect(() => formatTokenAmount('1e9', 6)).toThrow()
    expect(() => formatTokenAmount('1', 256)).toThrow()
    expect(() => formatTokenAmount('-1', 6)).toThrow()
  })

  it('ignores rounded RPC ui amounts and uses the exact raw token amount', () => {
    const result = inventory(account({ tokenAmount: { amount: '18446744073709551615', decimals: 6, uiAmount: 1, uiAmountString: '1' } }))
    expect(result.accounts[0].balance).toBe('18446744073709.551615')
    expect(result.potentialAccountCount).toBe(0)
  })

  it('formats summed SOL above the safe integer range and keeps tiny rents exact', () => {
    expect(formatInspectorSol(9_007_199_254_740_993n)).toBe('9007199.254740993')
    expect(formatInspectorSol(1n)).toBe('0.000000001')
    expect(formatInspectorSol(0n)).toBe('0')
  })

  it('accepts public addresses with surrounding whitespace and rejects secret-like or malformed input', () => {
    expect(validateInspectorAddress(` ${wallet} `).toBase58()).toBe(wallet)
    expect(() => validateInspectorAddress('not an address')).toThrow()
    expect(() => validateInspectorAddress('1'.repeat(88))).toThrow()
  })
})

describe('Wallet Inspector read-only scans', () => {
  function connection() {
    return {
      getBalance: vi.fn(async () => 1_234_567_890),
      getMinimumBalanceForRentExemption: vi.fn(async () => 2_039_280),
      getParsedTokenAccountsByOwner: vi.fn(async (_owner: PublicKey, filter: { programId: PublicKey }) => ({ value: filter.programId.equals(TOKEN_PROGRAM_ID) ? [account()] : [] })),
    }
  }

  it('preserves standard inventory and SOL when Token-2022 fails', async () => {
    const rpc = connection()
    rpc.getParsedTokenAccountsByOwner.mockImplementation(async (_owner, filter) => {
      if (filter.programId.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('provider detail')
      return { value: [account()] }
    })
    const result = await inspectWallet(rpc, wallet)
    expect(result.balanceLamports).toBe(1_234_567_890n)
    expect(result.standard?.potentialRentLamports).toBe(2_039_280n)
    expect(result.token2022).toBeNull()
    expect(result.warnings.join(' ')).toMatch(/Token-2022/)
    expect(result.warnings.join(' ')).not.toContain('provider detail')
  })

  it('preserves Token-2022 inventory when the standard read fails', async () => {
    const rpc = connection()
    rpc.getParsedTokenAccountsByOwner.mockImplementation(async (_owner, filter) => {
      if (filter.programId.equals(TOKEN_PROGRAM_ID)) throw new Error('invalid standard response')
      return { value: [account({}, TOKEN_2022_PROGRAM_ID)] }
    })
    const result = await inspectWallet(rpc, wallet)
    expect(result.standard).toBeNull()
    expect(result.token2022?.accounts).toHaveLength(1)
    expect(result.token2022?.potentialAccountCount).toBe(0)
  })

  it('makes no requests for an invalid public address', async () => {
    const rpc = connection()
    await expect(inspectWallet(rpc, '[1,2,3]')).rejects.toThrow()
    expect(rpc.getBalance).not.toHaveBeenCalled()
    expect(rpc.getParsedTokenAccountsByOwner).not.toHaveBeenCalled()
    expect(rpc.getMinimumBalanceForRentExemption).not.toHaveBeenCalled()
  })

  it('does not turn an unsafe SOL balance into a rounded exact value', async () => {
    const rpc = connection()
    rpc.getBalance.mockResolvedValue(Number.MAX_SAFE_INTEGER + 1)
    const result = await inspectWallet(rpc, wallet)
    expect(result.balanceLamports).toBeNull()
    expect(result.standard?.accounts).toHaveLength(1)
    expect(result.warnings.join(' ')).toMatch(/SOL balance/)
  })

  it('does not silently show zero rent when the reserve request fails', async () => {
    const rpc = connection()
    rpc.getMinimumBalanceForRentExemption.mockRejectedValue(new Error('unavailable'))
    const result = await inspectWallet(rpc, wallet)
    expect(result.standard?.potentialAccountCount).toBe(1)
    expect(result.standard?.potentialRentLamports).toBeNull()
    expect(result.warnings.join(' ')).toMatch(/rent/)
  })

  it('reports total read failure instead of an empty successful scan', async () => {
    const rpc = connection()
    rpc.getBalance.mockRejectedValue(new Error('offline'))
    rpc.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('offline'))
    await expect(inspectWallet(rpc, wallet)).rejects.toThrow(/could not/i)
  })
})
