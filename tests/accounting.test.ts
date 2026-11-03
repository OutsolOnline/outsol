import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {decodeConfirmedBalanceChanges,summarizeAccounting,accountingCsv} from '../src/lib/accounting/fills'
import {decodeConfirmedPumpTrades} from '../src/lib/market/events'
import {NOW,mint,wallet,signature,tradeBytes,PUMP} from './token-market-fixtures'

function evidence(options:{buy?:boolean;pre?:string;post?:string;nativeBefore?:number;nativeAfter?:number;logs?:string[];reserveBefore?:number;reserveAfter?:number}={}){
 const ata=Keypair.generate().publicKey.toBase58(),balance=(amount:string)=>({accountIndex:1,mint,owner:wallet,uiTokenAmount:{amount,decimals:6,uiAmount:null,uiAmountString:amount}})
 return {slot:100,blockTime:NOW/1000,transaction:{signatures:[signature],message:{accountKeys:[wallet,ata]}},meta:{err:null,fee:5000,preBalances:[options.nativeBefore??2_000_000_000,options.reserveBefore??0],postBalances:[options.nativeAfter??982_955_720,options.reserveAfter??2_039_280],preTokenBalances:[balance(options.pre??'0')],postTokenBalances:[balance(options.post??'100000000')],logMessages:options.logs??[`Program ${PUMP} invoke [1]`,`Program data: ${tradeBytes({buy:options.buy})}`,`Program ${PUMP} success`]}}
}
describe('confirmed actual-fill accounting',()=>{
 it('uses actual signed wallet deltas and separates network fee and account reserve',()=>{
  const value=evidence(),events=decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)
  const row=decodeConfirmedBalanceChanges(value,signature,mint,events)[0]
  expect(row).toMatchObject({wallet,kind:'buy',tokenDeltaRaw:'100000000',nativeDeltaLamports:'-1017044280',networkFeeLamports:'5000',accountReserveDeltaLamports:'2039280',tradeCashflowLamports:'-1015000000',basisEligible:true})
 })
 it('does not assign quote ceilings or unrelated SOL transfers as trade cost',()=>{
  const value=evidence({nativeAfter:882_955_720}),events=decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)
  expect(decodeConfirmedBalanceChanges(value,signature,mint,events)[0]).toMatchObject({kind:'buy',basisEligible:false,tradeCashflowLamports:null})
 })
 it('retains actual fees when an immediate receiver transfer leaves the buying wallet with zero token change',()=>{
  const value=evidence({pre:'0',post:'0',nativeAfter:999995000,reserveBefore:2039280,reserveAfter:2039280}),events=decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)
  const rows=decodeConfirmedBalanceChanges(value,signature,mint,events)
  expect(rows).toMatchObject([{wallet,tokenDeltaRaw:'0',networkFeeLamports:'5000',basisEligible:false,tradeCashflowLamports:null}])
  expect(summarizeAccounting(rows,[wallet])).toMatchObject({networkFeeLamports:'5000',knownRealizedLamports:'0'})
 })
 it('keeps a closed token account reserve refund separate from actual sale proceeds',()=>{
  const value=evidence({buy:false,pre:'100000000',post:'0',nativeAfter:2_987_034_280,reserveBefore:2039280,reserveAfter:0}),events=decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)
  expect(decodeConfirmedBalanceChanges(value,signature,mint,events)[0]).toMatchObject({kind:'sell',nativeDeltaLamports:'987034280',accountReserveDeltaLamports:'-2039280',tradeCashflowLamports:'985000000',basisEligible:true})
 })
 it('includes actual wrapped SOL spending without mistaking its principal for rent',()=>{
  const value=evidence({nativeAfter:1_997_955_720})
  value.transaction.message.accountKeys.push(Keypair.generate().publicKey.toBase58())
  value.meta.preBalances.push(2_002_039_280);value.meta.postBalances.push(987_039_280)
  const wrapped=(amount:string)=>({accountIndex:2,mint:'So11111111111111111111111111111111111111112',owner:wallet,uiTokenAmount:{amount,decimals:9,uiAmount:null,uiAmountString:amount}})
  value.meta.preTokenBalances.push(wrapped('2000000000'));value.meta.postTokenBalances.push(wrapped('985000000'))
  const events=decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)
  expect(decodeConfirmedBalanceChanges(value,signature,mint,events)[0]).toMatchObject({nativeDeltaLamports:'-2044280',wrappedSolDeltaLamports:'-1015000000',tradeCashflowLamports:'-1015000000',accountReserveDeltaLamports:'2039280',basisEligible:true})
 })
 it('a token transfer is not a sale, and incoming tokens keep unknown basis',()=>{
  const value=evidence({pre:'100000000',post:'50000000',nativeAfter:1_999_995_000,reserveBefore:2039280,reserveAfter:2039280,logs:[]})
  const rows=decodeConfirmedBalanceChanges(value,signature,mint,[])
  expect(rows[0]).toMatchObject({kind:'transfer',tokenDeltaRaw:'-50000000',basisEligible:false,tradeCashflowLamports:null})
  expect(summarizeAccounting(rows,[wallet])).toMatchObject({knownRealizedLamports:'0',unknownSales:0,observedTokenRaw:'50000000',unknownTokenRaw:'50000000'})
 })
 it('does not infer cost basis from matching balances across sampled receipts or slot order',()=>{
  const buy=evidence(),buyRow=decodeConfirmedBalanceChanges(buy,signature,mint,decodeConfirmedPumpTrades(buy,signature,mint,6,NOW/1000))[0]
  const sell={...buyRow,signature:'second',slot:101,kind:'sell' as const,tokenBeforeRaw:'100000000',tokenAfterRaw:'0',tokenDeltaRaw:'-100000000',tradeCashflowLamports:'2000000000',nativeDeltaLamports:'1999995000',accountReserveDeltaLamports:'0'}
  expect(summarizeAccounting([sell,buyRow],[wallet])).toMatchObject({knownRealizedLamports:'0',realizedPnlLamports:null,unknownSales:1,observedTokenRaw:'0'})
  // An omitted sale and repurchase can restore exactly the same balance.
  // Even equal slots do not establish a wallet's complete transaction order.
  for(const slot of [buyRow.slot,buyRow.slot+3])expect(summarizeAccounting([buyRow,{...sell,slot,tradeCashflowLamports:'4000000000'}],[wallet])).toMatchObject({knownRealizedLamports:'0',realizedPnlLamports:null,unknownSales:1})
  expect(summarizeAccounting([sell],[wallet])).toMatchObject({knownRealizedLamports:'0',realizedPnlLamports:null,unknownSales:1})
 })
 it('marks basis unknown across a missing balance interval and ignores duplicate signatures',()=>{
  const value=evidence(),row=decodeConfirmedBalanceChanges(value,signature,mint,decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000))[0]
  const gap={...row,signature:'later',slot:101,kind:'sell' as const,tokenBeforeRaw:'200000000',tokenAfterRaw:'100000000',tokenDeltaRaw:'-100000000',tradeCashflowLamports:'2000000000'}
  const summary=summarizeAccounting([row,row,gap],[wallet])
  expect(summary).toMatchObject({unknownSales:1,unknownTokenRaw:'100000000',networkFeeLamports:'10000'})
  expect(accountingCsv([row])).toContain('-1015000000')
  expect(accountingCsv([row])).not.toContain('maxBuy')
 })
 it.each(['failed','unsafe-native','missing-balances','signature-mismatch'])('rejects %s transaction evidence',kind=>{
  const value=evidence()
  if(kind==='failed')(value.meta as {err:unknown}).err='failed'
  if(kind==='unsafe-native')value.meta.preBalances[0]=Number.MAX_SAFE_INTEGER+1
  if(kind==='missing-balances')value.meta.preBalances=[]
  if(kind==='signature-mismatch')value.transaction.signatures=['other']
  expect(decodeConfirmedBalanceChanges(value,signature,mint,[])).toEqual([])
 })
})
