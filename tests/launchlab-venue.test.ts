import {describe,expect,it} from 'vitest'
import {Keypair,PublicKey,SystemProgram,TransactionMessage} from '@solana/web3.js'
import {LaunchpadConfig,PlatformConfig,LAUNCHPAD_PROGRAM,LAUNCHPAD_PLATFORM,anchorDataBuf} from '@raydium-io/raydium-sdk-v2'
import {NATIVE_MINT} from '@solana/spl-token'
import BN from 'bn.js'
import {buildLaunchLabInstructions} from '../src/lib/venues/launchlab'

function fixture(){
  const config={...LaunchpadConfig.decode(Buffer.alloc(LaunchpadConfig.span)),mintB:NATIVE_MINT,minSupplyA:new BN(1),minFundRaisingB:new BN(1),minSellRateA:new BN(1),minMigrateRateA:new BN(1),maxLockRate:new BN(1_000_000),tradeFeeRate:new BN(2500)}
  const platform={...PlatformConfig.decode(Buffer.alloc(PlatformConfig.span)),feeRate:new BN(7500),creatorFeeRate:new BN(500)}
  return {config,platform,slot:1,blockhash:Keypair.generate().publicKey.toBase58(),wrappedSolRent:2039280,estimatedAccountRent:30_000_000}
}
const base=()=>({venue:'raydium-launchlab' as const,payer:Keypair.generate().publicKey,mintKeypair:Keypair.generate(),name:'LaunchLab Test',symbol:'LTEST',metadataUri:'https://example.com/venue.json',initialBuySol:0.1,slippage:10,priorityFeeSol:0.0005,jitoTipLamports:10000})
describe('native LaunchLab transaction intent',()=>{
  it('uses the canonical program and platform, zero referral, and a fixed maximum SOL input',async()=>{
    const input=base(),plan=await buildLaunchLabInstructions(input,fixture())
    const instructions=plan.transactions.flatMap(tx=>TransactionMessage.decompile(tx.message).instructions)
    const create=instructions.find(ix=>ix.programId.equals(LAUNCHPAD_PROGRAM)&&ix.data.subarray(0,8).equals(anchorDataBuf.initializeV2))!
    const buy=instructions.find(ix=>ix.programId.equals(LAUNCHPAD_PROGRAM)&&ix.data.subarray(0,8).equals(anchorDataBuf.buyExactIn))!
    expect(create.keys[3].pubkey.equals(LAUNCHPAD_PLATFORM)).toBe(true)
    expect(buy.data.readBigUInt64LE(8)).toBe(100_000_000n)
    expect(buy.data.readBigUInt64LE(24)).toBe(0n)
    expect(plan.summary.platformFeeBps).toBe(0)
    expect(plan.requiresAtomicBundle).toBe(true)
    expect(plan.transactions.every(tx=>tx.serialize().length<=1232)).toBe(true)
    expect(plan.transactions.every(tx=>tx.signatures[0].every(byte=>byte===0))).toBe(true)
  })
  it('rejects an unbounded input or unsupported restricted platform before building',async()=>{
    await expect(buildLaunchLabInstructions({...base(),initialBuySol:NaN},fixture())).rejects.toThrow(/amount|finite|SOL/i)
    const state=fixture();state.platform.restrictGlobalConfig=1
    await expect(buildLaunchLabInstructions(base(),state)).rejects.toThrow(/restrict/i)
  })
  it('creates without a buy or tip when no initial purchase was selected',async()=>{
    const plan=await buildLaunchLabInstructions({...base(),initialBuySol:0},fixture())
    const transfers=plan.transactions.flatMap(tx=>TransactionMessage.decompile(tx.message).instructions).filter(ix=>ix.programId.equals(SystemProgram.programId)&&ix.data.readUInt32LE(0)===2)
    expect(plan.requiresAtomicBundle).toBe(false)
    expect(plan.transactions).toHaveLength(1)
    expect(transfers).toHaveLength(0)
  })
})
