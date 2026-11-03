import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {appendAccountingEvidence,readAccountingLedger,ACCOUNTING_LEDGER_KEY} from '../src/lib/accounting/ledger'
import type {TokenBalanceChange} from '../src/lib/market/types'
const mint=Keypair.generate().publicKey.toBase58(),wallet=Keypair.generate().publicKey.toBase58(),signature=bs58.encode(new Uint8Array(64).fill(65))
const row:TokenBalanceChange={mint,wallet,signature,slot:30,timestamp:1793700000,decimals:6,kind:'buy',tokenBeforeRaw:'0',tokenAfterRaw:'1000',tokenDeltaRaw:'1000',nativeDeltaLamports:'-1005000',wrappedSolDeltaLamports:'0',networkFeeLamports:'5000',accountReserveDeltaLamports:'0',tradeCashflowLamports:'-1000000',basisEligible:true}
function storage(){const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}}
describe('persistent confirmed accounting observations',()=>{
 it('retains all checked fills across refreshes, deduplicates evidence and projects only public fields',()=>{
  const disk=storage();appendAccountingEvidence(mint,[{...row,secretKey:'PRIVATE'} as never],'2026-11-03T00:00:00.000Z',disk)
  appendAccountingEvidence(mint,[row],'2026-11-03T01:00:00.000Z',disk)
  expect(readAccountingLedger(disk)).toMatchObject([{checkedAt:'2026-11-03T01:00:00.000Z',change:row}])
  expect(disk.getItem(ACCOUNTING_LEDGER_KEY)).not.toContain('PRIVATE')
 })
 it('rejects conflicting or arithmetically invalid evidence without changing saved observations',()=>{
  const disk=storage();appendAccountingEvidence(mint,[row],'2026-11-03T00:00:00.000Z',disk);const before=disk.getItem(ACCOUNTING_LEDGER_KEY)
  expect(()=>appendAccountingEvidence(mint,[{...row,tokenAfterRaw:'1001'}],'2026-11-03T01:00:00.000Z',disk)).toThrow()
  expect(disk.getItem(ACCOUNTING_LEDGER_KEY)).toBe(before)
  expect(()=>appendAccountingEvidence(mint,[{...row,slot:31}],'2026-11-03T01:00:00.000Z',disk)).toThrow(/conflict/)
  expect(disk.getItem(ACCOUNTING_LEDGER_KEY)).toBe(before)
 })
 it('preserves corrupt data and never assigns trade basis to incoming transfers',()=>{
  const disk=storage();disk.setItem(ACCOUNTING_LEDGER_KEY,'{')
  expect(()=>appendAccountingEvidence(mint,[row],'2026-11-03T00:00:00.000Z',disk)).toThrow(/Preserve/)
  expect(disk.getItem(ACCOUNTING_LEDGER_KEY)).toBe('{')
  expect(()=>appendAccountingEvidence(mint,[{...row,kind:'transfer'}],'2026-11-03T00:00:00.000Z',storage())).toThrow(/basis/)
 })
})
