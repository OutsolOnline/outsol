import type {TokenTrade,TokenBalanceChange} from '../market/types'
import {canonicalAddress,canonicalSignature} from '../market/validation'

const WSOL='So11111111111111111111111111111111111111112',U64=(1n<<64n)-1n
const raw=(input:unknown):bigint=>{if(typeof input!=='string'||!/^\d{1,20}$/.test(input)||BigInt(input)>U64)throw new Error('Invalid token amount');return BigInt(input)}
const lamports=(input:unknown):bigint=>{if(typeof input!=='number'||!Number.isSafeInteger(input)||input<0)throw new Error('Unsafe native balance');return BigInt(input)}
type TokenRow={accountIndex:number;mint:string;owner:string;amount:bigint;decimals:number}

/** Only confirmed RPC balance evidence is accepted. Reserve changes are
 * reversible token-account lamports, separate from consumed network fees.
 * A cashflow is a trade basis only when it agrees with official event amounts;
 * mixed transfers, tips and ambiguous funding remain unallocated. */
export function decodeConfirmedBalanceChanges(input:unknown,signature:string,mint:string,events:TokenTrade[]):TokenBalanceChange[]{
 try{
  if(!canonicalSignature(signature)||!canonicalAddress(mint)||!input||typeof input!=='object')return []
  const tx=input as {slot?:number;blockTime?:number;transaction?:{signatures?:unknown[];message?:{accountKeys?:unknown[]}};meta?:{err?:unknown;fee?:unknown;preBalances?:unknown[];postBalances?:unknown[];preTokenBalances?:unknown[];postTokenBalances?:unknown[];loadedAddresses?:{writable?:unknown[];readonly?:unknown[]}}}
  const meta=tx.meta
  if(!meta||meta.err!==null||tx.transaction?.signatures?.[0]!==signature||!Number.isSafeInteger(tx.slot)||tx.slot!<0||!Number.isSafeInteger(tx.blockTime)||tx.blockTime!<1_577_836_800)return []
  const keys=[...(tx.transaction?.message?.accountKeys??[]),...(meta.loadedAddresses?.writable??[]),...(meta.loadedAddresses?.readonly??[])]
  if(!keys.length||keys.length>256||keys.some(key=>!canonicalAddress(key))||new Set(keys).size!==keys.length||!Array.isArray(meta.preBalances)||!Array.isArray(meta.postBalances)||meta.preBalances.length!==keys.length||meta.postBalances.length!==keys.length)return []
  const before=meta.preBalances.map(lamports),after=meta.postBalances.map(lamports),fee=lamports(meta.fee)
  const parse=(input:unknown):Map<number,TokenRow>=>{
   if(!Array.isArray(input)||input.length>256)throw new Error('Missing token evidence')
   const out=new Map<number,TokenRow>()
   for(const value of input){
    const row=value as {accountIndex:number;mint:string;owner:string;uiTokenAmount:{amount:string;decimals:number}}
    if(!row||!Number.isInteger(row.accountIndex)||row.accountIndex<0||row.accountIndex>=keys.length||out.has(row.accountIndex)||!canonicalAddress(row.mint)||!canonicalAddress(row.owner)||!row.uiTokenAmount||!Number.isInteger(row.uiTokenAmount.decimals)||row.uiTokenAmount.decimals<0||row.uiTokenAmount.decimals>18)throw new Error('Invalid balance evidence')
    out.set(row.accountIndex,{accountIndex:row.accountIndex,mint:row.mint,owner:row.owner,amount:raw(row.uiTokenAmount.amount),decimals:row.uiTokenAmount.decimals})
   }
   return out
  }
  const pre=parse(meta.preTokenBalances),post=parse(meta.postTokenBalances),indices=[...new Set([...pre.keys(),...post.keys()])],owners=new Map<string,{pre:bigint;post:bigint;reserve:bigint;wrapped:bigint;decimals:number;ambiguous:boolean}>()
  for(const index of indices){
   const a=pre.get(index),b=post.get(index),row=b??a!
   if(row.mint!==mint)continue
   const state=owners.get(row.owner)??{pre:0n,post:0n,reserve:0n,wrapped:0n,decimals:row.decimals,ambiguous:false}
   if(a&&b&&(a.owner!==b.owner||a.mint!==b.mint||a.decimals!==b.decimals)||row.decimals!==state.decimals)state.ambiguous=true
   state.pre+=a?.amount??0n;state.post+=b?.amount??0n;owners.set(row.owner,state)
  }
  for(const index of indices){
   const a=pre.get(index),b=post.get(index),row=b??a!,state=owners.get(row.owner)
   if(!state||row.mint!==mint&&row.mint!==WSOL)continue
   if(a&&b&&(a.owner!==b.owner||a.mint!==b.mint)){state.ambiguous=true;continue}
   const wrapped=row.mint===WSOL?(b?.amount??0n)-(a?.amount??0n):0n
   state.wrapped+=wrapped;state.reserve+=after[index]-before[index]-wrapped
  }
  const changes:TokenBalanceChange[]=[]
  for(const [wallet,state] of owners){
   const delta=state.post-state.pre
   const index=keys.indexOf(wallet),native=index>=0?after[index]-before[index]:null,network=index===0?fee:0n
   if(delta===0n&&network===0n&&state.reserve===0n)continue
   const trades=events.filter(row=>row.signature===signature&&row.wallet===wallet),sides=new Set(trades.map(row=>row.side))
   const kind=trades.length?sides.size>1?'mixed':trades[0].side:'transfer'
   const expectedTokens=trades.reduce((sum,row)=>sum+(row.side==='buy'?1n:-1n)*BigInt(row.tokenAmountRaw),0n)
   const expectedFlow=trades.reduce((sum,row)=>sum+(row.side==='buy'?-BigInt(row.solAmountLamports):BigInt(row.solAmountLamports))-BigInt(row.feeLamports)-BigInt(row.creatorFeeLamports),0n)
   const economic=native===null?null:native+state.wrapped+network+state.reserve
   const basisEligible=!state.ambiguous&&sides.size===1&&expectedTokens===delta&&economic!==null&&economic===expectedFlow&&(kind==='buy'?economic<0n:economic>0n)
   changes.push({signature,mint,slot:tx.slot!,timestamp:tx.blockTime!,wallet,decimals:state.decimals,kind,tokenBeforeRaw:state.pre.toString(),tokenAfterRaw:state.post.toString(),tokenDeltaRaw:delta.toString(),nativeDeltaLamports:native?.toString()??null,wrappedSolDeltaLamports:state.wrapped.toString(),networkFeeLamports:network.toString(),accountReserveDeltaLamports:state.reserve.toString(),tradeCashflowLamports:basisEligible?economic!.toString():null,basisEligible,...(!basisEligible?{reason:kind==='transfer'?'Transfer: acquisition basis is not established.':'Balance deltas do not isolate a single confirmed trade cost.'}:{})})
  }
  return changes
 }catch{return []}
}

