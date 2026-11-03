import {PublicKey} from '@solana/web3.js'
import {NATIVE_MINT} from '@solana/spl-token'
import {PUMP_PROGRAM_ID,PUMP_SDK,pumpIdl} from '@pump-fun/pump-sdk'
import {canonicalAddress,canonicalSignature} from './validation'
export {canonicalAddress,canonicalSignature} from './validation'
import type {TokenTrade,MarketCandle} from './types'

const PROGRAM=PUMP_PROGRAM_ID.toBase58(),DISCRIMINATOR=Buffer.from([189,219,127,211,78,230,97,238]),U64=(1n<<64n)-1n
const NON_TRADE_EVENTS=new Set(pumpIdl.events.filter(event=>event.name!=='TradeEvent'&&event.name!=='PostCompleteBuyEvent').map(event=>Buffer.from(event.discriminator).toString('hex')))
const unsigned=(value:{toString():string})=>{const text=value.toString();if(!/^\d{1,20}$/.test(text)||BigInt(text)>U64)throw new Error('Invalid scalar');return text}

export interface PumpTradeEvidence {status:'complete'|'invalid'|'unsupported';trades:TokenTrade[]}
const incomplete=(status:'invalid'|'unsupported'='invalid'):PumpTradeEvidence=>({status,trades:[]})
const mergeStatus=(left:PumpTradeEvidence['status'],right:PumpTradeEvidence['status']):PumpTradeEvidence['status']=>left==='invalid'||right==='invalid'?'invalid':left==='unsupported'||right==='unsupported'?'unsupported':'complete'

/** No event or parse defect is committed until its enclosing invocation succeeds.
 * A complete empty result is a non-trade; unreadable logs cannot establish that.
 * Ordinal is the original log index, so two fills in one signature stay distinct. */
