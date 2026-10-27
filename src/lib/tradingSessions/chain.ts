import {PublicKey,type Connection,type VersionedTransaction} from '@solana/web3.js'
import {NATIVE_MINT} from '@solana/spl-token'
import {bondingCurvePda,bondingCurveMarketCap,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {inspectTradeIntent,type PreparedTrade} from '@/lib/venues/trade'
import {fetchBounded,withTimeout} from '@/lib/transactions/http'
import {signedTransactionSignature} from '@/lib/transactions/send'
import type {CurveQuote,SignedTradePreview} from './types'

export async function readSolCurveQuote(connection:Connection,mint:string,guard:()=>void):Promise<CurveQuote>{
 guard()
 const account=await withTimeout(connection.getAccountInfo(bondingCurvePda(new PublicKey(mint)),'confirmed'));guard()
 if(!account||!account.owner.equals(PUMP_PROGRAM_ID))throw new Error('This mint has no native Pump.fun bonding curve.')
 const curve=PUMP_SDK.decodeBondingCurve(account)
 if(curve.complete)throw new Error('This curve graduated. The session stopped before trading.')
 if(!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT))throw new Error('Only SOL-quoted Pump.fun curves are supported.')
 if(curve.virtualTokenReserves.lten(0)||curve.virtualQuoteReserves.lten(0)||curve.tokenTotalSupply.lten(0))throw new Error('The SOL curve reserves cannot be verified.')
 const cap=bondingCurveMarketCap({mintSupply:curve.tokenTotalSupply,virtualQuoteReserves:curve.virtualQuoteReserves,virtualTokenReserves:curve.virtualTokenReserves})
 if(cap.lten(0))throw new Error('The SOL market cap cannot be verified.')
 return {capLamports:cap.toString(),creator:curve.creator.toBase58()}
}

interface SimAccount {lamports?:number;owner?:string;data?:[string,string]}
interface SimResponse {error?:unknown;result?:{value?:{summary?:string;transactionResults?:{err:unknown;preExecutionAccounts?:(SimAccount|null)[];postExecutionAccounts?:(SimAccount|null)[]}[]}}}
function accountTokens(account:SimAccount|null|undefined):bigint {
 if(!account)return 0n
 if(account.lamports===0&&account.owner===PublicKey.default.toBase58()&&account.data?.[0]==='')return 0n
 if(!Array.isArray(account.data)||account.data[1]!=='base64')throw new Error('Signed simulation returned an unreadable token account.')
 const bytes=Buffer.from(account.data[0],'base64')
 if(bytes.length<72)throw new Error('Signed simulation returned an incomplete token account.')
 return bytes.readBigUInt64LE(64)
}
function lamports(value:unknown):bigint {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Signed simulation could not verify exact wallet balances and fees.');return BigInt(value)}

/** A fresh same-bank simulation of the actual signed packet, never a replaced hash. */
export async function simulateSignedTrade(connection:Connection,transaction:VersionedTransaction,prepared:PreparedTrade,guard:()=>void):Promise<SignedTradePreview>{
 guard();signedTransactionSignature(transaction)
 const intent=inspectTradeIntent(transaction,prepared.input,BigInt(prepared.maxSellRaw))
 const accounts={encoding:'base64',addresses:[prepared.input.payer,prepared.position.ata]}
 const [response,fee]=await Promise.all([
  fetchBounded(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:[Buffer.from(transaction.serialize()).toString('base64')]},{transactionEncoding:'base64',skipSigVerify:false,replaceRecentBlockhash:false,preExecutionAccountsConfigs:[accounts],postExecutionAccountsConfigs:[accounts]}]})},async result=>await result.json() as SimResponse),
  withTimeout(connection.getFeeForMessage(transaction.message,'confirmed')),
 ]);guard()
 const result=response.result?.value,rows=result?.transactionResults
 if(response.error||result?.summary!=='succeeded'||!Array.isArray(rows)||rows.length!==1||rows[0].err!==null)throw new Error('The signed trade simulation failed. Nothing was submitted.')
 const before=rows[0].preExecutionAccounts,after=rows[0].postExecutionAccounts
 if(!before?.[0]||!after?.[0]||!after?.[1])throw new Error('Signed simulation could not verify both sides of the trade.')
 const beforeSol=lamports(before[0].lamports),afterSol=lamports(after[0].lamports),networkFee=lamports(fee.value)
 const beforeRaw=accountTokens(before[1]),afterRaw=accountTokens(after[1]),change=afterRaw-beforeRaw,solChange=afterSol-beforeSol
 if(prepared.input.action==='buy'&&(change!==BigInt(intent.tokenAmountRaw)||solChange>=0n))throw new Error('The signed purchase changes do not match the native trade intent.')
 if(prepared.input.action==='sell'&&(beforeRaw!==BigInt(prepared.position.tokenRaw)||change!==-BigInt(prepared.maxSellRaw)||solChange+networkFee<BigInt(intent.minimumSolOut)))throw new Error('The signed sale balance or minimum proceeds changed. The session stopped.')
 return {walletBeforeLamports:beforeSol.toString(),netDebitLamports:(solChange<0n?-solChange:0n).toString(),networkFeeLamports:networkFee.toString()}
}
