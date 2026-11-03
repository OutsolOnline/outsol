import {canonicalAddress,canonicalSignature} from './validation'
import type {TokenMarketSnapshot} from './types'
const unsigned=(value:unknown)=>typeof value==='string'&&/^\d{1,40}$/.test(value)
const signed=(value:unknown)=>typeof value==='string'&&/^-?\d{1,40}$/.test(value)
const natural=(value:unknown,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max
const price=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0
function validate(value:unknown,mint:string):TokenMarketSnapshot{
 if(!value||typeof value!=='object')throw new Error('Invalid market snapshot')
 const row=value as TokenMarketSnapshot,c=row.coverage,d=row.distribution
 if(row.mint!==mint||!['ready','unavailable','unsupported'].includes(row.status)||typeof row.fetchedAt!=='string'||row.fetchedAt.length>40||!Number.isFinite(Date.parse(row.fetchedAt))||row.decimals!==null&&!natural(row.decimals,18)||row.supplyRaw!==null&&!unsigned(row.supplyRaw)||!['active','graduated','unverified'].includes(row.curveStatus)||!c||c.complete!==false||!['recent','receipts'].includes(c.kind)||![c.requested,c.read,c.missing,c.unsupported,c.failed,c.invalid].every(n=>natural(n,12))||c.read+c.missing+c.unsupported+c.failed+c.invalid>c.requested)throw new Error('Invalid coverage')
 if(!Array.isArray(row.trades)||row.trades.length>256||!Array.isArray(row.candles)||row.candles.length>256||!Array.isArray(row.balanceChanges)||row.balanceChanges.length>4096||!Array.isArray(row.warnings)||row.warnings.length>10||row.warnings.some(text=>typeof text!=='string'||text.length>1024))throw new Error('Invalid sample bounds')
 for(const trade of row.trades)if(!canonicalSignature(trade.signature)||!natural(trade.ordinal,511)||trade.id!==`${trade.signature}:${trade.ordinal}`||!canonicalAddress(trade.wallet)||!natural(trade.slot)||!natural(trade.timestamp)||!['buy','sell'].includes(trade.side)||![trade.tokenAmountRaw,trade.solAmountLamports,trade.feeLamports,trade.creatorFeeLamports].every(unsigned)||!price(trade.priceSol))throw new Error('Invalid trade')
 for(const candle of row.candles)if(!natural(candle.timestamp)||![candle.open,candle.high,candle.low,candle.close].every(price)||candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close)||!Number.isFinite(candle.volumeSol)||candle.volumeSol<0||!natural(candle.trades,256))throw new Error('Invalid chart')
 if(!d||!['ready','unavailable'].includes(d.status)||!Array.isArray(d.owners)||d.owners.length>20||!natural(d.sampledAccounts,20)||!unsigned(d.sampledAmountRaw)||d.sampledSupplyPct!==null&&(!Number.isFinite(d.sampledSupplyPct)||d.sampledSupplyPct<0||d.sampledSupplyPct>100)||d.slot!==null&&!natural(d.slot))throw new Error('Invalid distribution')
 for(const owner of d.owners)if(!canonicalAddress(owner.owner)||!unsigned(owner.amountRaw)||!natural(owner.accounts,20)||!Number.isFinite(owner.supplyPct)||owner.supplyPct<0||owner.supplyPct>100)throw new Error('Invalid account owner')
 for(const change of row.balanceChanges)if(change.mint!==mint||!canonicalSignature(change.signature)||!canonicalAddress(change.wallet)||!natural(change.slot)||!natural(change.timestamp)||!natural(change.decimals,18)||!['buy','sell','transfer','mixed'].includes(change.kind)||![change.tokenBeforeRaw,change.tokenAfterRaw,change.networkFeeLamports].every(unsigned)||!signed(change.tokenDeltaRaw)||!signed(change.wrappedSolDeltaLamports)||change.nativeDeltaLamports!==null&&!signed(change.nativeDeltaLamports)||change.accountReserveDeltaLamports!==null&&!signed(change.accountReserveDeltaLamports)||change.tradeCashflowLamports!==null&&!signed(change.tradeCashflowLamports)||typeof change.basisEligible!=='boolean'||change.basisEligible&&change.tradeCashflowLamports===null)throw new Error('Invalid balance evidence')
 return row
}
export async function fetchTokenMarket(mint:string,signatures:string[]=[],signal?:AbortSignal,transport:typeof fetch=fetch):Promise<TokenMarketSnapshot>{
 if(!canonicalAddress(mint)||signatures.length>8||signatures.some(value=>!canonicalSignature(value))||new Set(signatures).size!==signatures.length)throw new Error('Choose a valid mint and up to eight distinct receipt signatures.')
 const query=new URLSearchParams({mint});signatures.forEach(signature=>query.append('signature',signature))
 const response=await transport(`/api/token-market?${query}`,{method:'GET',cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15_000)]):AbortSignal.timeout(15_000),redirect:'error'})
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error(response.status===429?'Market request limit reached. Retry in a minute.':'Confirmed data could not be loaded. Retry shortly.')
 const reader=response.body?.getReader();if(!reader)throw new Error('Market data could not be read.')
 const chunks:Uint8Array[]=[];let size=0
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_048_576){await reader.cancel();throw new Error('Market response exceeded the safe read limit.')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),mint)}catch{throw new Error('Confirmed data was incomplete or unreadable. Retry shortly.')}
}
