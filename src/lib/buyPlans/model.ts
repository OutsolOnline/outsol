import {PublicKey} from '@solana/web3.js'
import {parseObservedBuyRule,type ObservedBuyRule} from '@/lib/tradingSessions/observedTrades'

export const BUY_PLAN_KEY='outsol-staged-buy-plan-v1'
export interface BuyPlanRow {id:string;walletId:string;publicKey:string;name:string;buySol:string;maxDebitSol:string;delaySeconds:number;transferTo?:string}
export interface BuyPlan {version:1;id:string;name:string;mint?:string;createdAt:number;updatedAt:number;mode:'staged'|'sequence';order:'listed'|'reverse';intervalSeconds:number;slippage:number;priorityFeeSol:string;maxTotalDebitSol:string;rows:BuyPlanRow[];observedBuyGuard?:ObservedBuyRule}
export interface BuyPlanStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem?(key:string):void}
export function solLamports(value:unknown):bigint {
 if(typeof value!=='string'||value.length>24||!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value))throw new Error('Use an exact SOL amount with at most nine decimal places.')
 const [whole,fraction='']=value.split('.');const result=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'))
 if(result>16_000_000_000_000n)throw new Error('The SOL amount exceeds the supported ceiling.')
 return result
}
export function buyPlanAddress(value:unknown,onCurve=false):string {
 if(typeof value!=='string'||value.length>44)throw new Error('Choose a valid public Solana address.')
 const key=new PublicKey(value)
 if(key.toBase58()!==value||(onCurve&&!PublicKey.isOnCurve(key.toBytes())))throw new Error('Choose a valid public wallet address.')
 return value
}
export function buyPlanText(value:unknown,max=80):string {if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error('A public plan label is invalid.');return value.trim()}
export function buyPlanObject(value:unknown,fields:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('Only supported public plan fields can be imported.')
 return value as Record<string,unknown>
}
export function buyPlanTime(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('A public plan time is invalid.');return value}
export function parseBuyPlan(value:unknown):BuyPlan {
 const input=buyPlanObject(value,['version','id','name','mint','createdAt','updatedAt','mode','order','intervalSeconds','slippage','priorityFeeSol','maxTotalDebitSol','rows','observedBuyGuard'])
 if(input.version!==1||!['staged','sequence'].includes(String(input.mode))||!['listed','reverse'].includes(String(input.order))||typeof input.intervalSeconds!=='number'||!Number.isInteger(input.intervalSeconds)||input.intervalSeconds<0||input.intervalSeconds>300||typeof input.slippage!=='number'||!Number.isFinite(input.slippage)||input.slippage<0||input.slippage>50||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>16)throw new Error('Choose one to sixteen buyers, a supported order and bounded timing.')
 const priority=solLamports(input.priorityFeeSol),total=solLamports(input.maxTotalDebitSol)
 if(priority>10_000_000n||total<=0n)throw new Error('Priority fee must be 0–0.01 SOL and the total debit ceiling must be positive.')
 const rows:BuyPlanRow[]=input.rows.map(value=>{
  const row=buyPlanObject(value,['id','walletId','publicKey','name','buySol','maxDebitSol','delaySeconds','transferTo']),buy=solLamports(row.buySol),cap=solLamports(row.maxDebitSol),payer=buyPlanAddress(row.publicKey,true)
  if(buy<=0n||buy>1_000_000_000_000n||cap<buy+priority||cap>1_001_000_000_000n)throw new Error('Each buyer needs a positive budget up to 1,000 SOL and a debit ceiling covering its buy and priority budget.')
  if(typeof row.delaySeconds!=='number'||!Number.isInteger(row.delaySeconds)||row.delaySeconds<0||row.delaySeconds>300)throw new Error('Each buyer delay must be 0–300 whole seconds.')
  const transferTo=row.transferTo===undefined?undefined:buyPlanAddress(row.transferTo,true)
  if(transferTo===payer)throw new Error('The receiving wallet must differ from its buyer.')
  return {id:buyPlanText(row.id,100),walletId:buyPlanText(row.walletId,100),publicKey:payer,name:buyPlanText(row.name,60),buySol:row.buySol as string,maxDebitSol:row.maxDebitSol as string,delaySeconds:row.delaySeconds,...(transferTo?{transferTo}:{})}
 })
 if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.walletId)).size!==rows.length||new Set(rows.map(row=>row.publicKey)).size!==rows.length)throw new Error('Every plan row and buyer wallet must be distinct.')
 if(rows.reduce((sum,row)=>sum+solLamports(row.maxDebitSol),0n)>total)throw new Error('The aggregate wallet ceilings exceed the total plan debit ceiling.')
 if(rows.reduce((sum,row)=>sum+row.delaySeconds,0)+input.intervalSeconds*Math.max(0,rows.length-1)>300)throw new Error('Plan timing must fit within five minutes; browser delays may run late.')
 const createdAt=buyPlanTime(input.createdAt),updatedAt=buyPlanTime(input.updatedAt)
 if(updatedAt<createdAt)throw new Error('The plan update predates its creation.')
 return {version:1,id:buyPlanText(input.id,100),name:buyPlanText(input.name),createdAt,updatedAt,mode:input.mode as BuyPlan['mode'],order:input.order as BuyPlan['order'],intervalSeconds:input.intervalSeconds,slippage:input.slippage,priorityFeeSol:input.priorityFeeSol as string,maxTotalDebitSol:input.maxTotalDebitSol as string,rows,...(input.mint===undefined?{}:{mint:buyPlanAddress(input.mint)}),...(input.observedBuyGuard===undefined?{}:{observedBuyGuard:parseObservedBuyRule(input.observedBuyGuard)})}
}
export function orderedBuyRows(plan:BuyPlan):BuyPlanRow[]{const safe=parseBuyPlan(plan);return safe.order==='reverse'?safe.rows.reverse():safe.rows}
export function buyPlanFingerprint(plan:BuyPlan):string{return JSON.stringify(parseBuyPlan(plan))}
export function readBuyPlan(storage:BuyPlanStorage=localStorage):BuyPlan|null {
 try {const raw=storage.getItem(BUY_PLAN_KEY);if(raw===null)return null;if(raw.length>50000)throw new Error();return parseBuyPlan(JSON.parse(raw))}catch{throw new Error('Saved buy plan cannot be read. Preserve this browser’s data before replacing it.')}
}
export function saveBuyPlan(value:BuyPlan,storage:BuyPlanStorage=localStorage,expectedRaw?:string|null):BuyPlan {
 readBuyPlan(storage)
 if(expectedRaw!==undefined&&storage.getItem(BUY_PLAN_KEY)!==expectedRaw)throw new Error('The saved buy plan changed in another tab. Reload before saving.')
 const plan=parseBuyPlan(value),raw=JSON.stringify(plan);storage.setItem(BUY_PLAN_KEY,raw)
 if(storage.getItem(BUY_PLAN_KEY)!==raw)throw new Error('The public buy plan could not be saved. Nothing has been armed.')
 if(typeof window!=='undefined')window.dispatchEvent(new Event('outsol-buy-plan-changed'))
 return plan
}
