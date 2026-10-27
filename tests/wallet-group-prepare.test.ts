import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { normalizeGroupInput, calculateAvailableWithdrawal } from '../src/lib/walletGroups/prepare'
const address=()=>Keypair.generate().publicKey.toBase58()
const wallet=()=>({id:crypto.randomUUID(),name:'Wallet',address:address()})
describe('exact group SOL plans',()=>{
 it('subtracts network fee and the explicit reserve without hidden clamps',()=>{expect(calculateAvailableWithdrawal(1000000n,5000n,0n,690880n)).toEqual({transfer:995000n,remaining:0n});expect(calculateAvailableWithdrawal(2000000n,5000n,700000n,690880n)).toEqual({transfer:1295000n,remaining:700000n});expect(()=>calculateAvailableWithdrawal(1000000n,5000n,1n,690880n)).toThrow(/reserve/i)})
 it('rejects malformed/duplicate/oversized members and ambiguous amounts before preparing',()=>{const base={kind:'fund' as const,groupName:'Team',payer:address(),amountSol:'0.01',priorityFeeSol:'0',wallets:[wallet()]};expect(normalizeGroupInput(base).wallets).toHaveLength(1);expect(()=>normalizeGroupInput({...base,wallets:[base.wallets[0],base.wallets[0]]})).toThrow(/distinct/i);expect(()=>normalizeGroupInput({...base,wallets:Array.from({length:21},wallet)})).toThrow(/twenty|20/i);expect(()=>normalizeGroupInput({...base,amountSol:'1e-3'})).toThrow();expect(()=>normalizeGroupInput({...base,amountSol:'0.0000000001'})).toThrow()})
 it('accepts only explicit withdrawal modes',()=>{expect(()=>normalizeGroupInput({kind:'withdraw',groupName:'Team',wallets:[wallet()],destination:address(),amountMode:'automatic' as never,reserveSol:'0',priorityFeeSol:'0'})).toThrow(/mode/i)})
})
