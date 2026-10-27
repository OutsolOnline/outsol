import { describe, expect, it } from 'vitest'
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Signer, type TransactionInstruction } from '@solana/web3.js'
import { ExtensionType, MINT_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMetadataPointerInstruction, createInitializeMintInstruction, createMintToInstruction, getAssociatedTokenAddressSync, getMintLen, unpackAccount, unpackMint, getExtensionTypes } from '@solana/spl-token'
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata'
import { prepareWalletOperation, inspectWalletOperationIntent } from '../src/lib/walletOperations/builder'
import { submitReviewedWalletOperation } from '../src/lib/walletOperations/submission'
import { readPendingWalletOperation, readWalletOperationHistory } from '../src/lib/walletOperations/history'
import { reconcilePendingWalletOperation, type WalletOperationLocks } from '../src/lib/walletOperations/recovery'
import { confirmSignatures, sendAndConfirmTransaction } from '../src/lib/transactions/send'

const endpoint = process.env.VANITY_LOCALNET_RPC || 'http://127.0.0.1:8899'
const testPayers = new Set<string>()
let sendCount = 0
function requireLoopback() { const url = new URL(endpoint); if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Wallet VM tests require an unauthenticated loopback HTTP runtime.') }
async function proveRuntime() {
  requireLoopback()
  const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getVersion',params:[]}),redirect:'error',signal:AbortSignal.timeout(10000)})
  const value = await response.json()
  if (!response.ok || value.error || typeof value.result?.['surfnet-version'] !== 'string') throw new Error('Loopback endpoint is not an identified Surfpool runtime.')
}
const safeFetch: typeof fetch = async (url, init) => {
  requireLoopback()
  if (new URL(String(url)).origin !== new URL(endpoint).origin) throw new Error('Wallet tests reject non-loopback requests.')
  const call = JSON.parse(String(init?.body))
  if (['sendTransaction','requestAirdrop'].includes(call.method)) {
    await proveRuntime()
    const payer = call.method === 'requestAirdrop' ? call.params[0] : VersionedTransaction.deserialize(Buffer.from(call.params[0],'base64')).message.staticAccountKeys[0].toBase58()
    if (!testPayers.has(payer)) throw new Error('Only fresh test-generated wallets may spend fake local SOL.')
    if (call.method === 'sendTransaction') sendCount++
  }
  return fetch(url,{...init,redirect:'error',signal:init?.signal ?? AbortSignal.timeout(20000)})
}
const connection = new Connection(endpoint,{commitment:'confirmed',fetch:safeFetch,disableRetryOnRateLimit:true})
const locks: WalletOperationLocks = { request: async (name,_options,callback) => { expect(name).toBe('vanity-launch-submission'); return callback({}) } }
function memory() { const values = new Map<string,string>(); return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}} }
async function fund() { await proveRuntime(); const payer = Keypair.generate(); testPayers.add(payer.publicKey.toBase58()); const signature = await connection.requestAirdrop(payer.publicKey,5000000000); expect((await confirmSignatures(connection,[signature],{timeoutMs:10000,pollIntervalMs:50})).status).toBe('confirmed'); return payer }
async function sendSetup(instructions: TransactionInstruction[], signers: Signer[]) {
  const {blockhash} = await connection.getLatestBlockhash('confirmed'), transaction = new VersionedTransaction(new TransactionMessage({payerKey:signers[0].publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message())
  transaction.sign(signers)
  const receipt = await sendAndConfirmTransaction(connection,transaction,{timeoutMs:10000,pollIntervalMs:50})
  expect(receipt.status,receipt.error).toBe('confirmed')
}
async function makeMint(payer: Keypair, program: PublicKey) {
  const mint=Keypair.generate(), source=getAssociatedTokenAddressSync(mint.publicKey,payer.publicKey,false,program), metadata={mint:mint.publicKey,updateAuthority:payer.publicKey,name:'Wallet local test',symbol:'WTEST',uri:'https://example.com/wallet-local.json',additionalMetadata:[]}
  const is2022=program.equals(TOKEN_2022_PROGRAM_ID), space=is2022?getMintLen([ExtensionType.MetadataPointer]):MINT_SIZE, fullSpace=is2022?space+4+pack(metadata).length:space
  const rent=await connection.getMinimumBalanceForRentExemption(fullSpace)
  await sendSetup([
    SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,space,lamports:rent,programId:program}),
    ...(is2022?[createInitializeMetadataPointerInstruction(mint.publicKey,null,mint.publicKey,program)]:[]),
    createInitializeMintInstruction(mint.publicKey,6,payer.publicKey,null,program),
    ...(is2022?[createInitializeInstruction({programId:program,metadata:mint.publicKey,updateAuthority:payer.publicKey,mint:mint.publicKey,mintAuthority:payer.publicKey,name:metadata.name,symbol:metadata.symbol,uri:metadata.uri})]:[]),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,source,payer.publicKey,mint.publicKey,program),
    createMintToInstruction(mint.publicKey,source,payer.publicKey,12345678901n,[],program),
  ],[payer,mint])
  return {mint:mint.publicKey,source}
}

