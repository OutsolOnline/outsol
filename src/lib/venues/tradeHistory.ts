export const TRADE_PENDING_KEY='vanity-trade-pending'
export const TRADE_HISTORY_KEY='vanity-trade-receipts'
export interface TradeStorage{getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void}
export interface PendingTrade{action:'buy'|'sell';mint:string;payer:string;signature:string;blockhash:string;submittedAt:string;maxBuyLamports:string;maxSellRaw:string;expiryBlockHeight?:number}
export interface TradeReceipt extends PendingTrade{status:'confirmed'|'failed';resolvedAt:string;error?:string}
const storageOrThrow=(storage?:TradeStorage)=>{
  if(storage)return storage
  if(typeof localStorage==='undefined')throw new Error('Trade recovery storage is unavailable')
  return localStorage
}
function publicRecord(value:PendingTrade):PendingTrade{
  if(!value||!['buy','sell'].includes(value.action)||['mint','payer','signature','blockhash','submittedAt'].some(key=>typeof value[key as keyof PendingTrade]!=='string'||!value[key as keyof PendingTrade])||!/^\d+$/.test(value.maxBuyLamports)||!/^\d+$/.test(value.maxSellRaw))throw new Error('Trade recovery storage contains an invalid record')
  if(value.expiryBlockHeight!==undefined&&(!Number.isSafeInteger(value.expiryBlockHeight)||value.expiryBlockHeight<0))throw new Error('Trade recovery expiry height is invalid')
  return {action:value.action,mint:value.mint,payer:value.payer,signature:value.signature,blockhash:value.blockhash,submittedAt:value.submittedAt,maxBuyLamports:value.maxBuyLamports,maxSellRaw:value.maxSellRaw,...(value.expiryBlockHeight===undefined?{}:{expiryBlockHeight:value.expiryBlockHeight})}
}
export function readTradePending(storage?:TradeStorage):PendingTrade|null{
  if(!storage&&typeof window==='undefined')return null
  try{const raw=storageOrThrow(storage).getItem(TRADE_PENDING_KEY);return raw?publicRecord(JSON.parse(raw)):null}
  catch{throw new Error('Trade recovery storage cannot be read. Preserve browser data and check your last transaction before trading again.')}
}
export function saveTradePending(input:PendingTrade,storage?:TradeStorage):void{
  const target=storageOrThrow(storage),existing=readTradePending(target)
  if(existing)throw new Error('A previous trade is still awaiting confirmation')
  target.setItem(TRADE_PENDING_KEY,JSON.stringify(publicRecord(input)))
  if(readTradePending(target)?.signature!==input.signature)throw new Error('The trade recovery record could not be saved; nothing was submitted')
}
export function clearTradePending(signature:string,storage?:TradeStorage):void{
  const target=storageOrThrow(storage)
  if(readTradePending(target)?.signature===signature)target.removeItem(TRADE_PENDING_KEY)
}
export function saveTradeExpiryBoundary(signature:string,height:number,storage?:TradeStorage):PendingTrade|null{
  const target=storageOrThrow(storage),current=readTradePending(target)
  if(!current||current.signature!==signature||current.expiryBlockHeight!==undefined)return current
  const updated=publicRecord({...current,expiryBlockHeight:height})
  target.setItem(TRADE_PENDING_KEY,JSON.stringify(updated))
  const saved=readTradePending(target)
  if(saved?.signature===signature&&saved.expiryBlockHeight!==height)throw new Error('The public recovery boundary could not be saved')
  return saved
}
export function readTradeHistory(storage?:TradeStorage):TradeReceipt[]{
  const parsed=JSON.parse(storageOrThrow(storage).getItem(TRADE_HISTORY_KEY)||'[]')
  if(!Array.isArray(parsed))throw new Error('Trade history is unreadable')
  return parsed.filter(item=>item.status==='confirmed'||item.status==='failed').slice(0,30).map(item=>({...publicRecord(item),status:item.status,resolvedAt:String(item.resolvedAt),...(item.error?{error:String(item.error).slice(0,500)}:{})}))
}
export function saveTradeReceipt(pending:PendingTrade,status:'confirmed'|'failed',error?:string,storage?:TradeStorage):TradeReceipt{
  const target=storageOrThrow(storage),receipt:TradeReceipt={...publicRecord(pending),status,resolvedAt:new Date().toISOString(),...(error?{error:error.slice(0,500)}:{})}
  let history:TradeReceipt[]=[]
  try{history=readTradeHistory(target)}catch{ /* Keep the new public receipt if old history is damaged. */ }
  target.setItem(TRADE_HISTORY_KEY,JSON.stringify([receipt,...history.filter(item=>item.signature!==receipt.signature)].slice(0,30)))
  clearTradePending(receipt.signature,target)
  return receipt
}
