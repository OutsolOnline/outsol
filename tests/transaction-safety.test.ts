import { describe, expect, it } from 'vitest'
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { validatePumpTransaction } from '../src/lib/transactions/validatePumpTransaction'
import {PUMP_SDK,creatorVaultPda} from '@pump-fun/pump-sdk'

const pump = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
const payer = Keypair.generate()
const mint = Keypair.generate().publicKey
function buy(amount = 100_000_000n): TransactionInstruction {
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], pump)
  const addresses = [PublicKey.findProgramAddressSync([Buffer.from('global')], pump)[0], Keypair.generate().publicKey, mint, curve,
    getAssociatedTokenAddressSync(mint, curve, true), getAssociatedTokenAddressSync(mint, payer.publicKey), payer.publicKey,
    SystemProgram.programId, TOKEN_PROGRAM_ID, Keypair.generate().publicKey,
    PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], pump)[0], pump]
  const data = Buffer.alloc(24)
  Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]).copy(data)
  data.writeBigUInt64LE(1_000_000n, 8)
  data.writeBigUInt64LE(amount, 16)
  return new TransactionInstruction({ programId: pump, data, keys: addresses.map((pubkey, i) => ({ pubkey, isSigner: i === 6, isWritable: [1, 3, 4, 5, 6, 9].includes(i) })) })
}
function transaction(instructions: TransactionInstruction[]) {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message())
}
const policy = { action: 'buy' as const, payer: payer.publicKey, mint, maxSolLamports: 100_000_000n }

describe('transaction intent validation before signing', () => {
  it('binds a reviewed creator vault on buys',()=>{
    const creator=Keypair.generate().publicKey,ix=buy();ix.keys[9].pubkey=creatorVaultPda(creator)
    expect(()=>validatePumpTransaction(transaction([ix]),{...policy,expectedBuyCreator:creator})).not.toThrow()
    ix.keys[9].pubkey=Keypair.generate().publicKey
    expect(()=>validatePumpTransaction(transaction([ix]),{...policy,expectedBuyCreator:creator})).toThrow(/creator vault/)
  })
  it('checks all eleven create flags and rejects extra or truncated tails',async()=>{
    const create=await PUMP_SDK.createV2Instruction({mint,name:'Flags',symbol:'FLAG',uri:'ipfs://flags',creator:payer.publicKey,user:payer.publicKey,mayhemMode:false,cashback:false,holderReward:false})
    const createPolicy={action:'create' as const,payer:payer.publicKey,mint,maxSolLamports:0n}
    expect(()=>validatePumpTransaction(transaction([create]),createPolicy)).not.toThrow()
    for(const offset of [0,1,2,10]){const changed=new TransactionInstruction({...create,data:Buffer.from(create.data)});changed.data[changed.data.length-11+offset]=1;expect(()=>validatePumpTransaction(transaction([changed]),createPolicy)).toThrow()}
    for(const data of [create.data.subarray(0,-1),Buffer.concat([create.data,Buffer.from([0])])])expect(()=>validatePumpTransaction(transaction([new TransactionInstruction({...create,data})]),createPolicy)).toThrow(/flags/)
  })
  it('accepts an expected Pump buy within its SOL ceiling', () => {
    expect(() => validatePumpTransaction(transaction([buy()]), policy)).not.toThrow()
  })
  it('rejects a hidden system transfer even when an expected buy exists', () => {
    const tx = transaction([buy(), SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })])
    expect(() => validatePumpTransaction(tx, policy)).toThrow(/system|transfer/i)
  })
  it('rejects an excessive Pump max SOL cost', () => {
    expect(() => validatePumpTransaction(transaction([buy(100_000_001n)]), policy)).toThrow(/spend|ceiling|budget/i)
  })
  it('rejects an unexpected payer or mint', () => {
    expect(() => validatePumpTransaction(transaction([buy()]), { ...policy, payer: Keypair.generate().publicKey })).toThrow(/payer/i)
    expect(() => validatePumpTransaction(transaction([buy()]), { ...policy, mint: Keypair.generate().publicKey })).toThrow(/mint/i)
  })
  it('rejects instructions that can charge excessive priority fees', () => {
    const tx = transaction([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000_000n }), buy()])
    expect(() => validatePumpTransaction(tx, policy)).toThrow(/priority|fee/i)
  })
  it('rejects an unrelated signer, even on an otherwise allowed program', () => {
    const ix = buy()
    ix.keys.push({ pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true })
    expect(() => validatePumpTransaction(transaction([ix]), policy)).toThrow(/signer/i)
  })
})
