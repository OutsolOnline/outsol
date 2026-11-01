import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token'
import {prepareMarketSale,assertMarketSale,simulateSignedMarketSale,type MarketSaleInput,type PreparedMarketSale} from './market'
import {publicSaleRecord,saveSaleRecord,type SaleBatchRecord,type SaleRequest,type SaleReviewRow} from './history'
import {readTradePending,saveTradePending,clearTradePending,saveTradeReceipt,type PendingTrade,type TradeStorage} from '../venues/tradeHistory'
import {sendAndConfirmTransaction,signedTransactionSignature,assertSubmissionSigner,type ConfirmationOptions,type TransactionReceipt} from '../transactions/send'
import {readPending} from '../launchHistory'
import {assertNoPendingWalletOperation} from '../walletOperations/history'
import {assertNoPendingGroupOperation} from '../walletGroups/history'
import {assertNoPendingBundleReceipt} from '../bundler/pending'
import {assertNoPendingRelayTransfer} from '../relay/history'
import {withTimeout} from '../transactions/http'

export type {SaleRequest} from './history'
export interface SaleBatchOptions {slippageBps:number;priorityFeeLamports:string}
export interface SaleBatchPorts {
 prepare:(connection:Connection,input:MarketSaleInput,reviewedMinimumSolOut?:string)=>Promise<PreparedMarketSale>
 assert:(plan:PreparedMarketSale,tx:VersionedTransaction)=>void
 simulateSigned:(connection:Connection,plan:PreparedMarketSale,tx:VersionedTransaction,guard:()=>void)=>Promise<{walletBeforeLamports:string;netDebitLamports:string;networkFeeLamports:string}>
 send:(connection:Connection,tx:VersionedTransaction,options:ConfirmationOptions)=>Promise<TransactionReceipt>
 now:()=>number;storage?:TradeStorage;assertAvailable:()=>void;onProgress?:(completed:number,total:number)=>void
 locks?:{request<T>(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>):Promise<T>}
}
export interface SaleBatchSigner {approved:true;readSigner:(walletId:string)=>string|null|undefined;sign:(walletId:string,transaction:VersionedTransaction)=>Promise<VersionedTransaction>;signal?:AbortSignal;assertAvailable?:()=>void;onChange?:(record:SaleBatchRecord)=>void}
interface Internal {snapshot:string;record:SaleBatchRecord;options:SaleBatchOptions;used:boolean}
const plans=new WeakMap<SaleBatchRecord,Internal>()
const defaults:SaleBatchPorts={prepare:prepareMarketSale,assert:assertMarketSale,simulateSigned:simulateSignedMarketSale,send:sendAndConfirmTransaction,now:Date.now,assertAvailable:()=>{if(readPending())throw new Error('Resolve the pending launch in Activity first.');assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt();assertNoPendingRelayTransfer()}}
const message=(tx:VersionedTransaction)=>Buffer.from(tx.message.serialize()).toString('base64')
const errorText=(value:unknown)=>value instanceof Error?value.message:'The sale did not complete.'
const unsigned=(v:string)=>typeof v==='string'&&/^(0|[1-9]\d{0,29})$/.test(v)
function request(value:SaleRequest):SaleRequest{
 if(!value||typeof value.walletId!=='string'||!value.walletId||value.walletId.length>100||typeof value.walletName!=='string'||!value.walletName.trim()||value.walletName.length>60||!unsigned(value.amountRaw)||BigInt(value.amountRaw)<=0n||BigInt(value.amountRaw)>18_446_744_073_709_551_615n||!Number.isInteger(value.decimals)||value.decimals<0||value.decimals>255)throw new Error('Choose exact, positive token amounts from a wallet scan.')
 const payer=new PublicKey(value.payer),mint=new PublicKey(value.mint),tokenProgram=new PublicKey(value.tokenProgram)
 if(!PublicKey.isOnCurve(payer.toBytes())||mint.equals(NATIVE_MINT)||(!tokenProgram.equals(TOKEN_PROGRAM_ID)&&!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)))throw new Error('Choose supported fungible tokens and an ordinary wallet.')
 return {walletId:value.walletId,walletName:value.walletName,payer:payer.toBase58(),mint:mint.toBase58(),tokenProgram:tokenProgram.toBase58(),amountRaw:value.amountRaw,decimals:value.decimals}
}
function input(row:SaleRequest,options:SaleBatchOptions):MarketSaleInput{return{payer:row.payer,mint:row.mint,tokenProgram:row.tokenProgram,amountRaw:row.amountRaw,decimals:row.decimals,...options}}
function checkPlan(plan:PreparedMarketSale,row:SaleRequest,options:SaleBatchOptions):void{
 const expected=input(row,options)
 if(!plan||plan.payer!==row.payer||plan.mint!==row.mint||plan.amountRaw!==row.amountRaw||Object.entries(expected).some(([key,value])=>plan.input[key as keyof MarketSaleInput]!==value)||!unsigned(plan.minimumSolOut)||BigInt(plan.minimumSolOut)<=0n||!unsigned(plan.maxDebitLamports)||!unsigned(plan.networkFeeLamports)||BigInt(plan.networkFeeLamports)>BigInt(plan.maxDebitLamports)||!['pump','jupiter'].includes(plan.route)||!Number.isSafeInteger(plan.lastValidBlockHeight))throw new Error('The sale route differs from the reviewed wallet, token, amount or costs. Prepare again.')
}
export async function prepareSaleBatch(connection:Connection,raw:SaleRequest[],options:SaleBatchOptions,overrides:Partial<SaleBatchPorts>={}):Promise<SaleBatchRecord>{
 if(!Array.isArray(raw)||!raw.length||raw.length>100)throw new Error('Review between one and 100 token sales at a time.')
 if(!options||!Number.isInteger(options.slippageBps)||options.slippageBps<0||options.slippageBps>5000||!unsigned(options.priorityFeeLamports)||BigInt(options.priorityFeeLamports)>10_000_000n)throw new Error('Choose slippage of 0–50% and a priority fee up to 0.01 SOL.')
 const ports={...defaults,...overrides},requests=raw.map(request),seen=new Set<string>(),identities=new Map<string,string>()
 for(const row of requests){const id=`${row.payer}:${row.mint}`;if(seen.has(id))throw new Error('Choose distinct wallet and token pairs; duplicate sale rows are not allowed.');seen.add(id);if(identities.has(row.walletId)&&identities.get(row.walletId)!==row.payer)throw new Error('The selected wallet identity changed.');identities.set(row.walletId,row.payer)}
 ports.assertAvailable();if(readTradePending(ports.storage))throw new Error('Resolve the pending trade before preparing sales.')
 const rows:SaleReviewRow[]=[],reserved=new Map<string,bigint>(),balances=new Map<string,bigint>()
 ports.onProgress?.(0,requests.length)
 for(const row of requests){
  ports.assertAvailable()
  try{
   const prepared=await ports.prepare(connection,input(row,options));ports.assertAvailable();checkPlan(prepared,row,options);ports.assert(prepared,prepared.transaction)
   let balance=balances.get(row.payer)
   if(balance===undefined){const value=await withTimeout(connection.getBalance(new PublicKey(row.payer),'confirmed'));if(!Number.isSafeInteger(value)||value<0)throw new Error('The SOL fee reserve could not be read.');balance=BigInt(value);balances.set(row.payer,balance)}
   const next=(reserved.get(row.payer)||0n)+BigInt(prepared.maxDebitLamports)
   if(next>balance)throw new Error('This wallet needs more SOL to cover every selected sale fee and account rent.')
   reserved.set(row.payer,next)
   rows.push({...row,status:'ready',route:prepared.route,minimumSolOut:prepared.minimumSolOut,estimatedNetSolOut:prepared.estimatedNetSolOut,networkFeeLamports:prepared.networkFeeLamports,maxDebitLamports:prepared.maxDebitLamports})
  }catch(error){rows.push({...row,status:'unavailable',error:errorText(error)})}
  ports.onProgress?.(rows.length,requests.length)
 }
 const now=ports.now(),record=publicSaleRecord({version:1,id:crypto.randomUUID(),createdAt:now,updatedAt:now,status:'ready',rows})
 plans.set(record,{snapshot:JSON.stringify(record),record:structuredClone(record),options:{...options},used:false})
 return record
}
export async function executeSaleBatch(connection:Connection,review:SaleBatchRecord,signer:SaleBatchSigner,overrides:Partial<SaleBatchPorts>={}):Promise<SaleBatchRecord>{
 const internal=plans.get(review)
 if(!internal||internal.used||internal.snapshot!==JSON.stringify(review))throw new Error('This review was changed, expired or already used. Prepare a fresh sale review.')
 if(signer.approved!==true)throw new Error('Review and approve these exact token sales first.')
 internal.used=true
 const ports={...defaults,...overrides},record=structuredClone(internal.record),locks=ports.locks??(typeof navigator!=='undefined'?navigator.locks as unknown as NonNullable<SaleBatchPorts['locks']>:undefined)
 if(!locks)throw new Error('Use a current browser with secure cross-tab transaction coordination.')
 let active:SaleReviewRow|undefined,pending:PendingTrade|null=null,submitted=false
 const checkpoint=()=>{record.updatedAt=ports.now();saveSaleRecord(record,ports.storage);signer.onChange?.(structuredClone(record))}
 const guard=(row:SaleReviewRow,expected?:string)=>{
  assertSubmissionSigner(row.payer,()=>signer.readSigner(row.walletId),signer.signal)
  ports.assertAvailable();signer.assertAvailable?.()
  const current=readTradePending(ports.storage)
  if(expected?current?.signature!==expected:!!current)throw new Error('A pending trade changed. Check the original signature before continuing.')
 }
 try{
  await locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
   if(!lock)throw new Error('Another tab is submitting or recovering a transaction. Prepare again when it finishes.')
   if(ports.now()-record.createdAt>120_000||ports.now()<record.createdAt)throw new Error('This sale review expired. Prepare fresh quotes.')
   if(!record.rows.some(row=>row.status==='ready'))throw new Error('No selected tokens have an available sale route.')
   record.status='running';checkpoint()
   for(const row of record.rows){
    if(row.status!=='ready')continue
    active=row;submitted=false;pending=null;guard(row);row.status='preparing';checkpoint();guard(row)
    const prepared=await ports.prepare(connection,input(row,internal.options),row.minimumSolOut);guard(row);checkPlan(prepared,row,internal.options)
    if(BigInt(prepared.minimumSolOut)<BigInt(row.minimumSolOut!)||BigInt(prepared.maxDebitLamports)>BigInt(row.maxDebitLamports!))throw new Error('The market moved beyond the reviewed minimum output or fee ceiling. Review a fresh sale.')
    ports.assert(prepared,prepared.transaction)
    if(prepared.createdAt>ports.now()||ports.now()-prepared.createdAt>60_000)throw new Error('The fresh sale packet expired before signing.')
    const bytes=VersionedTransaction.deserialize(prepared.transaction.serialize()),expectedMessage=message(bytes)
    row.status='signing';checkpoint();guard(row)
    const returned=await signer.sign(row.walletId,bytes);guard(row)
    // Wallet adapters are an external boundary. Own a canonical packet rather
    // than retaining methods or mutable serialization supplied by the wallet.
    const signedBytes=returned.serialize(),signed=VersionedTransaction.deserialize(signedBytes)
    if(message(signed)!==expectedMessage||!Buffer.from(signed.serialize()).equals(Buffer.from(signedBytes)))throw new Error('The signed sale message changed. Nothing was submitted.')
    ports.assert(prepared,signed);const signature=signedTransactionSignature(signed)
    const actual=await ports.simulateSigned(connection,prepared,signed,()=>guard(row));guard(row)
    if(BigInt(actual.netDebitLamports)>BigInt(row.maxDebitLamports!)||BigInt(actual.networkFeeLamports)>BigInt(row.maxDebitLamports!))throw new Error('The signed sale exceeds the approved fee and rent reserve.')
    if(message(signed)!==expectedMessage||signedTransactionSignature(signed)!==signature)throw new Error('The signed sale changed after simulation.')
    pending={action:'sell',mint:row.mint,payer:row.payer,signature,blockhash:signed.message.recentBlockhash,submittedAt:new Date(ports.now()).toISOString(),maxBuyLamports:'0',maxSellRaw:row.amountRaw,expiryBlockHeight:prepared.lastValidBlockHeight}
    saveTradePending(pending,ports.storage);guard(row,signature)
    row.signature=signature;row.status='sending';checkpoint();guard(row,signature)
    const receipt=await ports.send(connection,signed,{signal:signer.signal,onBroadcast:()=>{guard(row,signature);if(message(signed)!==expectedMessage||signedTransactionSignature(signed)!==signature)throw new Error('The signed sale changed before broadcast.');ports.assert(prepared,signed);submitted=true}})
    if(receipt.signature!==signature)throw new Error('The submission returned another signature. Check the original saved transaction.')
    if(!submitted&&receipt.submitted===false){clearTradePending(signature,ports.storage);pending=null;throw new Error(receipt.error||'Nothing was submitted.')}
    if(!submitted||receipt.status==='unknown'){row.status='unknown';throw new Error(receipt.error||'Confirmation is unknown. Check the saved original transaction before another sale.')}
    if(readTradePending(ports.storage)?.signature!==signature)throw new Error('The pending sale record changed during confirmation.')
    row.status=receipt.status;row.error=receipt.error;checkpoint()
    saveTradeReceipt(pending,receipt.status,receipt.error,ports.storage);pending=null;submitted=false
    if(receipt.status==='failed')throw new Error(receipt.error||'The sale failed on chain. No further sales were attempted.')
    guard(row)
   }
   record.status=record.rows.every(row=>row.status==='confirmed')?'completed':'partial';checkpoint()
  })
 }catch(error){
  const original=pending as PendingTrade|null
  if(original&&!submitted){try{clearTradePending(original.signature,ports.storage)}catch{/* Preserve unreadable recovery data. */}}
  if(active&&['preparing','signing','sending'].includes(active.status))active.status=submitted?'unknown':'failed'
  if(active&&active.status!=='confirmed')active.error=errorText(error)
  record.status=submitted?'unknown':signer.signal?.aborted?'stopped':record.rows.some(row=>row.status==='confirmed')?'partial':'failed'
  record.error=errorText(error)
  try{checkpoint()}catch{/* The original pending signature remains the recovery authority. */}
 }
 return structuredClone(record)
}
