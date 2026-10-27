import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { confirmSignatures, signedTransactionSignature, throwIfAborted, type ConfirmationOptions } from '@/lib/transactions/send'
import { fetchBounded, withTimeout } from '@/lib/transactions/http'

// Published by Jito's getTipAccounts API and low-latency transaction documentation.
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
] as const
export interface AtomicBundleReceipt { status: 'confirmed' | 'failed' | 'unknown'; signatures: string[]; submitted?: boolean; bundleId?: string; error?: string }
export interface AtomicSimulationResult {success:boolean;error?:string;unitsConsumed?:number[];logs?:string[];payerDebitLamports?:string;walletDebitsLamports?:Record<string,string>}

/** Read-only sequential simulation against one bank. Reference: Jito's
 * jito-ts/src/sdk/rpc/connection.ts SimulatedBundleResponse schema.
 * Unsigned preview skips signature checks; submission repeats with checks on.
 */
export async function simulateAtomicBundle(connection:Connection,transactions:VersionedTransaction[],opts:{verifySignatures?:boolean;timeoutMs?:number;signal?:AbortSignal;payer?:string;accounts?:readonly string[]}={}):Promise<AtomicSimulationResult> {
  try {
    throwIfAborted(opts.signal)
    if(transactions.length<1||transactions.length>5) throw new Error('Atomic simulation requires 1–5 transactions')
    for(const tx of transactions) if(tx.serialize().length>1232) throw new Error('A transaction exceeds the Solana packet size')
    const addresses=[...new Set([...(opts.payer?[new PublicKey(opts.payer).toBase58()]:[]),...(opts.accounts??[]).map(address=>new PublicKey(address).toBase58())])]
    if(addresses.length>17)throw new Error('At most 17 participating wallet balances can be simulated')
    const accountRequest = addresses.length ? { encoding: 'base64', addresses } : null
    const response=await fetchBounded(connection.rpcEndpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:transactions.map(tx=>Buffer.from(tx.serialize()).toString('base64'))},{transactionEncoding:'base64',skipSigVerify:!opts.verifySignatures,replaceRecentBlockhash:!opts.verifySignatures,preExecutionAccountsConfigs:transactions.map((_,index)=>index === 0 ? accountRequest : null),postExecutionAccountsConfigs:transactions.map((_,index)=>index === transactions.length - 1 ? accountRequest : null)}]}),
    },response=>response.json(),opts.timeoutMs??20_000)
    throwIfAborted(opts.signal)
    if(response.error) throw new Error(response.error.message??'RPC does not support simulateBundle')
    const value=response.result?.value
    if(value?.summary!=='succeeded'||!Array.isArray(value.transactionResults)||value.transactionResults.length!==transactions.length) throw new Error('Simulation did not confirm success for the complete bundle')
    const failed=value.transactionResults.find((tx:{err:unknown})=>tx.err!==null)
    if(failed) throw new Error(`Transaction simulation failed: ${JSON.stringify(failed.err)}`)
    const walletDebitsLamports:Record<string,string>={}
    if(addresses.length){
     const beforeAccounts=value.transactionResults[0].preExecutionAccounts,afterAccounts=value.transactionResults[transactions.length-1].postExecutionAccounts
     if(!Array.isArray(beforeAccounts)||!Array.isArray(afterAccounts)||beforeAccounts.length!==addresses.length||afterAccounts.length!==addresses.length)throw new Error('The provider could not verify every participating wallet balance')
     addresses.forEach((address,index)=>{
      const before = beforeAccounts[index]?.lamports
      const after = afterAccounts[index]?.lamports
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before < 0 || after < 0 || after > before) throw new Error('The provider could not verify the complete launch cost in one bank')
      walletDebitsLamports[address]=(BigInt(before)-BigInt(after)).toString()
     })
    }
    return {success:true,...(opts.payer?{payerDebitLamports:walletDebitsLamports[new PublicKey(opts.payer).toBase58()]}:{}),...(opts.accounts?{walletDebitsLamports}:{}),unitsConsumed:value.transactionResults.map((tx:{unitsConsumed?:number})=>tx.unitsConsumed??0),logs:value.transactionResults.flatMap((tx:{logs?:string[]})=>tx.logs??[]).slice(-50)}
  } catch(error){return {success:false,error:`Bundle simulation failed; nothing was submitted. ${error instanceof Error?error.message:'Simulation unavailable'}`}}
}

export function createJitoTipTransaction(payer: PublicKey, blockhash: string, lamports: number, tipAccount: string = JITO_TIP_ACCOUNTS[crypto.getRandomValues(new Uint8Array(1))[0] % JITO_TIP_ACCOUNTS.length]): VersionedTransaction {
  if (!JITO_TIP_ACCOUNTS.some(account => account === tipAccount)) throw new Error('Unrecognized Jito tip account')
  if (!Number.isSafeInteger(lamports) || lamports < 1_000 || lamports > 100_000_000) throw new Error('Jito tip must be between 1,000 and 100,000,000 lamports')
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(tipAccount), lamports })] }).compileToV0Message())
}

