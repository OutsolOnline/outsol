import { describe, expect, it, vi, afterEach } from 'vitest'
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { sendAndConfirmTransaction } from '../src/lib/transactions/send'
import { createJitoTipTransaction, submitAtomicBundle, simulateAtomicBundle } from '../src/lib/bundler/jito'
import bs58 from 'bs58'

const signer = Keypair.generate()
const tipAccount = '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'
function signedTx() {
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: signer.publicKey, lamports: 1 })] }).compileToV0Message())
  tx.sign([signer]); return tx
}
const confirmed = { context: { slot: 123 }, value: [{ slot: 123, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] }
const rpcResponse = (ack:string) => async (_url:unknown, init?:RequestInit) => {
  const request=JSON.parse(String(init?.body))
  if(request.method==='simulateBundle') return Response.json({result:{context:{slot:123},value:{summary:'succeeded',transactionResults:request.params[0].encodedTransactions.map(()=>({err:null,logs:[],unitsConsumed:1000}))}}})
  return Response.json({jsonrpc:'2.0',id:1,result:ack})
}
afterEach(() => vi.unstubAllGlobals())

describe('submission receipts', () => {
  it('reports a confirmed chain error as failed', async () => {
    const tx = signedTx()
    const connection = { sendRawTransaction: vi.fn().mockResolvedValue(bs58.encode(tx.signatures[0])), getSignatureStatuses: vi.fn().mockResolvedValue({ context: { slot: 123 }, value: [{ ...confirmed.value[0], err: { InstructionError: [0, 'Custom'] } }] }) } as unknown as Connection
    const receipt = await sendAndConfirmTransaction(connection, tx, { timeoutMs: 50, pollIntervalMs: 1 })
    expect(receipt.status).toBe('failed')
    expect(receipt.signature).toBe(bs58.encode(tx.signatures[0]))
  })
  it('keeps the original signature when submission times out and does not resubmit', async () => {
    const tx = signedTx(); let sends = 0
    const connection = { sendRawTransaction: async () => { sends++; throw new Error('connection lost after sending') }, getSignatureStatuses: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: [null] }) } as unknown as Connection
    const receipt = await sendAndConfirmTransaction(connection, tx, { timeoutMs: 10, pollIntervalMs: 1 })
    expect(receipt.status).toBe('unknown')
    expect(receipt.signature).toBe(bs58.encode(tx.signatures[0]))
    expect(sends).toBe(1)
  })
  it('confirms a signature even when the send response was lost', async () => {
    const tx = signedTx()
    const connection = { sendRawTransaction: vi.fn().mockRejectedValue(new Error('timeout')), getSignatureStatuses: vi.fn().mockResolvedValue(confirmed) } as unknown as Connection
    expect((await sendAndConfirmTransaction(connection, tx, { timeoutMs: 50, pollIntervalMs: 1 })).status).toBe('confirmed')
  })
})

describe('Jito atomic submission', () => {
  it('builds a real bounded SOL transfer to an authenticated Jito tip account', () => {
    const tx = createJitoTipTransaction(signer.publicKey, Keypair.generate().publicKey.toBase58(), 30_000, tipAccount)
    const instruction = TransactionMessage.decompile(tx.message).instructions[0]
    expect(instruction.programId.equals(SystemProgram.programId)).toBe(true)
    expect(instruction.keys[1].pubkey.toBase58()).toBe(tipAccount)
    expect(instruction.data.readBigUInt64LE(4)).toBe(30_000n)
    expect(() => createJitoTipTransaction(signer.publicKey, tx.message.recentBlockhash, 30_000, Keypair.generate().publicKey.toBase58())).toThrow(/tip account/i)
  })
  it('rejects more than five transactions before any network submission', async () => {
    let requests = 0; vi.stubGlobal('fetch', async () => { requests++; return Response.json({ result: 'bundle' }) })
    const receipt = await submitAtomicBundle({} as Connection, Array.from({ length: 6 }, signedTx), { timeoutMs: 10 })
    expect(receipt.status).toBe('failed'); expect(requests).toBe(0)
  })
  it('never reports bundle acknowledgement as confirmed landing', async () => {
    vi.stubGlobal('fetch', rpcResponse('acknowledged-bundle'))
    const tx = createJitoTipTransaction(signer.publicKey, Keypair.generate().publicKey.toBase58(), 30_000, tipAccount); tx.sign([signer])
    const connection = {rpcEndpoint:'https://rpc.invalid', getSignatureStatuses: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: [null] }) } as unknown as Connection
    const receipt = await submitAtomicBundle(connection, [tx], { timeoutMs: 10, pollIntervalMs: 1 })
    expect(receipt.status).toBe('unknown'); expect(receipt.bundleId).toBe('acknowledged-bundle')
    expect(receipt.signatures).toEqual([bs58.encode(tx.signatures[0])])
  })
  it('requires an actual Jito tip and confirms all bundle signatures', async () => {
    vi.stubGlobal('fetch', rpcResponse('bundle'))
    const connection = {rpcEndpoint:'https://rpc.invalid', getSignatureStatuses: vi.fn().mockResolvedValue(confirmed) } as unknown as Connection
    expect((await submitAtomicBundle(connection, [signedTx()], { timeoutMs: 10 })).status).toBe('failed')
    const tx = createJitoTipTransaction(signer.publicKey, Keypair.generate().publicKey.toBase58(), 30_000, tipAccount); tx.sign([signer])
    expect((await submitAtomicBundle(connection, [tx], { timeoutMs: 50, pollIntervalMs: 1 })).status).toBe('confirmed')
  })
  it('refuses submission when the bundle simulation service is unavailable',async()=>{
    let sends=0
    vi.stubGlobal('fetch',async(_url:unknown,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body));if(request.method==='sendBundle')sends++
      return Response.json({error:{code:-32601,message:'Method not found'}})
    })
    const tx=createJitoTipTransaction(signer.publicKey,Keypair.generate().publicKey.toBase58(),30_000,tipAccount);tx.sign([signer])
    const receipt=await submitAtomicBundle({rpcEndpoint:'https://rpc.invalid'} as Connection,[tx],{timeoutMs:10})
    expect(receipt.status).toBe('failed');expect(receipt.error).toMatch(/simulat/i);expect(sends).toBe(0)
  })
  it('does not accept a simulation summary when a transaction failed',async()=>{
    vi.stubGlobal('fetch',async()=>Response.json({result:{context:{slot:123},value:{summary:'succeeded',transactionResults:[{err:{InstructionError:[0,'Custom']},logs:['failure'],unitsConsumed:100}]}}}))
    const result=await simulateAtomicBundle({rpcEndpoint:'https://rpc.invalid'} as Connection,[signedTx()])
    expect(result.success).toBe(false)
  })
})
