import { afterEach, describe, expect, it, vi } from 'vitest'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID, PUMP_SDK, Platform } from '@pump-fun/pump-sdk'
import { verifyCreatorFeeRoutingOnChain } from '../src/lib/creatorFeeRecovery'
import { resolveCreatorFeeRouting } from '../src/lib/creatorFeeRouting'

const payer = Keypair.fromSeed(new Uint8Array(32).fill(81)).publicKey.toBase58()
const mint = Keypair.fromSeed(new Uint8Array(32).fill(82)).publicKey.toBase58()
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(83)).publicKey.toBase58()
const github = { username: 'Alice', userId: '12345', profileUrl: 'https://github.com/Alice', accountType: 'User' as const }
const account = (owner: PublicKey) => ({ owner, data: Buffer.alloc(0), lamports: 1, executable: false })
afterEach(() => vi.restoreAllMocks())

describe('read-only creator fee recovery', () => {
  function bank(routing: ReturnType<typeof resolveCreatorFeeRouting>) {
    const decoded = { creator: new PublicKey(routing.effectiveCreator), quoteMint: PublicKey.default, isHolderReward: routing.holderReward, isCashbackCoin: false }
    const sharing = { mint: new PublicKey(mint), adminRevoked: true, shareholders: [{ address: new PublicKey(routing.socialRecipient || wallet), shareBps: 10000 }] }
    const social = { platform: Platform.GitHub, userId: github.userId }
    vi.spyOn(PUMP_SDK, 'decodeBondingCurve').mockReturnValue(decoded as any)
    vi.spyOn(PUMP_SDK, 'decodeSharingConfig').mockReturnValue(sharing as any)
    vi.spyOn(PUMP_SDK, 'decodeSocialFeePda').mockReturnValue(social as any)
    const rpc = vi.fn(async () => [account(PUMP_PROGRAM_ID), account(PUMP_FEE_PROGRAM_ID), account(PUMP_FEE_PROGRAM_ID)])
    const connection = { getMultipleAccountsInfo: rpc } as unknown as Connection
    return { connection, rpc, decoded, sharing, social }
  }
  it.each([{ kind: 'deployer' as const }, { kind: 'wallet' as const, address: wallet }, { kind: 'holder-rewards' as const }, { kind: 'github' as const, username: 'alice' }])('checks the exact expected route and flags for $kind', async selection => {
    const routing = resolveCreatorFeeRouting({ selection, payer, mint, ...(selection.kind === 'github' ? { github } : {}) })
    const state = bank(routing)
    await expect(verifyCreatorFeeRoutingOnChain(state.connection, routing, { payer, mint })).resolves.toBeUndefined()
    expect(state.rpc).toHaveBeenCalledOnce()
    expect(Object.keys(state.connection)).toEqual(['getMultipleAccountsInfo'])
  })
  it('rejects forged recorded bindings or PDA claims before RPC', async () => {
    const routing = resolveCreatorFeeRouting({ selection: { kind: 'holder-rewards' }, payer, mint })
    const state = bank(routing)
    await expect(verifyCreatorFeeRoutingOnChain(state.connection, routing, { payer: wallet, mint })).rejects.toThrow(/preserved/)
    await expect(verifyCreatorFeeRoutingOnChain(state.connection, { ...routing, effectiveCreator: wallet }, { payer, mint })).rejects.toThrow()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it.each(['creator', 'holder', 'cashback', 'quote', 'owner'])('rejects unexpected curve %s and performs no write', async field => {
    const routing = resolveCreatorFeeRouting({ selection: { kind: 'holder-rewards' }, payer, mint })
    const state = bank(routing)
    if (field === 'creator') state.decoded.creator = new PublicKey(wallet)
    if (field === 'holder') state.decoded.isHolderReward = false
    if (field === 'cashback') state.decoded.isCashbackCoin = true
    if (field === 'quote') state.decoded.quoteMint = new PublicKey(wallet)
    if (field === 'owner') state.rpc.mockResolvedValue([account(SystemProgram.programId)])
    await expect(verifyCreatorFeeRoutingOnChain(state.connection, routing, { payer, mint })).rejects.toThrow(/preserved/)
  })
  it.each(['recipient', 'share', 'extra', 'revoked', 'mint', 'identity', 'platform', 'owner'])('rejects incorrect GitHub %s state', async field => {
    const routing = resolveCreatorFeeRouting({ selection: { kind: 'github', username: 'alice' }, payer, mint, github })
    const state = bank(routing)
    if (field === 'recipient') state.sharing.shareholders[0].address = new PublicKey(wallet)
    if (field === 'share') state.sharing.shareholders[0].shareBps = 9999
    if (field === 'extra') state.sharing.shareholders.push({ address: new PublicKey(wallet), shareBps: 1 })
    if (field === 'revoked') state.sharing.adminRevoked = false
    if (field === 'mint') state.sharing.mint = new PublicKey(wallet)
    if (field === 'identity') state.social.userId = '54321'
    if (field === 'platform') state.social.platform = 1
    if (field === 'owner') state.rpc.mockResolvedValue([account(PUMP_PROGRAM_ID), account(SystemProgram.programId), account(PUMP_FEE_PROGRAM_ID)])
    await expect(verifyCreatorFeeRoutingOnChain(state.connection, routing, { payer, mint })).rejects.toThrow(/preserved/)
  })
})
