import {describe,expect,it,vi,afterEach} from 'vitest'
import {Connection,Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {validateTradeInput,formatRawBalance,simulateTradePreview} from '../src/lib/venues/trade'
import {readTradePending,saveTradePending,clearTradePending,TRADE_PENDING_KEY} from '../src/lib/venues/tradeHistory'

const identity={mint:Keypair.generate().publicKey.toBase58(),payer:Keypair.generate().publicKey.toBase58()}
afterEach(()=>vi.unstubAllGlobals())
describe('manual trade review limits',()=>{
  it('keeps the exact decimal SOL ceiling and rejects zero, exponent or overprecision input',()=>{
    const input={...identity,action:'buy' as const,buySol:'0.123456789',sellPercent:100,slippage:10,priorityFeeSol:0.0005}
    expect(validateTradeInput(input).maxBuyLamports).toBe(123456789n)
    for(const buySol of ['0','-1','1e-3','0.0000000001','Infinity'])expect(()=>validateTradeInput({...input,buySol})).toThrow()
  })
  it('rejects unsafe slippage, percentage, fee and wallet/mint identities',()=>{
    const input={...identity,action:'sell' as const,buySol:'0.1',sellPercent:25,slippage:10,priorityFeeSol:0.0005}
    expect(()=>validateTradeInput({...input,slippage:51})).toThrow(/slippage/i)
    expect(()=>validateTradeInput({...input,sellPercent:101})).toThrow(/percent/i)
    expect(()=>validateTradeInput({...input,priorityFeeSol:0.02})).toThrow(/priority/i)
    expect(()=>validateTradeInput({...input,mint:'invalid'})).toThrow()
  })
  it('formats large token balances without rounding away raw units',()=>{
    expect(formatRawBalance('1000000000123456',6,6)).toBe('1,000,000,000.123456')
    expect(formatRawBalance('123456789',9,9)).toBe('0.123456789')
  })
  it('measures cost from the same simulation bank instead of a stale earlier wallet balance',async()=>{
    const tokenData=Buffer.alloc(165);tokenData.writeBigUInt64LE(100n,64)
    vi.stubGlobal('fetch',async()=>Response.json({result:{context:{slot:123},value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:[{lamports:1_000_000_000},{lamports:0,owner:'11111111111111111111111111111111',data:['','base64']}],postExecutionAccounts:[{lamports:899_995_000},{data:[tokenData.toString('base64'),'base64']}]}]}}}))
    const payer=Keypair.generate().publicKey
    const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:payer,lamports:1})]}).compileToV0Message())
    const preview=await simulateTradePreview({rpcEndpoint:'https://rpc.invalid',getFeeForMessage:async()=>({context:{slot:123},value:5000})} as unknown as Connection,tx,{...identity,decimals:6,tokenRaw:'0',solLamports:'2000000000',tokenProgram:'token',ata:Keypair.generate().publicKey.toBase58(),status:'active'}, {maxBuyLamports:100_000_000n,maxSellRaw:0n,action:'buy',minimumSolOut:0n})
    expect(preview.solChangeLamports).toBe('-100005000')
    expect(preview.tokenChangeRaw).toBe('100')
  })
})

function memory(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
describe('public trade recovery records',()=>{
  const pending={...identity,action:'buy' as const,signature:'public-signature',blockhash:'public-blockhash',submittedAt:'2026-10-27T10:00:00Z',maxBuyLamports:'100000000',maxSellRaw:'0'}
  it('persists a public signature without serializing private keys or transaction bytes',()=>{
    const storage=memory()
    saveTradePending({...pending,secretKey:'secret',transaction:'signed-bytes'} as typeof pending,storage)
    const stored=storage.getItem(TRADE_PENDING_KEY)!
    expect(stored).not.toContain('secret');expect(stored).not.toContain('signed-bytes')
    expect(readTradePending(storage)?.signature).toBe('public-signature')
  })
  it('fails closed on corrupt or unreadable recovery storage',()=>{
    const storage=memory();storage.setItem(TRADE_PENDING_KEY,'{broken')
    expect(()=>readTradePending(storage)).toThrow(/recovery|storage/i)
    expect(()=>saveTradePending(pending,{...storage,setItem:()=>{throw new Error('quota')}})).toThrow()
  })
  it('does not clear a different pending trade',()=>{
    const storage=memory();saveTradePending(pending,storage)
    clearTradePending('another-signature',storage)
    expect(readTradePending(storage)?.signature).toBe('public-signature')
    clearTradePending('public-signature',storage)
    expect(readTradePending(storage)).toBeNull()
  })
})
