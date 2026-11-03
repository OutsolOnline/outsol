import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {normalizeCreatorInput,parseCreatorShares,creatorOperationScope,creatorPercentBps} from '../src/lib/creatorOperations/model'
import {CREATOR_PENDING_KEY,readPendingCreatorOperation,savePendingCreatorOperation,readCreatorOperationHistory,saveCreatorOperationReceipt} from '../src/lib/creatorOperations/history'

const address=(seed:number)=>Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey.toBase58()
const payer=address(1),mint=address(2),other=address(3)
function storage(){const disk=new Map<string,string>();return{disk,getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}}}
const input={version:1 as const,kind:'shares' as const,mint,payer,priorityFeeLamports:'1000',shares:[{address:payer,shareBps:2500},{address:other,shareBps:7500}]}
const record=()=>({version:1 as const,intent:{version:1 as const,input,scope:'mint' as const},signature:bs58.encode(new Uint8Array(64).fill(4)),blockhash:address(5),lastValidBlockHeight:200,submittedAt:'2026-11-03T12:00:00.000Z'})

describe('creator operation public contracts',()=>{
 it('retains exact positive basis points through ten recipients without floating point allocation',()=>{
  const shares=Array.from({length:10},(_,i)=>({address:address(i+10),shareBps:i===9?1009:999}))
  expect(parseCreatorShares(shares)).toEqual(shares)
  expect(normalizeCreatorInput(input)).toEqual(input)
 })
 it('rejects ambiguous allocations, duplicate recipients, unknown fields and program recipients',()=>{
  for(const shares of [[],[{address:payer,shareBps:9999}],[{address:payer,shareBps:0},{address:other,shareBps:10000}],[{address:payer,shareBps:5000},{address:payer,shareBps:5000}],[{address:payer,shareBps:10000.1}],[{address:'11111111111111111111111111111111',shareBps:10000}],Array.from({length:11},(_,i)=>({address:address(i+20),shareBps:1000}))])expect(()=>parseCreatorShares(shares)).toThrow()
  expect(()=>normalizeCreatorInput({...input,privateKey:'never persist'})).toThrow()
  expect(()=>parseCreatorShares([{address:payer,shareBps:10000,label:'unverified charity'}])).toThrow()
 })
 it('requires exact fee amounts and distinguishes wallet-wide collection from mint distribution',()=>{
  expect(creatorOperationScope({kind:'collect'})).toBe('wallet-wide')
  expect(creatorOperationScope(input)).toBe('mint')
  for(const priorityFeeLamports of ['-1','01','1.1','10000001'])expect(()=>normalizeCreatorInput({...input,priorityFeeLamports})).toThrow()
  expect(()=>normalizeCreatorInput({...input,kind:'collect'})).toThrow()
 })
 it('accepts two-place percentage input exactly and rejects rounding, scientific notation and zero shares',()=>{
  expect(creatorPercentBps('33.33')).toBe(3333)
  expect(creatorPercentBps('100')).toBe(10000)
  expect(creatorPercentBps('0.01')).toBe(1)
  for(const value of ['0','0.00','01','33.333','1e2','100.01','-1',''])expect(()=>creatorPercentBps(value)).toThrow()
 })
 it('preserves originals and rejects malformed public pending data without overwriting it',()=>{
  const disk=storage(),pending=record()
  savePendingCreatorOperation(pending,disk)
  expect(readPendingCreatorOperation(disk)).toEqual(pending)
  expect(()=>savePendingCreatorOperation({...pending,signature:bs58.encode(new Uint8Array(64).fill(6))},disk)).toThrow(/pending/i)
  const raw=disk.getItem(CREATOR_PENDING_KEY)!
  disk.setItem(CREATOR_PENDING_KEY,JSON.stringify({...pending,transaction:'unsigned packet'}))
  expect(()=>readPendingCreatorOperation(disk)).toThrow(/preserve/i)
  expect(()=>savePendingCreatorOperation(pending,disk)).toThrow()
  expect(disk.getItem(CREATOR_PENDING_KEY)).not.toBe(raw)
 })
 it('moves only the matching original into strict public history and verifies durable writes',()=>{
  const disk=storage(),pending=record();savePendingCreatorOperation(pending,disk)
  expect(()=>saveCreatorOperationReceipt({...pending,blockhash:address(9)},'confirmed',undefined,disk)).toThrow(/changed/i)
  const receipt=saveCreatorOperationReceipt(pending,'confirmed',undefined,disk)
  expect(readPendingCreatorOperation(disk)).toBeNull()
  expect(readCreatorOperationHistory(disk)).toEqual([receipt])
  expect(JSON.stringify(receipt)).not.toMatch(/transaction|privateKey|secret|packet/)
  const failing={...storage(),setItem:()=>{}}
  expect(()=>savePendingCreatorOperation(pending,failing)).toThrow(/saved/i)
 })
 it('rejects an all-zero signature instead of treating an unsigned packet as recoverable spending',()=>{
  const disk=storage()
  expect(()=>savePendingCreatorOperation({...record(),signature:bs58.encode(new Uint8Array(64))},disk)).toThrow()
  expect(disk.getItem(CREATOR_PENDING_KEY)).toBeNull()
 })
})
