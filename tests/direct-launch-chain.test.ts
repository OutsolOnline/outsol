import { describe, expect, it } from 'vitest'
import { AddressLookupTableAccount, Keypair, PublicKey } from '@solana/web3.js'
import { WITHDRAWOR_PUBLIC_KEY } from '@streamflow/stream'
import { readStreamflowLockFees, assertTrustedProgram, assertUsableLookupTable } from '../src/lib/launch'

describe('direct launch chain configuration', () => {
  it('reads current lock fee and creation fee from the on-chain oracle, not SDK fallback defaults', () => {
    const data = Buffer.alloc(64)
    data.writeUInt32LE(1, 0)
    WITHDRAWOR_PUBLIC_KEY.toBuffer().copy(data, 4)
    data.writeUInt32LE(160000000, 36)
    data.writeUInt32LE(250000000, 40)
    data.writeFloatLE(0.19, 44)
    data.writeFloatLE(0.5, 48)
    expect(readStreamflowLockFees(data)).toEqual({ creationFeeSol: 160000000, streamflowLockFee: 0.5, partnerFee: 0 })
  })

  it('fails closed for absent or malformed lock fee information', () => {
    expect(() => readStreamflowLockFees(Buffer.alloc(4))).toThrow(/fee/i)
    const bad = Buffer.alloc(64)
    bad.writeUInt32LE(2)
    expect(() => readStreamflowLockFees(bad)).toThrow(/fee/i)
  })

  it('rejects a non-executable or incorrectly owned program account', () => {
    const account = { executable: true, owner: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'), data: Buffer.alloc(0), lamports: 1, rentEpoch: 1 }
    expect(() => assertTrustedProgram(account, 'Raydium')).not.toThrow()
    expect(() => assertTrustedProgram({ ...account, executable: false }, 'Raydium')).toThrow(/program/i)
    expect(() => assertTrustedProgram({ ...account, owner: PublicKey.default }, 'Raydium')).toThrow(/program/i)
    expect(() => assertTrustedProgram(null, 'Streamflow')).toThrow(/program/i)
  })

  it('rejects unavailable, deactivated and same-slot lookup tables', () => {
    const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 100, lastExtendedSlotStartIndex: 0, addresses: [PublicKey.default] } })
    expect(() => assertUsableLookupTable(null, 101)).toThrow(/lookup/i)
    expect(() => assertUsableLookupTable(table, 100)).toThrow(/slot/i)
    expect(() => assertUsableLookupTable(table, 101)).not.toThrow()
    table.state.deactivationSlot = BigInt(101)
    expect(() => assertUsableLookupTable(table, 102)).toThrow(/active/i)
  })
})
