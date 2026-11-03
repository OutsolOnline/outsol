import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {StrategyQueueStepReview,StrategyQueueGuardReview} from '../src/components/tradingSessions/StrategyQueueStepReview'
import type {StrategyQueueStep} from '../src/lib/tradingSessions/queueModel'

const addresses=Array.from({length:8},()=>Keypair.generate().publicKey.toBase58())
const step:StrategyQueueStep={id:'first',name:'Stored first strategy',config:{version:1,mode:'dca',walletId:'first-wallet',payer:addresses[0],mint:addresses[1],action:'buy',buySol:'0.012345678',sellPercent:100,maxTrades:2,intervalMs:7000,durationMs:55000,maxDebitSol:'0.123456789',slippage:7.5,priorityFeeSol:0.000123456,relay:{walletId:'receiver-x',destination:addresses[2],maxDebitSol:'0.004321'}}}
describe('material stored strategy configuration before approval',()=>{
 it('shows each stored mint and receiver separately, along with its complete timing and spending rules',()=>{
  const first=renderToStaticMarkup(<StrategyQueueStepReview step={step} position={1} totalSteps={2} confirmedTrades={1} reservedDebitLamports="23000000" walletName="Source A"/>),secondStep:StrategyQueueStep={...step,id:'second',config:{...step.config,payer:addresses[3],mint:addresses[4],relay:{walletId:'receiver-y',destination:addresses[5],maxDebitSol:'0.006543'}}},second=renderToStaticMarkup(<StrategyQueueStepReview step={secondStep} position={2} totalSteps={2} confirmedTrades={0} reservedDebitLamports="0" walletName="Source B"/>)
  for(const value of ['Source A',addresses[0],addresses[1],addresses[2],'0.004321','0.012345678','0.123456789','0.023','0.100456789','7.5%','0.000123456','7 seconds','55 seconds','1 of 2'])expect(first).toContain(value)
  expect(first).toContain(`href="/token/${addresses[1]}"`);expect(first).toContain(`href="https://solscan.io/account/${addresses[2]}"`)
  expect(first).not.toContain(addresses[4]);expect(first).not.toContain(addresses[5])
  for(const value of ['Source B',addresses[3],addresses[4],addresses[5],'0.006543','2 of 2'])expect(second).toContain(value)
  expect(second).not.toContain(addresses[1]);expect(second).not.toContain(addresses[2])
 })
 it('reveals stored cap direction and sell sizing, and explicitly identifies purchases without Relay',()=>{
  const cap:StrategyQueueStep={id:'cap',name:'Cap sale',config:{...step.config,mode:'cap',action:'sell',sellPercent:37,maxTrades:1,capDirection:'at-or-above',capSol:'123.456789',relay:undefined}}
  const html=renderToStaticMarkup(<StrategyQueueStepReview step={cap} position={1} totalSteps={1} confirmedTrades={0} reservedDebitLamports="0"/>)
  expect(html).toContain('37% of remaining');expect(html).toContain('At or above');expect(html).toContain('123.456789 SOL');expect(html).toContain('No Relay transfer');expect(html).not.toContain(addresses[2])
 })
 it('reviews the exact stored launch filters and observed counter/stop whitelists without relying on the current form',()=>{
  const launch:StrategyQueueStep={id:'launch',name:'Launch filter',config:{...step.config,mode:'new-launch',mint:undefined,creator:addresses[6],keyword:'meme & art',relay:undefined}}
  const html=renderToStaticMarkup(<StrategyQueueStepReview step={launch} position={1} totalSteps={1} confirmedTrades={0} reservedDebitLamports="0"/>)
  expect(html).toContain(addresses[6]);expect(html).toContain('meme &amp; art');expect(html).toContain('Both filters');expect(html).not.toContain(`/token/${addresses[1]}`)
  const counter=renderToStaticMarkup(<StrategyQueueStepReview step={{...step,counter:{minBuySol:'0.345',whitelist:[addresses[7]]}}} position={1} totalSteps={1} confirmedTrades={0} reservedDebitLamports="0"/>)
  expect(counter).toContain('At least 0.345 SOL');expect(counter).toContain(addresses[7])
  const guard=renderToStaticMarkup(<StrategyQueueGuardReview rule={{minBuySol:'5.678',whitelist:[addresses[6],addresses[7]]}}/>)
  expect(guard).toContain('Strictly greater than 5.678 SOL');expect(guard).toContain(addresses[6]);expect(guard).toContain(addresses[7])
 })
})