export interface AccountingSummary {knownRealizedLamports:string;realizedPnlLamports:string|null;unknownSales:number;observedTokenRaw:string;unknownTokenRaw:string;networkFeeLamports:string;accountReserveDeltaLamports:string;transactions:number;completeHistory:false}
/** These are sampled receipts, not an exhaustive wallet history. Equal endpoint
 * balances do not prove continuity: an omitted sale/rebuy can restore them.
 * Preserve isolated cashflows, but never carry acquisition basis across receipts. */
export function summarizeAccounting(input:TokenBalanceChange[],wallets:string[]):AccountingSummary{
 const allowed=new Set(wallets),rows=[...new Map(input.filter(row=>allowed.has(row.wallet)).map(row=>[`${row.signature}:${row.wallet}`,row])).values()].sort((a,b)=>a.slot-b.slot||a.timestamp-b.timestamp||a.signature.localeCompare(b.signature))
 const states=new Map<string,{tokens:bigint;unknown:boolean}>();let unknownSales=0,fees=0n,reserve=0n
 for(const row of rows){
  const before=BigInt(row.tokenBeforeRaw),after=BigInt(row.tokenAfterRaw),delta=BigInt(row.tokenDeltaRaw)
  fees+=BigInt(row.networkFeeLamports);reserve+=BigInt(row.accountReserveDeltaLamports??'0')
  if(delta<0n&&(row.kind==='sell'||row.kind==='mixed'))unknownSales++
  states.set(row.wallet,{tokens:after,unknown:after!==0n&&!(before===0n&&row.kind==='buy'&&row.basisEligible&&row.tradeCashflowLamports!==null)})
 }
 return {knownRealizedLamports:'0',realizedPnlLamports:null,unknownSales,observedTokenRaw:[...states.values()].reduce((sum,row)=>sum+row.tokens,0n).toString(),unknownTokenRaw:[...states.values()].reduce((sum,row)=>sum+(row.unknown?row.tokens:0n),0n).toString(),networkFeeLamports:fees.toString(),accountReserveDeltaLamports:reserve.toString(),transactions:new Set(rows.map(row=>row.signature)).size,completeHistory:false}
}
export function accountingCsv(rows:TokenBalanceChange[]):string{
 const fields=['signature','mint','wallet','slot','timestamp','kind','decimals','tokenBeforeRaw','tokenAfterRaw','tokenDeltaRaw','nativeDeltaLamports','wrappedSolDeltaLamports','networkFeeLamports','accountReserveDeltaLamports','tradeCashflowLamports','basisEligible'] as const
 return [fields.join(','),...rows.map(row=>fields.map(field=>{const value=String(row[field]??'');return `"${value.replaceAll('"','""')}"`}).join(','))].join('\r\n')
}
