import bs58 from 'bs58'
import {PublicKey} from '@solana/web3.js'
import {solLamports} from './config'
import type {TokenTrade} from '@/lib/market/types'

export interface ObservedBuyRule {minBuySol:string;whitelist:string[]}
function address(value:unknown):string{if(typeof value!=='string'||new PublicKey(value).toBase58()!==value)throw new Error('An observed wallet address is invalid.');return value}
export function parseObservedBuyRule(value:unknown):ObservedBuyRule {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['minBuySol','whitelist'].includes(key)))throw new Error('Only public observed-buy rule settings are accepted.')
 const input=value as Record<string,unknown>,minimum=solLamports(input.minBuySol)
 if(minimum<=0n||!Array.isArray(input.whitelist)||input.whitelist.length>50)throw new Error('Choose a positive external-buy threshold and up to fifty whitelisted addresses.')
 const whitelist=input.whitelist.map(address);if(new Set(whitelist).size!==whitelist.length)throw new Error('Whitelist addresses must be distinct.')
 return {minBuySol:input.minBuySol as string,whitelist}
}
/** Detects only positive confirmed events present in overlapping recent samples.
 * It never infers that no external buys happened outside the bounded sample. */
export class ObservedBuyWatcher {
 #mint:string;#rule:ObservedBuyRule;#ignored:Set<string>;#seen=new Set<string>();#previous=new Set<string>();#baseline=false;#armedAt:number;#fetchedAt=0;#latched:TokenTrade|null=null;#mode:'per-event'|'cumulative';#total:bigint
 constructor(mint:string,rule:ObservedBuyRule,ownAddresses:readonly string[],armedAt:number,mode:'per-event'|'cumulative'='per-event',initialObservedLamports='0'){this.#mint=address(mint);this.#rule=parseObservedBuyRule(rule);this.#ignored=new Set([...this.#rule.whitelist,...ownAddresses.map(address)]);this.#armedAt=armedAt;this.#mode=mode;if(! /^(0|[1-9]\d{0,29})$/.test(initialObservedLamports))throw new Error('The prior observed total is invalid.');this.#total=BigInt(initialObservedLamports)}
 assertFresh(now:number):void {if(!this.#baseline||now-this.#fetchedAt>25000||this.#fetchedAt-now>10000)throw new Error('Observed market evidence is stale or missing. Remaining actions stopped.')}
 get latched():TokenTrade|null{return this.#latched?{...this.#latched}:null}
 get totalObservedLamports():string{return this.#total.toString()}
 get exceeded():boolean{return this.#mode==='cumulative'?this.#total>solLamports(this.#rule.minBuySol):this.#latched!==null}
 observe(value:unknown,now:number):TokenTrade|null {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Observed market evidence is missing.')
  const snapshot=value as {status?:unknown;mint?:unknown;curveStatus?:unknown;fetchedAt?:unknown;trades?:unknown;coverage?:Record<string,unknown>}
  const coverage=snapshot.coverage,fetchedAt=typeof snapshot.fetchedAt==='string'?Date.parse(snapshot.fetchedAt):NaN
  if(snapshot.status!=='ready'||snapshot.mint!==this.#mint||snapshot.curveStatus!=='active'||!Number.isFinite(fetchedAt)||now-fetchedAt>25000||fetchedAt-now>10000||fetchedAt<this.#fetchedAt)throw new Error('Observed market evidence is unavailable, stale or belongs to a different mint.')
  if(!coverage||coverage.kind!=='recent'||coverage.complete!==false||['missing','unsupported','failed','invalid'].some(field=>coverage[field]!==0)||!Number.isSafeInteger(coverage.requested)||!Number.isSafeInteger(coverage.read)||coverage.requested!==coverage.read)throw new Error('Observed market coverage has missing, failed or unreadable sampled transactions. Remaining actions stopped.')
  if(!Array.isArray(snapshot.trades)||snapshot.trades.length>200)throw new Error('Observed trade evidence is incomplete.')
  const trades:TokenTrade[]=snapshot.trades.map(value=>{
   const row=value as TokenTrade
   if(!row||typeof row.id!=='string'||!row.id||row.id.length>200||typeof row.signature!=='string'||row.signature.length>88||bs58.decode(row.signature).length!==64||!Number.isSafeInteger(row.ordinal)||row.ordinal<0||!Number.isSafeInteger(row.slot)||row.slot<0||!Number.isSafeInteger(row.timestamp)||row.timestamp<0||row.timestamp*1000>now+10000||!['buy','sell'].includes(row.side)||typeof row.solAmountLamports!=='string'||! /^(0|[1-9]\d{0,20})$/.test(row.solAmountLamports))throw new Error('A confirmed observed event is invalid.')
   return {...row,wallet:address(row.wallet)}
  })
  const current=new Set(trades.map(row=>row.id))
  if(current.size!==trades.length)throw new Error('Observed event identifiers are duplicated.')
  if(this.#baseline&&this.#previous.size&&(!current.size||![...current].some(id=>this.#previous.has(id))))throw new Error('The observed event samples no longer overlap. A coverage gap may hide trades; remaining actions stopped.')
  const first=!this.#baseline
  this.#fetchedAt=fetchedAt;this.#previous=current;this.#baseline=true
  for(const row of trades){
   const fresh=!this.#seen.has(row.id);this.#seen.add(row.id)
   if(!first&&fresh&&row.timestamp*1000>=this.#armedAt&&row.side==='buy'&&!this.#ignored.has(row.wallet)){this.#total+=BigInt(row.solAmountLamports);const hit=this.#mode==='cumulative'?this.#total>solLamports(this.#rule.minBuySol):BigInt(row.solAmountLamports)>=solLamports(this.#rule.minBuySol);if(hit&&!this.#latched)this.#latched={...row}}
  }
  if(this.#seen.size>5000)throw new Error('The bounded observed-event limit was reached. Review a new run.')
  return this.latched
 }
}