describe.skipIf(process.env.RUN_WALLET_LOCALNET !== '1')('reviewed wallet operations signed on isolated Surfpool',()=>{
  it('funds multiple recipients with exact reviewed SOL amounts, costs and remaining balance',async()=>{
    const payer=await fund(), recipients=[Keypair.generate().publicKey,Keypair.generate().publicKey],storage=memory()
    const plan=await prepareWalletOperation(connection,{kind:'sol',payer:payer.publicKey.toBase58(),priorityFeeSol:'0.00001',recipients:[{address:recipients[0].toBase58(),amount:'0.01'},{address:recipients[1].toBase58(),amount:'0.02'}]})
    const result=await submitReviewedWalletOperation(connection,plan,{approved:true,storage,locks,readSigner:()=>payer.publicKey.toBase58(),assertAvailable:()=>{},signTransaction:async tx=>{tx.sign([payer]);return tx},timeoutMs:10000,pollIntervalMs:50,onPending:record=>expect(readPendingWalletOperation(storage)?.signature).toBe(record.signature)})
    expect(result.receipt.status,result.receipt.error).toBe('confirmed')
    expect(await connection.getBalance(recipients[0])).toBe(10000000); expect(await connection.getBalance(recipients[1])).toBe(20000000)
    expect(String(await connection.getBalance(payer.publicKey))).toBe(plan.preview.payerAfterLamports)
    expect(readPendingWalletOperation(storage)).toBeNull();expect(readWalletOperationHistory(storage)[0].status).toBe('confirmed')
    console.log(JSON.stringify({proof:'signed-local-surfpool-wallet-operation',kind:'SOL-group-funding',realSolSpent:false,signature:result.receipt.signature,payerRemaining:plan.preview.payerAfterLamports}))
  },60000)
  it.each([TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID])('transfers exact tokens and closes an emptied account with verified rent credit (%s)',async program=>{
    const payer=await fund(),{mint,source}=await makeMint(payer,program),recipient=Keypair.generate().publicKey,storage=memory()
    const state=unpackMint(mint,await connection.getAccountInfo(mint),program)
    if(program.equals(TOKEN_2022_PROGRAM_ID))expect(getExtensionTypes(state.tlvData)).toEqual(expect.arrayContaining([ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]))
    const plan=await prepareWalletOperation(connection,{kind:'token',payer:payer.publicKey.toBase58(),priorityFeeSol:'0',mint:mint.toBase58(),sourceAccount:source.toBase58(),recipients:[{address:recipient.toBase58(),amount:'12345.678901'}]})
    inspectWalletOperationIntent(plan.transaction,plan.intent)
    const options={approved:true,storage,locks,readSigner:()=>payer.publicKey.toBase58(),assertAvailable:()=>{},signTransaction:async(tx:VersionedTransaction)=>{tx.sign([payer]);return tx},timeoutMs:10000,pollIntervalMs:50}
    const transfer=await submitReviewedWalletOperation(connection,plan,options)
    expect(transfer.receipt.status,transfer.receipt.error).toBe('confirmed')
    const destination=getAssociatedTokenAddressSync(mint,recipient,false,program)
    expect(unpackAccount(destination,await connection.getAccountInfo(destination),program).amount).toBe(12345678901n)
    expect(unpackAccount(source,await connection.getAccountInfo(source),program).amount).toBe(0n)
    const close=await prepareWalletOperation(connection,{kind:'close',payer:payer.publicKey.toBase58(),priorityFeeSol:'0',accounts:[source.toBase58()]})
    expect(BigInt(close.preview.rentChangeLamports)).toBeGreaterThan(0n)
    expect(BigInt(close.preview.payerAfterLamports)).toBeGreaterThan(BigInt(close.preview.payerBeforeLamports))
    const cleanup=await submitReviewedWalletOperation(connection,close,options)
    expect(cleanup.receipt.status,cleanup.receipt.error).toBe('confirmed'); expect(await connection.getAccountInfo(source)).toBeNull()
    expect(String(await connection.getBalance(payer.publicKey))).toBe(close.preview.payerAfterLamports)
    console.log(JSON.stringify({proof:'signed-local-surfpool-wallet-operation',kind:'token-transfer-and-empty-close',tokenProgram:program.toBase58(),realSolSpent:false,transfer:transfer.receipt.signature,cleanup:cleanup.receipt.signature,rentReturned:close.preview.rentChangeLamports}))
  },60000)
  it('rejects changed wallet-returned bytes, changed signers and invalid previews without a broadcast',async()=>{
    const payer=await fund(),recipient=Keypair.generate().publicKey,storage=memory(),before=sendCount
    const plan=await prepareWalletOperation(connection,{kind:'sol',payer:payer.publicKey.toBase58(),priorityFeeSol:'0',recipients:[{address:recipient.toBase58(),amount:'0.01'}]})
    const options={approved:true,storage,locks,readSigner:()=>payer.publicKey.toBase58(),assertAvailable:()=>{}}
    await expect(submitReviewedWalletOperation(connection,plan,{...options,signTransaction:async tx=>{tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.sign([payer]);return tx}})).rejects.toThrow(/wallet changed/i)
    await expect(submitReviewedWalletOperation(connection,plan,{...options,readSigner:()=>null,signTransaction:async tx=>tx})).rejects.toThrow(/wallet.*changed|locked|disconnected/i)
    const controller=new AbortController();controller.abort()
    await expect(submitReviewedWalletOperation(connection,plan,{...options,signal:controller.signal,signTransaction:async tx=>tx})).rejects.toThrow()
    expect(sendCount).toBe(before);expect(readPendingWalletOperation(storage)).toBeNull()
  },60000)
  it('preserves a submitted unknown result and later confirms its original signature without resending',async()=>{
    const payer=await fund(),recipient=Keypair.generate().publicKey,storage=memory()
    const plan=await prepareWalletOperation(connection,{kind:'sol',payer:payer.publicKey.toBase58(),priorityFeeSol:'0',recipients:[{address:recipient.toBase58(),amount:'0.01'}]})
    const unknown=new Proxy(connection,{get(target,key){if(key==='getSignatureStatuses')return async()=>({context:{slot:1},value:[null]});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const result=await submitReviewedWalletOperation(unknown,plan,{approved:true,storage,locks,readSigner:()=>payer.publicKey.toBase58(),assertAvailable:()=>{},signTransaction:async tx=>{tx.sign([payer]);return tx},timeoutMs:200,pollIntervalMs:20})
    expect(result.receipt.status).toBe('unknown');expect(readPendingWalletOperation(storage)?.signature).toBe(result.receipt.signature)
    const before=sendCount,recovered=await reconcilePendingWalletOperation(connection,{storage,locks})
    expect(recovered.status).toBe('confirmed');expect(readPendingWalletOperation(storage)).toBeNull();expect(sendCount).toBe(before)
  },60000)
  it('rechecks the live signer after pending UI callbacks and does not broadcast if it changed',async()=>{
    const payer=await fund(),recipient=Keypair.generate().publicKey,storage=memory()
    const plan=await prepareWalletOperation(connection,{kind:'sol',payer:payer.publicKey.toBase58(),priorityFeeSol:'0',recipients:[{address:recipient.toBase58(),amount:'0.01'}]})
    let signer:string|null=payer.publicKey.toBase58()
    const before=sendCount
    const result=await submitReviewedWalletOperation(connection,plan,{approved:true,storage,locks,readSigner:()=>signer,assertAvailable:()=>{},signTransaction:async tx=>{tx.sign([payer]);return tx},onPending:()=>{signer=null},timeoutMs:10000,pollIntervalMs:50})
    expect(result.receipt.submitted).toBe(false);expect(sendCount).toBe(before);expect(readPendingWalletOperation(storage)).toBeNull()
  },60000)
})
