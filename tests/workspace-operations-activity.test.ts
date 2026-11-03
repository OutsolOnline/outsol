import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID} from '@solana/spl-token'
import bs58 from 'bs58'
import {readWorkspaceActivity,filterWorkspaceActivity} from '../src/lib/workspaceActivity'
import {RELAY_RECEIPTS_KEY} from '../src/lib/relay/history'
import {SALE_HISTORY_KEY} from '../src/lib/sales/history'
import {SESSION_HISTORY_KEY} from '../src/lib/tradingSessions/history'
import {BATCH_JOURNAL_KEY} from '../src/lib/multiLaunch/history'
import {TRADE_HISTORY_KEY} from '../src/lib/venues/tradeHistory'
import {CREATOR_PENDING_KEY} from '../src/lib/creatorOperations/history'
import {BUY_PLAN_HISTORY_KEY} from '../src/lib/buyPlans/history'
import {SUPPLY_LOCK_PENDING_KEY} from '../src/lib/supplyLocks/history'
import {lockAddresses,supplyLockFees} from '../src/lib/supplyLocks/model'
import {STRATEGY_QUEUE_HISTORY_KEY} from '../src/lib/tradingSessions/queueHistory'
import {CONSOLIDATION_KEY} from '../src/lib/consolidation/model'
const payer=Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey.toBase58(),receiver=Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey.toBase58()
const signature=(n:number)=>bs58.encode(new Uint8Array(64).fill(n)),time='2026-11-03T09:00:00.000Z'
const storage=(data:Record<string,unknown>)=>({getItem:(key:string)=>data[key]===undefined?null:JSON.stringify(data[key])})
const sale={version:1,id:'sale-1',createdAt:Date.parse(time),updatedAt:Date.parse(time),status:'completed',rows:[{walletId:'a',walletName:'A Receiver',payer:receiver,mint,amountRaw:'1000',decimals:6,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),status:'confirmed',signature:signature(21)}]}

