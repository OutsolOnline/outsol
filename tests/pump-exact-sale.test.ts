import {describe,expect,it} from 'vitest'
import {resolveSellAmountRaw} from '../src/lib/pumpfun/sellAmount'

describe('native exact received-only sale amounts',()=>{
 it('retains the reviewed receipts exactly and leaves the pre-existing receiver balance',()=>{
  const fullBalance=874004116399n,received='739449266109'
  const amount=resolveSellAmountRaw(fullBalance,100,received)
  expect(amount).toBe(739449266109n)
  expect(fullBalance-amount).toBe(134554850290n)
  expect(resolveSellAmountRaw(fullBalance,100,'1')).toBe(1n)
 })
 it('preserves existing percentage defaults and exact full-balance sales',()=>{
  expect(resolveSellAmountRaw(1001n,25)).toBe(250n)
  expect(resolveSellAmountRaw(1001n,100)).toBe(1001n)
  expect(resolveSellAmountRaw(1001n,25.99)).toBe(260n)
  expect(resolveSellAmountRaw(1001n,100,'1001')).toBe(1001n)
  expect(resolveSellAmountRaw(18446744073709551615n,100,'18446744073709551615')).toBe(18446744073709551615n)
 })
 it.each(['0','1002','01','-1','1.5','1e2','18446744073709551616','',null,100])('rejects an invalid or excessive exact amount (%s)',exact=>{
  expect(()=>resolveSellAmountRaw(1001n,100,exact as string)).toThrow()
 })
 it('does not accept invalid balance or percentage inputs even with an exact override',()=>{
  for(const percent of [0,101,NaN,Infinity])expect(()=>resolveSellAmountRaw(1001n,percent,'1')).toThrow()
  for(const balance of [-1n,0n,18446744073709551616n])expect(()=>resolveSellAmountRaw(balance,100,'1')).toThrow()
  expect(()=>resolveSellAmountRaw(1n,1)).toThrow()
 })
})
