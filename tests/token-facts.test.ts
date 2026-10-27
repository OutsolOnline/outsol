import { describe, expect, it } from 'vitest'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { pack } from '@solana/spl-token-metadata'
import { readTokenFacts, safeMetadataHref } from '../src/lib/tokenFacts'

const mint = Keypair.fromSeed(new Uint8Array(32).fill(51)).publicKey
const authority = Keypair.fromSeed(new Uint8Array(32).fill(52)).publicKey
function mintAccount() {
  const data = Buffer.alloc(MintLayout.span)
  MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: authority, supply: 123456789n, decimals: 6, isInitialized: true, freezeAuthorityOption: 1, freezeAuthority: authority }, data)
  return { data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1_000_000 }
}
function snapshot(info: ReturnType<typeof mintAccount> | null, curveOwner = SystemProgram.programId) {
  let calls = 0
  return {
    connection: { getMultipleAccountsInfoAndContext: async (keys: PublicKey[], config: unknown) => { calls++; expect(keys[0].equals(mint)).toBe(true); expect(keys).toHaveLength(3); expect(config).toEqual({ commitment: 'confirmed' }); return { context: { slot: 12345 }, value: [info, { owner: curveOwner, data: Buffer.from('not-a-pump-curve'), executable: false, lamports: 0 }, null] } } } as unknown as Connection,
    calls: () => calls,
  }
}

describe('on-chain token facts', () => {
  it('reads one confirmed snapshot and preserves live mint and freeze authorities', async () => {
    const bank = snapshot(mintAccount())
    const facts = await readTokenFacts(bank.connection, mint.toBase58())
    expect(bank.calls()).toBe(1)
    expect(facts).toMatchObject({ slot: 12345, supplyRaw: '123456789', decimals: 6, mintAuthority: authority.toBase58(), freezeAuthority: authority.toBase58(), curveStatus: 'unverified' })
    expect(facts.metadataAuthority).toBeUndefined()
    expect(facts.curveSolRaw).toBeUndefined()
    expect(JSON.stringify(facts)).not.toMatch(/locked|escrow|lpPosition/)
  })

  it('rejects malformed mint identifiers before making an RPC request', async () => {
    const bank = snapshot(mintAccount())
    for (const invalid of ['javascript:alert(1)', '../mint', 'abc?cluster=devnet', '', '0'.repeat(44)]) await expect(readTokenFacts(bank.connection, invalid)).rejects.toThrow()
    expect(bank.calls()).toBe(0)
  })

  it('fails closed for missing, wrong-owner and uninitialized mint accounts', async () => {
    await expect(readTokenFacts(snapshot(null).connection, mint.toBase58())).rejects.toThrow()
    const wrongOwner = mintAccount(); wrongOwner.owner = SystemProgram.programId
    await expect(readTokenFacts(snapshot(wrongOwner).connection, mint.toBase58())).rejects.toThrow()
    const uninitialized = mintAccount(); uninitialized.data[45] = 0
    await expect(readTokenFacts(snapshot(uninitialized).connection, mint.toBase58())).rejects.toThrow(/not initialized/)
  })

  it('only links public HTTPS metadata without fetching arbitrary URLs', () => {
    expect(safeMetadataHref('https://example.com/token.json')).toBe('https://example.com/token.json')
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,hello', 'file:///private', 'https://user:secret@example.com/meta', 'http://example.com', '', undefined]) expect(safeMetadataHref(unsafe)).toBeUndefined()
  })

  it('keeps a mutable metadata pointer distinct from a revoked embedded update authority', async () => {
    const metadata = Buffer.from(pack({ mint, name: 'Immutable embedded fields', symbol: 'PTR', uri: 'https://example.com/pointer.json', additionalMetadata: [] }))
    const pointer = Buffer.concat([authority.toBuffer(), mint.toBuffer()])
    const extension = (type: ExtensionType, value: Buffer) => { const header = Buffer.alloc(4); header.writeUInt16LE(type); header.writeUInt16LE(value.length, 2); return Buffer.concat([header, value]) }
    const tlv = Buffer.concat([extension(ExtensionType.MetadataPointer, pointer), extension(ExtensionType.TokenMetadata, metadata)])
    const account = mintAccount(); account.owner = TOKEN_2022_PROGRAM_ID; account.data = Buffer.alloc(166 + tlv.length)
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 123n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, account.data)
    account.data[165] = 1; tlv.copy(account.data, 166)
    const facts = await readTokenFacts(snapshot(account).connection, mint.toBase58())
    expect(facts.metadataAuthority).toBeNull()
    expect(facts.metadataPointerAuthority).toBe(authority.toBase58())
  })
})
