import {describe,expect,it} from 'vitest'
import {Keypair,SystemProgram} from '@solana/web3.js'
import {TokenAuthorityOption} from '@meteora-ag/dynamic-bonding-curve-sdk'
import {buildMeteoraCurveConfig,quoteMeteoraInitialBuy} from '../src/lib/venues/meteora'
import {packVenueTransactions} from '../src/lib/venues/utils'

describe('native Meteora DBC launch terms',()=>{
  it('uses immutable token authority, zero creation charge and no partner allocation',()=>{
    const config=buildMeteoraCurveConfig()
    expect(config.tokenUpdateAuthority).toBe(TokenAuthorityOption.Immutable)
    expect(config.poolCreationFee.isZero()).toBe(true)
    expect(config.partnerLiquidityPercentage+config.partnerPermanentLockedLiquidityPercentage).toBe(0)
    expect(config.creatorPermanentLockedLiquidityPercentage).toBe(100)
    expect(config.creatorTradingFeePercentage).toBe(100)
  })
  it('quotes an initial purchase with nonzero output and rejects curve completion',()=>{
    const config=buildMeteoraCurveConfig(),quote=quoteMeteoraInitialBuy(config,100_000_000n,10)
    expect(quote.minimumAmountOut.isZero()).toBe(false)
    expect(()=>quoteMeteoraInitialBuy(config,85_000_000_000n,10)).toThrow(/threshold|graduat/i)
  })
  it('returns unsigned packets and never silently splits beyond the atomic bundle limit',()=>{
    const payer=Keypair.generate().publicKey
    const instructions=Array.from({length:4},()=>SystemProgram.transfer({fromPubkey:payer,toPubkey:Keypair.generate().publicKey,lamports:1}))
    const transactions=packVenueTransactions(instructions,payer,Keypair.generate().publicKey.toBase58(),500_000n,10000)
    expect(transactions.every(tx=>tx.serialize().length<=1232&&tx.signatures.every(signature=>signature.every(byte=>byte===0)))).toBe(true)
    const oversized=Array.from({length:200},()=>SystemProgram.transfer({fromPubkey:payer,toPubkey:Keypair.generate().publicKey,lamports:1}))
    expect(()=>packVenueTransactions(oversized,payer,Keypair.generate().publicKey.toBase58(),500_000n,10000)).toThrow(/atomic|five/i)
  })
})