describe('workspace discovery of dedicated operation journals',()=>{
 it('discovers supply escrow, queued strategy and consolidation originals with the correct recovery workspace',()=>{
  const intent={version:1,mint,payer,recipient:receiver,amountRaw:'1000000',unlockAt:2000000000,priorityFeeLamports:'0',tokenProgram:TOKEN_PROGRAM_ID.toBase58(),decimals:6,nonce:123,feeUnits:5000,creationFeeLamports:'160000000',maxDebitLamports:'170000000',...lockAddresses({mint,payer},123),...supplyLockFees('1000000',5000)}
  const lock={version:1,intent,signature:signature(31),blockhash:payer,lastValidBlockHeight:300,submittedAt:time}
  const config={version:1,mode:'dca',walletId:'a',payer,action:'buy',mint,buySol:'0.01',sellPercent:100,maxTrades:1,intervalMs:5000,durationMs:10000,maxDebitSol:'0.02',slippage:5,priorityFeeSol:0}
  const session={version:1,id:'session2',config,status:'unknown',phase:'sending',armedAt:Date.parse(time),updatedAt:Date.parse(time),reservedDebitLamports:'10000000',rows:[{index:0,mint,action:'buy',status:'unknown',debitReservedLamports:'10000000',createdAt:Date.parse(time),signature:signature(32)}]}
  const queue={version:1,id:'queue1',config:{version:1,id:'config1',name:'Queue one',steps:[{id:'step1',name:'First step',config}],maxDebitSol:'0.02',durationMs:10000},status:'unknown',startedAt:Date.parse(time),updatedAt:Date.parse(time),activeElapsedMs:0,reservedDebitLamports:'10000000',attempts:[{stepId:'step1',journal:session}]}
  const input={source:payer,destination:receiver,mint,sourceAccount:mint,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),amountRaw:'1000',decimals:6,priorityFeeLamports:'0'}
  const consolidation={version:1,id:'12345678-1234-1234-1234-123456789012',mint,receiver:{walletId:'b',address:receiver},group:null,rows:[{walletId:'a',input,status:'unknown',signature:signature(33)}],createdAt:Date.parse(time),updatedAt:Date.parse(time),revision:1,closed:false,sale:{attempted:false,status:'none'}}
  const result=readWorkspaceActivity(storage({[SUPPLY_LOCK_PENDING_KEY]:lock,[STRATEGY_QUEUE_HISTORY_KEY]:[queue],[CONSOLIDATION_KEY]:[consolidation]}))
  expect(result.warnings).toEqual([])
  expect(result.items.find(row=>row.kind==='lock')).toMatchObject({status:'pending',recoveryHref:`/token/${mint}?section=supply`})
  expect(result.items.find(row=>row.kind==='queue')).toMatchObject({status:'pending',signatures:[signature(32)],recoveryHref:'/automations'})
  expect(result.items.find(row=>row.kind==='consolidation')).toMatchObject({status:'pending',signatures:[signature(33)],recoveryHref:`/token/${mint}?section=supply`})
 })
 it('finds wallet-wide creator claims and staged purchases with their original recovery context',()=>{
  const pending={version:1,intent:{version:1,input:{version:1,kind:'collect',payer,mint,priorityFeeLamports:'0'},scope:'wallet-wide'},signature:signature(27),blockhash:payer,lastValidBlockHeight:300,submittedAt:time}
  const run={version:1,id:'run1',planId:'plan1',planName:'Staged launch',mint,status:'completed',createdAt:Date.parse(time),updatedAt:Date.parse(time),rows:[{rowId:'row1',walletId:'wallet1',name:'A',payer,buyLamports:'1000000',maxDebitLamports:'2000000',status:'confirmed',signature:signature(28),blockhash:payer,expiresAfterBlockHeight:300,submittedAt:Date.parse(time)}]}
  const result=readWorkspaceActivity(storage({[CREATOR_PENDING_KEY]:pending,[BUY_PLAN_HISTORY_KEY]:[run]}))
  expect(result.warnings).toEqual([])
  expect(result.items.find(row=>row.kind==='creator')).toMatchObject({status:'pending',description:expect.stringMatching(/wallet-wide/),signatures:[signature(27)],recoveryHref:`/token/${mint}?section=creator`})
  expect(result.items.find(row=>row.kind==='buy-plan')).toMatchObject({status:'confirmed',signatures:[signature(28)],recoveryHref:`/token/${mint}?section=buys`})
 })
 it('shows a standalone receiver sale once with its recovery context',()=>{
  const result=readWorkspaceActivity(storage({[SALE_HISTORY_KEY]:[sale],[TRADE_HISTORY_KEY]:[{action:'sell',mint,payer:receiver,signature:signature(21),status:'confirmed',resolvedAt:time,submittedAt:time}]}))
  expect(result.warnings).toEqual([])
  expect(result.items).toMatchObject([{kind:'sale',status:'confirmed',mint,signatures:[signature(21)],recoveryHref:'/bundler'}])
  expect(result.items).toHaveLength(1)
  expect(filterWorkspaceActivity(result.items,'trades','')).toHaveLength(1)
 })
 it('includes original Relay signatures while excluding unsubmitted sale preparation',()=>{
  const relay={source:payer,destination:receiver,mint,sourceAccount:mint,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),amountRaw:'1000',decimals:6,priorityFeeLamports:'0',signature:signature(22),blockhash:payer,lastValidBlockHeight:300,genesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',createdAt:time,status:'unknown',debitLamports:'5000',error:'PRIVATE'}
  const result=readWorkspaceActivity(storage({[RELAY_RECEIPTS_KEY]:[relay],[SALE_HISTORY_KEY]:[{...sale,status:'ready',rows:[{...sale.rows[0],status:'ready',signature:signature(23)}]}]}))
  expect(result.items).toMatchObject([{kind:'relay',status:'pending',recoveryHref:'/relay',signatures:[signature(22)]}])
  expect(result.items).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
  expect(filterWorkspaceActivity(result.items,'wallets','')).toHaveLength(1)
 })
 it('finds saved trading-session and multi-launch executions without rearming either',()=>{
  const config={version:1,mode:'dca',walletId:'a',payer,action:'buy',mint,buySol:'0.01',sellPercent:100,maxTrades:1,intervalMs:5000,durationMs:10000,maxDebitSol:'0.02',slippage:5,priorityFeeSol:0}
  const session={version:1,id:'session1',config,status:'running',phase:'sending',armedAt:Date.parse(time),updatedAt:Date.parse(time),reservedDebitLamports:'10000000',rows:[{index:0,mint,action:'buy',status:'unknown',debitReservedLamports:'10000000',createdAt:Date.parse(time),signature:signature(24)}]}
  const row={mint,name:'A',symbol:'A',metadataUri:'https://example.com/m.json',maxBuyLamports:'0',debitLamports:'5000',status:'confirmed',signatures:[signature(25)]}
  const batch={version:1,id:'12345678-1234-1234-1234-123456789012',payer,startedAt:time,updatedAt:time,totalDebitLamports:'10000',status:'confirmed',rows:[row,{...row,mint:receiver,signatures:[signature(26)]}]}
  const result=readWorkspaceActivity(storage({[SESSION_HISTORY_KEY]:[session],[BATCH_JOURNAL_KEY]:batch}))
  expect(result.warnings).toEqual([])
  expect(result.items.find(item=>item.kind==='session')).toMatchObject({status:'pending',recoveryHref:'/automations'})
  expect(result.items.filter(item=>item.kind==='launch')).toHaveLength(2)
 })
 it('retains other sources when one dedicated journal is corrupt',()=>{
  const result=readWorkspaceActivity({getItem:key=>key===SALE_HISTORY_KEY?JSON.stringify([sale]):key===RELAY_RECEIPTS_KEY?'{':null})
  expect(result.items).toHaveLength(1)
  expect(result.warnings.join(' ')).toMatch(/Relay/)
 })
})
