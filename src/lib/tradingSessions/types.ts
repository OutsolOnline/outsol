import type {Connection,VersionedTransaction} from '@solana/web3.js'
import type {PreparedTrade,TradeInput} from '@/lib/venues/trade'
import type {TradeStorage} from '@/lib/venues/tradeHistory'
import type {ConfirmationOptions,TransactionReceipt} from '@/lib/transactions/send'

export interface TradingSessionConfig {
 version:1; mode:'dca'|'cap'|'new-launch'; walletId:string; payer:string; action:'buy'|'sell'; mint?:string
 creator?:string; keyword?:string; buySol:string; sellPercent:number; maxTrades:number; intervalMs:number; durationMs:number
 maxDebitSol:string; slippage:number; priorityFeeSol:number; capDirection?:'at-or-above'|'at-or-below'; capSol?:string
}
export interface TradingSessionRow {index:number;mint:string;action:'buy'|'sell';status:'preparing'|'signing'|'sending'|'confirmed'|'failed'|'unknown'|'not-submitted';debitReservedLamports:string;createdAt:number;signature?:string;error?:string}
export interface TradingSessionJournal {version:1;id:string;config:TradingSessionConfig;status:'running'|'completed'|'stopped'|'failed'|'unknown';phase:'idle'|'monitoring'|'preparing'|'signing'|'sending';armedAt:number;updatedAt:number;reservedDebitLamports:string;rows:TradingSessionRow[];message?:string;lastCapLamports?:string}
export interface LaunchFeedItem {mint:string;name:string;symbol:string;creator:string;timestamp:number;signature:string}
export interface LaunchFeed {status:'ready'|'unavailable';items:LaunchFeedItem[];fetchedAt:string;coverage:'recent-confirmed-transactions';warning?:string}
export interface CurveQuote {capLamports:string;creator:string}
export interface SignedTradePreview {walletBeforeLamports:string;netDebitLamports:string;networkFeeLamports:string}
export interface SessionLocks {request<T>(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>):Promise<T>}
export interface SessionSigner {approved:true;readSigner:()=>string|null|undefined;sign:(transaction:VersionedTransaction)=>Promise<VersionedTransaction>;signal?:AbortSignal;onChange?:(journal:TradingSessionJournal)=>void;assertAvailable?:()=>void}
export interface SessionPorts {
 now:()=>number;wait:(milliseconds:number,signal?:AbortSignal)=>Promise<void>;prepare:(connection:Connection,input:TradeInput)=>Promise<PreparedTrade>
 readCurve:(connection:Connection,mint:string,guard:()=>void)=>Promise<CurveQuote>;fetchFeed:()=>Promise<LaunchFeed>
 simulateSigned:(connection:Connection,transaction:VersionedTransaction,prepared:PreparedTrade,guard:()=>void)=>Promise<SignedTradePreview>
 send:(connection:Connection,transaction:VersionedTransaction,options:ConfirmationOptions)=>Promise<TransactionReceipt>
 assertAvailable:()=>void;locks?:SessionLocks;storage?:TradeStorage
}
