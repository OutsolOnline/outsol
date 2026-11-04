import {canonicalAddress,canonicalSignature} from '../../market/validation'
import type {TokenBalanceChange,TokenTrade} from '../../market/types'

export const MAX_TRANSACTIONS=500
export const PAGE_SIZE=25
export const LEASE_MS=30_000
export class BackgroundJobRateLimitError extends Error {
 constructor(public readonly retryAfter:number){super('The background creation limit was reached. Try again later.')}
}
export type JobState='queued'|'running'|'succeeded'|'cancelled'|'failed'
export interface HistoryJobInput {version:1;kind:'token-history';mint:string;maxTransactions:number;idempotencyKey:string}
export interface SignatureEntry {signature:string;slot:number;blockTime:number|null;failed:boolean}
export interface HistoryReceipt {signature:string;slot:number;blockTime:number|null;status:'confirmed'|'failed'|'missing'|'unsupported'|'invalid';trades:TokenTrade[];balanceChanges:TokenBalanceChange[]}
export interface Coverage {read:number;failed:number;missing:number;unsupported:number;invalid:number}
export interface JobSummary {
 id:string;kind:'token-history';mint:string;state:JobState;createdAt:number;updatedAt:number;expiresAt:number
 maxTransactions:number;scanned:number;coverage:Coverage;rpcAddressExhausted:boolean;fullTokenHistory:false
 error:string|null
}
export interface JobLease extends JobSummary {leaseToken:string;page:SignatureEntry[];pageIndex:number;before:string|null;decimals:number|null}
export const emptyCoverage=():Coverage=>({read:0,failed:0,missing:0,unsupported:0,invalid:0})

export function parseJobInput(value:unknown):HistoryJobInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('A history-index request is required.')
 const row=value as Record<string,unknown>,keys=['version','kind','mint','maxTransactions','idempotencyKey']
 if(Object.keys(row).some(key=>!keys.includes(key))||keys.some(key=>!(key in row)))throw new Error('Unexpected history-index fields.')
 if(row.version!==1||row.kind!=='token-history'||!canonicalAddress(row.mint)||row.mint==='11111111111111111111111111111111')throw new Error('A valid Solana token mint is required.')
 if(!Number.isSafeInteger(row.maxTransactions)||(row.maxTransactions as number)<25||(row.maxTransactions as number)>MAX_TRANSACTIONS)throw new Error('Choose between 25 and 500 transactions.')
 if(typeof row.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(row.idempotencyKey))throw new Error('A valid request identifier is required.')
 return{version:1,kind:'token-history',mint:row.mint as string,maxTransactions:row.maxTransactions as number,idempotencyKey:row.idempotencyKey}
}
export function validCapability(value:unknown):value is string{
 return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').length===32&&Buffer.from(value,'base64url').toString('base64url')===value
}
export function validatePage(value:SignatureEntry[],remaining:number):void{
 if(!Array.isArray(value)||value.length>Math.min(PAGE_SIZE,remaining))throw new Error('Invalid history page.')
 const seen=new Set<string>()
 for(const row of value){
  if(!row||!canonicalSignature(row.signature)||seen.has(row.signature)||!Number.isSafeInteger(row.slot)||row.slot<0||(row.blockTime!==null&&(!Number.isSafeInteger(row.blockTime)||row.blockTime<0))||typeof row.failed!=='boolean')throw new Error('Invalid history signature.')
  seen.add(row.signature)
 }
}
