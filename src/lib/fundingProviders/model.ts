import {formatUnits, parseExactUnits, publicAddress} from '../walletOperations/model'

export const MAX_FUNDING_WALLETS=20
export const QUOTE_REVIEW_MS=60_000
export const FUNDING_POLICIES={terms:'https://splitnow.io/terms',privacy:'https://splitnow.io/privacy-policy',aml:'https://splitnow.io/aml-policy',regions:'https://splitnow.io/restricted-regions'} as const
export const FUNDING_POLICY_VERSION='splitnow-policies-reviewed-2026-11-04'
export type FundingErrorCode='invalid_request'|'not_found'|'setup_required'|'rate_limit'|'quote_expired'|'deposit_limit'|'provider_unavailable'|'storage_unavailable'
export class FundingError extends Error {
 constructor(public readonly code:FundingErrorCode,public readonly status:number,message:string){super(message);this.name='FundingError'}
}
export interface FundingRecipient {address:string;shareBps:number}
export interface FundingPlan {amountSol:string;amountLamports:string;recipients:FundingRecipient[]}
export interface FundingRoute {exchangeId:string;estimatedOutputSol:string}
export interface FundingQuote {
 capability:string;plan:FundingPlan;routes:FundingRoute[];quotedAt:string;expiresAt:string;minPerWalletSol:string
 platformFeeBps:0;providerMaxServiceFeeBps:100;itemizedFeesAvailable:false
}
export type FundingState='creating'|'uncertain'|'verification_required'|'pending'|'sending'|'monitoring'|'expired'|'halted'|'failed'|'refunded'|'completed'
export interface FundingReceipt {
 plan:FundingPlan;state:FundingState;createdAt:string;updatedAt:string;exchangeId:string;orderId?:string
 deposit?:{address:string;amountSol:string;expiresAt?:string};message:string;platformFeeBps:0
}
export const CAPABILITY_PATTERN=/^[A-Za-z0-9_-]{43}$/
export const PROVIDER_ID_PATTERN=/^[A-Za-z0-9_-]{1,96}$/
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new FundingError('invalid_request',400,'Review the funding details and try again.');return value as Record<string,unknown>}
function onlyKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Unexpected funding field.')}

/** Exact decimal SOL and public wallet addresses only; private material is never accepted. */
export function parseFundingPlan(value:unknown):FundingPlan{
 try{
  const input=record(value);onlyKeys(input,['amountSol','recipients'])
  if(typeof input.amountSol!=='string'||input.amountSol.length>24)throw new Error('Enter a SOL amount between 0 and 1,000.')
  const raw=parseExactUnits(input.amountSol,9)
  if(raw>1_000_000_000_000n)throw new Error('Provider funding is limited to 1,000 SOL per order.')
  if(!Array.isArray(input.recipients)||!input.recipients.length||input.recipients.length>MAX_FUNDING_WALLETS)throw new Error(`Choose between 1 and ${MAX_FUNDING_WALLETS} distinct wallets.`)
  const supplied=input.recipients.map(value=>{const row=record(value);onlyKeys(row,['address','shareBps']);return {address:publicAddress(row.address,true),shareBps:row.shareBps}})
  const hasShares=supplied.some(row=>row.shareBps!==undefined)
  const recipients=supplied.map((row,index)=>{
   const shareBps=hasShares?row.shareBps:Math.floor(10_000/supplied.length)+(index<10_000%supplied.length?1:0)
   if(typeof shareBps!=='number'||!Number.isInteger(shareBps)||shareBps<1||shareBps>10_000)throw new Error('Every recipient needs a positive allocation in basis points.')
   if(raw*BigInt(shareBps)/10_000n<1n)throw new Error('Every allocation must be at least one lamport.')
   return {address:row.address,shareBps}
  })
  if(new Set(recipients.map(row=>row.address)).size!==recipients.length)throw new Error('Choose distinct recipient wallets.')
  if(recipients.reduce((sum,row)=>sum+row.shareBps,0)!==10_000)throw new Error('Recipient allocations must total 100%.')
  return {amountSol:formatUnits(raw,9),amountLamports:raw.toString(),recipients}
 }catch(error){throw new FundingError('invalid_request',400,error instanceof Error?error.message:'Review the funding details.')}
}
export function parseOrderReview(value:unknown):{exchangeId:string;policiesAccepted:true;reviewConfirmed:true}{
 const input=record(value)
 if(Object.keys(input).some(key=>!['exchangeId','policiesAccepted','reviewConfirmed'].includes(key))||typeof input.exchangeId!=='string'||!PROVIDER_ID_PATTERN.test(input.exchangeId)||input.policiesAccepted!==true||input.reviewConfirmed!==true)throw new FundingError('invalid_request',400,'Choose a quoted route, accept the provider policies and confirm the exact recipients before creating an order.')
 return {exchangeId:input.exchangeId,policiesAccepted:true,reviewConfirmed:true}
}
