import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {pumpIdl} from '@pump-fun/pump-sdk'
import {decodeConfirmedPumpEvidence,decodeConfirmedPumpTrades,buildCandles,mergeTrades} from '../src/lib/market/events'

import {NOW,PUMP,mint,signature,tradeBytes,tx} from './token-market-fixtures'

describe('confirmed official curve trade evidence',()=>{
 it('distinguishes complete non-trades from unknown Pump event schemas',()=>{
  const known=pumpIdl.events.find(row=>row.name==='ExtendAccountEvent')!
  const logs=(data:Buffer)=>[`Program ${PUMP} invoke [1]`,`Program data: ${data.toString('base64')}`,`Program ${PUMP} success`]
  expect(decodeConfirmedPumpEvidence(tx([]),signature,mint,6,NOW/1000)).toEqual({status:'complete',trades:[]})
  expect(decodeConfirmedPumpEvidence(tx(logs(Buffer.from(known.discriminator))),signature,mint,6,NOW/1000)).toEqual({status:'complete',trades:[]})
  expect(decodeConfirmedPumpEvidence(tx(logs(Buffer.alloc(8,255))),signature,mint,6,NOW/1000)).toEqual({status:'unsupported',trades:[]})
 })
 it('keeps malformed discarded child logs from invalidating a complete successful parent',()=>{
  const logs=[`Program ${PUMP} invoke [1]`,`Program ${PUMP} invoke [2]`,'Program data: !!!!',`Program ${PUMP} failed: caught`,`Program data: ${tradeBytes()}`,`Program ${PUMP} success`]
  const evidence=decodeConfirmedPumpEvidence(tx(logs),signature,mint,6,NOW/1000)
  expect(evidence.status).toBe('complete');expect(evidence.trades.map(row=>row.ordinal)).toEqual([4])
 })
 it('does not publish a partial trade set when a successful frame has unreadable event bytes',()=>{
  const value=tx([`Program ${PUMP} invoke [1]`,`Program data: ${tradeBytes()}`,'Program data: !!!!',`Program ${PUMP} success`])
  expect(decodeConfirmedPumpEvidence(value,signature,mint,6,NOW/1000)).toEqual({status:'invalid',trades:[]})
 })
 it('keeps two fills in one signature with distinct stable event ordinals',()=>{
  const value=tx([`Program ${PUMP} invoke [1]`,`Program data: ${tradeBytes()}`,`Program data: ${tradeBytes({buy:false,sol:2_000_000_000n})}`,`Program ${PUMP} success`])
  const rows=decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)
  expect(rows.map(row=>[row.side,row.tokenAmountRaw,row.priceSol,row.ordinal])).toEqual([['buy','100000000',0.01,1],['sell','100000000',0.02,2]])
  expect(mergeTrades([...rows,...rows])).toHaveLength(2)
 })
 it('drops a successful Pump child when its enclosing program later fails',()=>{
  const other=Keypair.generate().publicKey.toBase58()
  expect(decodeConfirmedPumpTrades(tx([`Program ${other} invoke [1]`,`Program ${PUMP} invoke [2]`,`Program data: ${tradeBytes()}`,`Program ${PUMP} success`,`Program ${other} failed: caught`]),signature,mint,6,NOW/1000)).toEqual([])
 })
 it('ignores nested emitters and failed Pump children while retaining a successful parent event',()=>{
  const other=Keypair.generate().publicKey.toBase58()
  const logs=[`Program ${PUMP} invoke [1]`,`Program ${other} invoke [2]`,`Program data: ${tradeBytes()}`,`Program ${other} success`,`Program ${PUMP} invoke [2]`,`Program data: ${tradeBytes()}`,`Program ${PUMP} failed: caught`,`Program data: ${tradeBytes()}`,`Program ${PUMP} success`]
  expect(decodeConfirmedPumpTrades(tx(logs),signature,mint,6,NOW/1000).map(row=>row.ordinal)).toEqual([7])
 })
 it.each(['failed','truncated','mismatch','non-sol','wrong-mint','bad-base64'])('publishes no misleading trade on %s evidence',kind=>{
  const value=tx()
  if(kind==='failed')(value.meta as {err:unknown}).err={InstructionError:[0,'Custom']}
  if(kind==='truncated')value.meta.logMessages.pop()
  if(kind==='mismatch')value.transaction.signatures=[bs58.encode(new Uint8Array(64).fill(8))]
  if(kind==='non-sol')value.meta.logMessages[1]=`Program data: ${tradeBytes({quote:Keypair.generate().publicKey.toBase58()})}`
  if(kind==='wrong-mint')value.meta.logMessages[1]=`Program data: ${tradeBytes({mint:Keypair.generate().publicKey.toBase58()})}`
  if(kind==='bad-base64')value.meta.logMessages[1]='Program data: !!!!'
  expect(decodeConfirmedPumpTrades(value,signature,mint,6,NOW/1000)).toEqual([])
 })
 it('builds OHLC only for observed minute buckets without invented gap prices',()=>{
  const row=decodeConfirmedPumpTrades(tx(),signature,mint,6,NOW/1000)[0]
  expect(buildCandles([{...row,id:'a',timestamp:120,priceSol:1},{...row,id:'b',timestamp:130,priceSol:3},{...row,id:'c',timestamp:300,priceSol:2}])).toEqual([{timestamp:120,open:1,high:3,low:1,close:3,volumeSol:2,trades:2},{timestamp:300,open:2,high:2,low:2,close:2,volumeSol:1,trades:1}])
 })
})
