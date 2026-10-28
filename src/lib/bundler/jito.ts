import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { confirmSignatures, signedTransactionSignature, throwIfAborted, type ConfirmationOptions } from '@/lib/transactions/send'
import { fetchBounded, withTimeout } from '@/lib/transactions/http'
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token'

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
export interface AtomicTokenExpectation {address:string;owner:string;mint:string;tokenProgram:string;expectedDeltaRaw:string}
export interface AtomicSimulationResult {success:boolean;error?:string;unitsConsumed?:number[];logs?:string[];payerDebitLamports?:string;walletDebitsLamports?:Record<string,string>;tokenAccountDeltasRaw?:Record<string,string>}

function checkedTokenExpectation(value:AtomicTokenExpectation):AtomicTokenExpectation{
 for(const field of ['address','owner','mint','tokenProgram'] as const)if(typeof value[field]!=='string'||new PublicKey(value[field]).toBase58()!==value[field])throw new Error('Token simulation identity is invalid')
 const program=new PublicKey(value.tokenProgram)
 if(![TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID].some(id=>id.equals(program))||getAssociatedTokenAddressSync(new PublicKey(value.mint),new PublicKey(value.owner),false,program).toBase58()!==value.address||typeof value.expectedDeltaRaw!=='string'||! /^-?(0|[1-9]\d{0,20})$/.test(value.expectedDeltaRaw))throw new Error('Token simulation expectation is invalid')
 return {...value}
}
/** Token-state inspection is intentionally independent of ordinary wallet lamports. */
function simulatedTokenAmount(value:unknown,expected:AtomicTokenExpectation,allowMissing:boolean):bigint{
 if(value===null){if(allowMissing)return 0n;throw new Error('A simulated token account is missing after execution')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Token account evidence is incomplete')
 const info=value as {owner?:unknown;lamports?:unknown;data?:unknown;executable?:unknown;rentEpoch?:number}
 if(!Number.isSafeInteger(info.lamports)||Number(info.lamports)<0||info.executable!==false||!Array.isArray(info.data)||info.data.length!==2||info.data[1]!=='base64'||typeof info.data[0]!=='string'||info.data[0].length>20000)throw new Error('Token account evidence is malformed')
 if(allowMissing&&info.owner===SystemProgram.programId.toBase58()&&info.lamports===0&&info.data[0]==='')return 0n
 if(info.owner!==expected.tokenProgram)throw new Error('Simulated token account program changed')
 const data=Buffer.from(info.data[0],'base64')
 if(data.toString('base64')!==info.data[0])throw new Error('Simulated token account data is malformed')
 const account=unpackAccount(new PublicKey(expected.address),{data,owner:new PublicKey(expected.tokenProgram),lamports:Number(info.lamports),executable:false,rentEpoch:info.rentEpoch??0},new PublicKey(expected.tokenProgram))
 if(!account.isInitialized||account.isFrozen||account.isNative||account.mint.toBase58()!==expected.mint||account.owner.toBase58()!==expected.owner)throw new Error('Simulated token account owner, mint or state changed')
 return account.amount
}

/** Read-only sequential simulation against one bank. Reference: Jito's
 * jito-ts/src/sdk/rpc/connection.ts SimulatedBundleResponse schema.
 * Unsigned preview skips signature checks; submission repeats with checks on.
 */
export async function simulateAtomicBundle(connection:Connection,transactions:VersionedTransaction[],opts:{verifySignatures?:boolean;timeoutMs?:number;signal?:AbortSignal;payer?:string;accounts?:readonly string[];tokenAccounts?:readonly AtomicTokenExpectation[]}={}):Promise<AtomicSimulationResult> {
  try {
    throwIfAborted(opts.signal)
    if(transactions.length<1||transactions.length>5) throw new Error('Atomic simulation requires 1–5 transactions')
    for(const tx of transactions) if(tx.serialize().length>1232) throw new Error('A transaction exceeds the Solana packet size')
    const addresses=[...new Set([...(opts.payer?[new PublicKey(opts.payer).toBase58()]:[]),...(opts.accounts??[]).map(address=>new PublicKey(address).toBase58())])]
    if(addresses.length>17)throw new Error('At most 17 participating wallet balances can be simulated')
    const tokens=(opts.tokenAccounts??[]).map(checkedTokenExpectation),tokenAddresses=tokens.map(item=>item.address)
    if(new Set(tokenAddresses).size!==tokens.length||tokens.some(item=>addresses.includes(item.address)))throw new Error('Token accounts must have distinct aggregate simulation expectations')
    const inspected=[...addresses,...tokenAddresses]
    if(inspected.length>20)throw new Error('At most 20 combined wallet and token accounts can be inspected in one bank')
    const accountRequest = inspected.length ? { encoding: 'base64', addresses:inspected } : null
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
    const walletDebitsLamports:Record<string,string>={},tokenAccountDeltasRaw:Record<string,string>={}
    if(inspected.length){
     const beforeAccounts=value.transactionResults[0].preExecutionAccounts,afterAccounts=value.transactionResults[transactions.length-1].postExecutionAccounts
     if(!Array.isArray(beforeAccounts)||!Array.isArray(afterAccounts)||beforeAccounts.length!==inspected.length||afterAccounts.length!==inspected.length)throw new Error('The provider could not verify every participating wallet and token account')
     addresses.forEach((address,index)=>{
      const before = beforeAccounts[index]?.lamports
      const after = afterAccounts[index]?.lamports
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before < 0 || after < 0 || after > before) throw new Error('The provider could not verify the complete launch cost in one bank')
      walletDebitsLamports[address]=(BigInt(before)-BigInt(after)).toString()
     })
     tokens.forEach((expected,index)=>{
      const before=simulatedTokenAmount(beforeAccounts[addresses.length+index],expected,true),after=simulatedTokenAmount(afterAccounts[addresses.length+index],expected,false),delta=after-before
      if(delta!==BigInt(expected.expectedDeltaRaw))throw new Error('The complete bundle token delta differs from the exact reviewed purchases and transfers')
      tokenAccountDeltasRaw[expected.address]=delta.toString()
     })
    }
    return {success:true,...(opts.payer?{payerDebitLamports:walletDebitsLamports[new PublicKey(opts.payer).toBase58()]}:{}),...(opts.accounts?{walletDebitsLamports}:{}),...(opts.tokenAccounts?{tokenAccountDeltasRaw}:{}),unitsConsumed:value.transactionResults.map((tx:{unitsConsumed?:number})=>tx.unitsConsumed??0),logs:value.transactionResults.flatMap((tx:{logs?:string[]})=>tx.logs??[]).slice(-50)}
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
