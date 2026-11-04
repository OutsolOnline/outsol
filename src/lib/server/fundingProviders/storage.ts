import {XAuthStore, type XRecord} from '../xAuth/storage'
import type {FundingPlan,FundingRoute} from '../../fundingProviders/model'
export interface QuoteRecord extends XRecord {kind:'quote';plan:FundingPlan;quoteId:string;routes:FundingRoute[];quotedAt:number;reviewExpiresAt:number;minPerWalletSol:string}
export interface OrderRecord extends XRecord {kind:'order';plan:FundingPlan;quoteId:string;exchangeId:string;stage:'creating'|'submitted'|'uncertain';orderId?:string;createdAt:number;policyVersion:string;consentedAt:number}
export interface FundingPersistence {
 putQuote(capability:string,value:QuoteRecord):Promise<void>;getQuote(capability:string):Promise<QuoteRecord|null>;takeQuote(capability:string):Promise<QuoteRecord|null>
 putOrder(capability:string,value:OrderRecord):Promise<void>;getOrder(capability:string):Promise<OrderRecord|null>;lock<T>(scope:string,fn:()=>Promise<T>):Promise<T>
}
/** Reuses the hardened encrypted private-volume store. Capability filenames are SHA-256 hashes.
 * Quotes and order receipts use distinct kinds so an atomic quote claim cannot remove a receipt. */
export class FundingStore implements FundingPersistence {
 private readonly store:XAuthStore
 constructor(options:{directory:string;key:Uint8Array;now?:()=>number}){this.store=new XAuthStore({...options,maxFiles:2_000,maxBytes:32*1024*1024})}
 putQuote(capability:string,value:QuoteRecord){return this.store.put('pending',capability,value)}
 getQuote(capability:string){return this.store.get<QuoteRecord>('pending',capability)}
 takeQuote(capability:string){return this.store.take<QuoteRecord>('pending',capability)}
 putOrder(capability:string,value:OrderRecord){return this.store.put('flow',capability,value)}
 getOrder(capability:string){return this.store.get<OrderRecord>('flow',capability)}
 lock<T>(scope:string,fn:()=>Promise<T>){return this.store.lock(`funding:${scope}`,fn)}
}
