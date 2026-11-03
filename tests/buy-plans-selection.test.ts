import {describe,expect,it} from 'vitest'
import {resolveBuyPlanSelection} from '../src/lib/buyPlans/selection'
import type {BuyPlanRow} from '../src/lib/buyPlans/model'
const rows:BuyPlanRow[]=[{id:'buyer-a',walletId:'wallet-a',publicKey:'public-a',name:'A',buySol:'0.01',maxDebitSol:'0.02',delaySeconds:0},{id:'buyer-b',walletId:'wallet-b',publicKey:'public-b',name:'B',buySol:'0.02',maxDebitSol:'0.03',delaySeconds:0}]
describe('staged buyer selection and signing scope',()=>{
 it('moves display, unlock scope and requested review to A when explicitly selected B completes first',()=>{
  const before=resolveBuyPlanSelection({mode:'staged',order:'listed',rows},new Set<string>(), 'buyer-b', ['wallet-b'])
  expect(before.selectedStepId).toBe('buyer-b');expect(before.reviewRowIds).toEqual(['buyer-b']);expect(before.lockedRows).toEqual([])
  const after=resolveBuyPlanSelection({mode:'staged',order:'listed',rows},new Set(['buyer-b']), 'buyer-b', ['wallet-b'])
  expect(after.selectedStepId).toBe('buyer-a');expect(after.reviewRowIds).toEqual(['buyer-a']);expect(after.selectedRows.map(row=>row.walletId)).toEqual(['wallet-a']);expect(after.lockedRows.map(row=>row.walletId)).toEqual(['wallet-a'])
 })
 it('reconciles stale IDs after import/removal and clears selection after all rows complete',()=>{
  const imported=resolveBuyPlanSelection({mode:'staged',order:'reverse',rows},new Set<string>(),'from-another-plan',[])
  expect(imported.selectedStepId).toBe('buyer-b');expect(imported.reviewRowIds).toEqual(['buyer-b'])
  const removed=resolveBuyPlanSelection({mode:'staged',order:'listed',rows:[rows[0]]},new Set<string>(),'buyer-b',[])
  expect(removed.reviewRowIds).toEqual(['buyer-a'])
  const done=resolveBuyPlanSelection({mode:'staged',order:'listed',rows},new Set(['buyer-a','buyer-b']),'buyer-b',[])
  expect(done.selectedStepId).toBe('');expect(done.reviewRowIds).toEqual([]);expect(done.lockedRows).toEqual([])
 })
 it('reviews and unlocks the same remaining rows for a reversed sequence',()=>{
  const selection=resolveBuyPlanSelection({mode:'sequence',order:'reverse',rows},new Set<string>(),'buyer-a',['wallet-a'])
  expect(selection.reviewRowIds).toEqual(['buyer-b','buyer-a']);expect(selection.selectedRows.map(row=>row.walletId)).toEqual(['wallet-b','wallet-a']);expect(selection.lockedRows.map(row=>row.walletId)).toEqual(['wallet-b'])
 })
})
