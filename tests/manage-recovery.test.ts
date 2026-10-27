import {describe,expect,it} from 'vitest'
import type {Connection} from '@solana/web3.js'
import {readTradeHistory,readTradePending,saveTradePending,clearTradePending,type PendingTrade} from '../src/lib/venues/tradeHistory'
import {reconcileTradeRecord,reconcilePendingTrade,type TradeRecoveryLocks,type TradeRecoveryResult} from '../src/lib/venues/tradeRecovery'

function memory(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
const pending:PendingTrade={action:'buy',mint:'public-mint',payer:'public-payer',signature:'signature-A',blockhash:'old-blockhash',submittedAt:'2026-10-27T10:00:00Z',maxBuyLamports:'100000000',maxSellRaw:'0',expiryBlockHeight:100}
const absent={context:{slot:500},value:[null]}
const confirmed=(err:unknown=null)=>({context:{slot:500},value:[{slot:400,confirmations:null,confirmationStatus:'finalized',err}]})
function rpc(overrides:Record<string,unknown>={}){return {getSignatureStatuses:async()=>absent,isBlockhashValid:async(_hash:string,config:{commitment?:string})=>{if(config.commitment!=='finalized')throw new Error('Expiry proof requires finalized blockhash state');return {context:{slot:500},value:false}},getBlockHeight:async(commitment:string)=>{if(commitment!=='finalized')throw new Error('Expiry proof requires finalized height');return 201},getLatestBlockhash:async()=>({blockhash:'new-hash',lastValidBlockHeight:350}),getTransaction:async()=>null,...overrides} as unknown as Connection}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}

describe('manual trade expiry recovery',()=>{
  it('releases an expired absent signature only after finalized expiry and a second history check',async()=>{
    const storage=memory();saveTradePending(pending,storage);let historyChecks=0
    const result=await reconcileTradeRecord(rpc({getSignatureStatuses:async()=>{historyChecks++;return absent}}),{storage})
    expect(result.status).toBe('failed');expect(result.receipt?.error).toMatch(/expired/i)
    expect(readTradePending(storage)).toBeNull();expect(readTradeHistory(storage)[0].signature).toBe('signature-A');expect(historyChecks).toBe(2)
  })
  it('keeps an unknown signature when finalized height has not passed the saved boundary',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    expect((await reconcileTradeRecord(rpc({getBlockHeight:async()=>100}),{storage})).status).toBe('unknown')
    expect(readTradePending(storage)?.signature).toBe('signature-A')
  })
  it('does not release a signature whose original blockhash remains valid',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    expect((await reconcileTradeRecord(rpc({isBlockhashValid:async()=>({context:{slot:500},value:true})}),{storage})).status).toBe('unknown')
    expect(readTradePending(storage)).not.toBeNull()
  })
  it('records a conservative boundary for legacy records instead of declaring an unseen recent hash expired',async()=>{
    const storage=memory();saveTradePending({...pending,expiryBlockHeight:undefined},storage)
    expect((await reconcileTradeRecord(rpc(),{storage})).status).toBe('unknown')
    expect(readTradePending(storage)?.expiryBlockHeight).toBe(350)
  })
  it('preserves a success discovered while checking expiry',async()=>{
    const storage=memory();saveTradePending(pending,storage);let reads=0
    const result=await reconcileTradeRecord(rpc({getSignatureStatuses:async()=>++reads===1?absent:confirmed()}),{storage})
    expect(result.status).toBe('confirmed');expect(readTradeHistory(storage)[0].status).toBe('confirmed')
  })
  it('records a definitive on-chain failure and releases only that pending signature',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    const result=await reconcileTradeRecord(rpc({getSignatureStatuses:async()=>confirmed({InstructionError:[0,'Custom']})}),{storage})
    expect(result.status).toBe('failed');expect(result.receipt?.error).toMatch(/On-chain trade failed/)
    expect(readTradePending(storage)).toBeNull();expect(readTradeHistory(storage)[0].status).toBe('failed')
  })
  it('uses finalized transaction evidence when signature indexing remains absent',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    const result=await reconcileTradeRecord(rpc({getTransaction:async()=>({meta:{err:null}})}),{storage})
    expect(result.status).toBe('confirmed');expect(readTradeHistory(storage)[0].status).toBe('confirmed')
  })
  it('keeps an unconfirmed landed signature even after the height boundary',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    const result=await reconcileTradeRecord(rpc({getSignatureStatuses:async()=>({context:{slot:500},value:[{slot:450,err:null,confirmationStatus:'processed',confirmations:0}]})}),{storage})
    expect(result.status).toBe('unknown');expect(readTradePending(storage)).not.toBeNull()
  })
  it('does not discard an unknown signature when archival lookup is unavailable',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    await expect(reconcileTradeRecord(rpc({getTransaction:async()=>{throw new Error('RPC unavailable')}}),{storage})).rejects.toThrow()
    expect(readTradePending(storage)?.signature).toBe('signature-A')
  })
  it('does not clear or report stale component state if a record changes during an awaited RPC',async()=>{
    const storage=memory();saveTradePending(pending,storage);const read=deferred<ReturnType<typeof confirmed>>()
    const work=reconcileTradeRecord(rpc({getSignatureStatuses:()=>read.promise}),{storage})
    clearTradePending('signature-A',storage);saveTradePending({...pending,signature:'signature-B'},storage)
    read.resolve(confirmed())
    const result=await work
    expect(result.status).toBe('changed');expect(result.pending?.signature).toBe('signature-B')
    expect(readTradePending(storage)?.signature).toBe('signature-B');expect(readTradeHistory(storage)).toHaveLength(0)
  })
  it('takes the shared submission lock and rereads the record after acquiring it',async()=>{
    const storage=memory();saveTradePending(pending,storage)
    let enter!:()=>void
    const locks:TradeRecoveryLocks={request:(name,_options,callback)=>{
      expect(name).toBe('vanity-launch-submission')
      return new Promise<TradeRecoveryResult>((resolve,reject)=>{enter=()=>{callback({}).then(resolve,reject)}})
    }}
    const work=reconcilePendingTrade(rpc({getSignatureStatuses:async(signatures:string[])=>signatures[0]==='signature-B'?confirmed():absent}),{storage,locks})
    clearTradePending('signature-A',storage);saveTradePending({...pending,signature:'signature-B'},storage)
    enter();const result=await work
    expect(result.receipt?.signature).toBe('signature-B');expect(result.pending).toBeNull()
    expect(readTradeHistory(storage).map(receipt=>receipt.signature)).toEqual(['signature-B'])
  })
})