export function decodeConfirmedPumpEvidence(input:unknown,signature:string,mint:string,decimals:number,now:number):PumpTradeEvidence{
 if(!canonicalSignature(signature)||!canonicalAddress(mint)||!Number.isInteger(decimals)||decimals<0||decimals>18||!Number.isSafeInteger(now)||!input||typeof input!=='object')return incomplete()
 const tx=input as {slot?:number;blockTime?:number;transaction?:{signatures?:unknown};meta?:{err?:unknown;logMessages?:unknown}}
 if(tx.meta?.err!==null||!Number.isSafeInteger(tx.slot)||tx.slot!<0||!Number.isSafeInteger(tx.blockTime)||tx.blockTime!<1_577_836_800||tx.blockTime!>now+30||!Array.isArray(tx.transaction?.signatures)||tx.transaction.signatures[0]!==signature)return incomplete()
 const logs=tx.meta.logMessages
 if(!Array.isArray(logs)||logs.length>512||logs.some(value=>typeof value!=='string'||value.length>8192)||logs.reduce((sum,value)=>sum+Buffer.byteLength(value),0)>262_144)return incomplete()
 const stack:Array<{program:string;events:TokenTrade[];status:PumpTradeEvidence['status']}>=[],result:PumpTradeEvidence={status:'complete',trades:[]}
 for(let ordinal=0;ordinal<logs.length;ordinal++){
  const line=logs[ordinal] as string,invoke=/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d{1,2})\]$/.exec(line)
  if(invoke){if(Number(invoke[2])!==stack.length+1||stack.length>=64)return incomplete();stack.push({program:invoke[1],events:[],status:'complete'});continue}
  const finish=/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed:.*)$/.exec(line)
  if(finish){const frame=stack.pop();if(!frame||frame.program!==finish[1])return incomplete();if(finish[2]==='success'){const parent=stack.at(-1);(parent?.events??result.trades).push(...frame.events);if(parent)parent.status=mergeStatus(parent.status,frame.status);else result.status=mergeStatus(result.status,frame.status)}continue}
  if(line==='Log truncated')return incomplete()
  if(stack.at(-1)?.program!==PROGRAM||!line.startsWith('Program data: '))continue
  const frame=stack.at(-1)!
  try{
   const encoded=line.slice(14)
   if(encoded.length>4096||encoded.length%4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new Error('Invalid Pump event encoding')
   const bytes=Buffer.from(encoded,'base64')
   if(bytes.length<8||bytes.length>2048||bytes.toString('base64')!==encoded)throw new Error('Invalid Pump event bytes')
   if(!bytes.subarray(0,8).equals(DISCRIMINATOR)){if(!NON_TRADE_EVENTS.has(bytes.subarray(0,8).toString('hex')))frame.status=mergeStatus(frame.status,'unsupported');continue}
   const event=PUMP_SDK.decodeTradeEventBc(bytes.subarray(8))
   if(event.mint.toBase58()!==mint)continue
   if(event.user.equals(PublicKey.default)||typeof event.isBuy!=='boolean')throw new Error('Invalid Pump trade identity')
   if(!event.quoteMint.equals(PublicKey.default)&&!event.quoteMint.equals(NATIVE_MINT)){frame.status=mergeStatus(frame.status,'unsupported');continue}
   const tokenAmountRaw=unsigned(event.tokenAmount),solAmountLamports=unsigned(event.solAmount),timestamp=Number(event.timestamp.toString()),feeLamports=unsigned(event.fee),creatorFeeLamports=unsigned(event.creatorFee)
   if(BigInt(tokenAmountRaw)===0n||BigInt(solAmountLamports)===0n||!Number.isSafeInteger(timestamp)||Math.abs(timestamp-tx.blockTime!)>60)throw new Error('Invalid Pump trade amounts or time')
   const priceSol=Number(solAmountLamports)/1e9/(Number(tokenAmountRaw)/10**decimals)
   if(!Number.isFinite(priceSol)||priceSol<=0)throw new Error('Invalid Pump trade price')
   frame.events.push({id:`${signature}:${ordinal}`,signature,ordinal,slot:tx.slot!,timestamp,wallet:event.user.toBase58(),side:event.isBuy?'buy':'sell',tokenAmountRaw,solAmountLamports,feeLamports,creatorFeeLamports,priceSol})
  }catch{frame.status='invalid'}
 }
 if(stack.length||result.trades.length>128)return incomplete()
 return result.status==='complete'?result:incomplete(result.status)
}
/** Display-only compatibility helper; execution coverage uses the structured result. */
export function decodeConfirmedPumpTrades(input:unknown,signature:string,mint:string,decimals:number,now:number):TokenTrade[]{
 return decodeConfirmedPumpEvidence(input,signature,mint,decimals,now).trades
}
export function mergeTrades(rows:TokenTrade[]):TokenTrade[]{return [...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>a.slot-b.slot||a.timestamp-b.timestamp||a.signature.localeCompare(b.signature)||a.ordinal-b.ordinal).slice(-256)}
/** Empty minutes are absent, not fabricated flat candles. Intra-slot ordering
 * across signatures is not asserted; only within-signature ordinals are known. */
export function buildCandles(rows:TokenTrade[]):MarketCandle[]{
 const candles=new Map<number,MarketCandle>()
 for(const row of [...rows].sort((a,b)=>a.timestamp-b.timestamp||a.slot-b.slot||a.signature.localeCompare(b.signature)||a.ordinal-b.ordinal)){
  const timestamp=Math.floor(row.timestamp/60)*60,current=candles.get(timestamp),volume=Number(row.solAmountLamports)/1e9
  if(current){current.high=Math.max(current.high,row.priceSol);current.low=Math.min(current.low,row.priceSol);current.close=row.priceSol;current.volumeSol+=volume;current.trades++}
  else candles.set(timestamp,{timestamp,open:row.priceSol,high:row.priceSol,low:row.priceSol,close:row.priceSol,volumeSol:volume,trades:1})
 }
 return [...candles.values()]
}