/** Canonical tips are 8-byte TipPaymentAccount PDAs owned by Jito's payment
 * program, not System accounts. Read current rent/balances before selecting a
 * destination; never silently raise the user's approved tip to repair rent. */
export async function createVerifiedJitoTipTransaction(connection:Connection,payer:PublicKey,blockhash:string,lamports:number):Promise<VersionedTransaction>{
  if(!Number.isSafeInteger(lamports)||lamports<1_000||lamports>100_000_000)throw new Error('Jito tip must be between 1,000 and 100,000,000 lamports')
  const owner=new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt'),discriminator=Buffer.from('ySH0dOBEYSg=','base64')
  const [accounts,rent]=await Promise.all([
    withTimeout(connection.getMultipleAccountsInfo(JITO_TIP_ACCOUNTS.map(key=>new PublicKey(key)),'confirmed')),
    withTimeout(connection.getMinimumBalanceForRentExemption(8,'confirmed')),
  ])
  if(!Number.isSafeInteger(rent)||rent<0)throw new Error('Jito tip recipient rent cannot be verified')
  const eligible=JITO_TIP_ACCOUNTS.filter((_,index)=>{
    const account=accounts[index]
    return account&&!account.executable&&account.owner.equals(owner)&&account.data.equals(discriminator)&&Number.isSafeInteger(account.lamports)&&account.lamports>=0&&BigInt(account.lamports)+BigInt(lamports)>=BigInt(rent)
  })
  if(!eligible.length)throw new Error('No canonical Jito tip recipient is rent-safe for the approved tip; prepare again')
  return createJitoTipTransaction(payer,blockhash,lamports,eligible[crypto.getRandomValues(new Uint8Array(1))[0]%eligible.length])
}

function hasJitoTip(txs: VersionedTransaction[]): boolean {
  return txs.some(tx => tx.message.compiledInstructions.some(instruction => {
    const key = (index: number) => tx.message.staticAccountKeys[index]
    const data = Buffer.from(instruction.data)
    return key(instruction.programIdIndex)?.equals(SystemProgram.programId) && data.length === 12 && data.readUInt32LE(0) === 2 &&
      data.readBigUInt64LE(4) >= 1_000n && data.readBigUInt64LE(4) <= 100_000_000n &&
      key(instruction.accountKeyIndexes[0])?.equals(tx.message.staticAccountKeys[0]) &&
      JITO_TIP_ACCOUNTS.some(account => key(instruction.accountKeyIndexes[1])?.toBase58() === account)
  }))
}

export async function submitAtomicBundle(connection: Connection, signedTxs: VersionedTransaction[], opts: ConfirmationOptions & { endpoint?: string } = {}): Promise<AtomicBundleReceipt> {
  let signatures: string[] = []
  let bundleId: string | undefined
  let submitted = false
  try {
    throwIfAborted(opts.signal)
    if (signedTxs.length < 1 || signedTxs.length > 5) throw new Error('A Jito bundle must contain 1–5 transactions, including the tip transaction')
    signatures = signedTxs.map(signedTransactionSignature)
    if (new Set(signatures).size !== signatures.length) throw new Error('A bundle cannot contain duplicate transactions')
    if (!hasJitoTip(signedTxs)) throw new Error('Bundle has no valid Jito tip transfer')
  } catch (error) { return { status: 'failed', signatures, submitted, error: error instanceof Error ? error.message : 'Invalid bundle' } }
  const simulation=await simulateAtomicBundle(connection,signedTxs,{verifySignatures:true,timeoutMs:opts.timeoutMs,signal:opts.signal})
  if(!simulation.success) return {status:'failed',signatures,submitted,error:simulation.error}
  let submissionError = ''
  try {
    throwIfAborted(opts.signal)
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [signedTxs.map(tx => Buffer.from(tx.serialize()).toString('base64')), { encoding: 'base64' }] })
    throwIfAborted(opts.signal)
    opts.onBroadcast?.()
    throwIfAborted(opts.signal)
    submitted = true
    const result = await fetchBounded(opts.endpoint ?? 'https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body,
    }, response => response.json(), Math.min(opts.timeoutMs ?? 20_000, 20_000))
    if (result.error) return { status: 'failed', signatures, submitted, error: result.error.message || 'Jito rejected the bundle' }
    if (typeof result.result !== 'string' || !result.result) submissionError = 'Jito returned no bundle acknowledgement'
    else bundleId = result.result
  } catch (error) {
    if (!submitted) return { status: 'failed', signatures, submitted, error: error instanceof Error ? error.message : 'Bundle was not submitted' }
    submissionError = error instanceof Error ? error.message : 'Bundle submission response unavailable'
  }
  // An acknowledgement does not mean landing. Never resubmit the launch through
  // a sequential route after rejection, a timeout, or an ambiguous response.
  const confirmation = await confirmSignatures(connection, signatures, opts)
  return { ...confirmation, signatures, submitted, bundleId, ...(confirmation.status === 'unknown' && submissionError ? { error: `${confirmation.error} ${submissionError}` } : {}) }
}
