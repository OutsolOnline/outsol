import {describe,it,expect} from 'vitest'
import {fetchTokenMarket} from '../src/lib/market/client'
import {performanceSvg,formatEvidenceAmount} from '../src/lib/accounting/export'
import {NOW,mint,signature} from './token-market-fixtures'
describe('market client boundary and evidence export',()=>{
 it('uses only the local read-only route and requested canonical receipt signatures',async()=>{
  const value={status:'ready',mint,fetchedAt:new Date(NOW).toISOString(),decimals:6,supplyRaw:'1000000000',curveStatus:'active',trades:[],candles:[],balanceChanges:[],distribution:{status:'ready',owners:[],sampledAccounts:0,sampledAmountRaw:'0',sampledSupplyPct:0,slot:1},coverage:{kind:'receipts',requested:1,read:0,missing:1,unsupported:0,failed:0,invalid:0,complete:false},warnings:[]}
  const fetched=await fetchTokenMarket(mint,[signature],undefined,async(url)=>{const request=new URL(String(url),'https://outsol.example');expect(request.pathname).toBe('/api/token-market');expect(request.searchParams.getAll('signature')).toEqual([signature]);return Response.json(value)})
  expect(fetched.coverage.missing).toBe(1)
 })
 it.each(['foreign-mint','invented-completeness','unbounded-items','bad-response'])('rejects %s response rather than presenting it as evidence',async kind=>{
  const value={status:'ready',mint:kind==='foreign-mint'?signature:mint,fetchedAt:new Date(NOW).toISOString(),trades:[] as unknown[],candles:[],balanceChanges:[],distribution:{owners:[]},coverage:{complete:kind==='invented-completeness'},warnings:[]}
  if(kind==='unbounded-items')value.trades=Array(300).fill({})
  const transport=async()=>kind==='bad-response'?new Response('<html>',{status:503}):Response.json(value)
  await expect(fetchTokenMarket(mint,[],undefined,transport)).rejects.toThrow()
 })
 it('exports incomplete basis as unknown, preserves signed values and embeds no external resources',()=>{
  const svg=performanceSvg({knownRealizedLamports:'-123000000',realizedPnlLamports:null,unknownSales:2,observedTokenRaw:'1000000',unknownTokenRaw:'1000000',networkFeeLamports:'5000',accountReserveDeltaLamports:'2039280',transactions:3,completeHistory:false},mint,new Date(NOW).toISOString())
  expect(svg).toContain('Unavailable');expect(svg).not.toContain('-0.123');expect(formatEvidenceAmount('-123000000',9,9)).toBe('-0.123');expect(svg).toContain('2 sales with unknown basis');expect(svg).toContain('sampled transaction coverage');expect(svg).not.toMatch(/href=|<script|<foreignObject/)
 })
})
