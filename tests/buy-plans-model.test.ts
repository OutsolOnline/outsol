import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {parseBuyPlan,readBuyPlan,saveBuyPlan,orderedBuyRows,solLamports} from '../src/lib/buyPlans/model'

const wallet=(id:string)=>({id,walletId:id,publicKey:Keypair.generate().publicKey.toBase58(),name:id,buySol:'0.01',maxDebitSol:'0.025',delaySeconds:0})
export const plan=()=>({version:1 as const,id:crypto.randomUUID(),name:'Start later',createdAt:1000,updatedAt:1000,mode:'staged' as const,order:'listed' as const,intervalSeconds:3,slippage:5,priorityFeeSol:'0.0001',maxTotalDebitSol:'0.05',rows:[wallet('one'),wallet('two')]})
const storage=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}

describe('public staged buy plans',()=>{
 it('preserves public preparation without a mint and refuses secrets in imported plans',()=>{
  const value=plan(),safe=parseBuyPlan(value)
  expect(safe.mint).toBeUndefined();expect(safe.rows).toHaveLength(2)
  expect(()=>parseBuyPlan({...value,privateKey:'never-save'})).toThrow(/public|field/i)
  expect(()=>parseBuyPlan({...value,rows:[{...value.rows[0],secretKey:'never-save'}]})).toThrow(/public|field/i)
 })
 it('enforces exact SOL ceilings, separate wallet identities, and detached requested order',()=>{
  const value=plan()
  expect(solLamports('0.000000001')).toBe(1n)
  for(const invalid of ['NaN','1e-9','0.0000000001','-1'])expect(()=>solLamports(invalid)).toThrow()
  expect(()=>parseBuyPlan({...value,rows:[value.rows[0],{...value.rows[1],publicKey:value.rows[0].publicKey}]})).toThrow(/distinct|duplicate/i)
  expect(()=>parseBuyPlan({...value,rows:[{...value.rows[0],maxDebitSol:'0.001'}]})).toThrow(/ceiling|budget/i)
  expect(()=>parseBuyPlan({...value,maxTotalDebitSol:'0.049'})).toThrow(/aggregate|total/i)
  const rows=orderedBuyRows({...value,order:'reverse'});expect(rows.map(row=>row.id)).toEqual(['two','one']);rows[0].name='changed';expect(value.rows[1].name).toBe('two')
 })
 it('never overwrites corrupt saved work or a concurrent edit',()=>{
  const disk=storage(),value=plan();saveBuyPlan(value,disk,null)
  expect(readBuyPlan(disk)?.id).toBe(value.id)
  expect(()=>saveBuyPlan({...value,name:'stale'},disk,null)).toThrow(/changed/i)
  const broken={getItem:()=>'{bad',setItem:()=>{throw Error('must not write')}}
  expect(()=>saveBuyPlan(value,broken)).toThrow(/cannot be read/i)
 })
})
