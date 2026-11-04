import {PublicKey} from '@solana/web3.js'

export class AutomationError extends Error {constructor(public status:number,message:string){super(message)}}
export const CAPABILITY_PATTERN=/^[A-Za-z0-9_-]{43}$/
export interface AutomationPlan {
 version:1;mode:'dca';mint:string;action:'buy'|'sell';buySol:string;sellAmountRaw:string
 intervalSeconds:number;startAt:number;expiresAt:number;maxTrades:number
 maxDebitPerTradeSol:string;maxTotalDebitSol:string;minReserveSol:string;slippage:number;priorityFeeSol:number
}
export type PolicyStatus='review'|'armed'|'cancelled'|'expired'|'completed'|'blocked'
export interface AutomationPolicy {id:string;hash:string;plan:AutomationPlan;status:PolicyStatus;attempts:number;reservedDebitLamports:string;nextRunAt:number;message:string}
export interface AutomationHistory {signature:string;status:'pending'|'confirmed'|'failed';createdAt:number;resolvedAt:number|null;reservedDebitLamports:string;simulatedDebitLamports:string;policyId:string}
export interface AutomationWalletView {id:string;address:string;createdAt:number;backupAcknowledged:boolean;policy:AutomationPolicy|null;history:AutomationHistory[]}
export function solLamports(value:unknown):bigint {
 if(typeof value!=='string'||!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value))throw new AutomationError(400,'Use a decimal SOL amount with up to nine places.')
 const [whole,fraction='']=value.split('.');return BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'))
}
export function parseAutomationPlan(value:unknown,now=Date.now()):AutomationPlan {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AutomationError(400,'Review the scheduled trade details.')
 const p=value as AutomationPlan
 const fields=['version','mode','mint','action','buySol','sellAmountRaw','intervalSeconds','startAt','expiresAt','maxTrades','maxDebitPerTradeSol','maxTotalDebitSol','minReserveSol','slippage','priorityFeeSol']
 if(Object.keys(p).length!==fields.length||Object.keys(p).some(k=>!fields.includes(k))||p.version!==1||p.mode!=='dca'||!['buy','sell'].includes(p.action))throw new AutomationError(400,'Only the bounded scheduled DCA plan is supported.')
 try{if(typeof p.mint!=='string'||new PublicKey(p.mint).toBase58()!==p.mint)throw new Error()}catch{throw new AutomationError(400,'Choose one valid Solana mint.')}
 const buy=solLamports(p.buySol),per=solLamports(p.maxDebitPerTradeSol),total=solLamports(p.maxTotalDebitSol),reserve=solLamports(p.minReserveSol)
 if(typeof p.sellAmountRaw!=='string'||!/^(0|[1-9]\d{0,19})$/.test(p.sellAmountRaw)||BigInt(p.sellAmountRaw)>18_446_744_073_709_551_615n)throw new AutomationError(400,'Use an exact whole raw token amount.')
 if((p.action==='buy'&&(buy<=0n||p.sellAmountRaw!=='0'))||(p.action==='sell'&&(buy!==0n||BigInt(p.sellAmountRaw)<=0n)))throw new AutomationError(400,'Review the exact buy or sell amount.')
 if(!Number.isFinite(p.slippage)||p.slippage<0||p.slippage>10||!Number.isFinite(p.priorityFeeSol)||p.priorityFeeSol<0||p.priorityFeeSol>0.001)throw new AutomationError(400,'Slippage is capped at 10% and priority fees at 0.001 SOL.')
 if(!Number.isInteger(p.maxTrades)||p.maxTrades<1||p.maxTrades>10||!Number.isInteger(p.intervalSeconds)||p.intervalSeconds<60||p.intervalSeconds>3600)throw new AutomationError(400,'Choose 1–10 trades spaced 60–3,600 seconds apart.')
 if(!Number.isSafeInteger(p.startAt)||p.startAt<now||p.startAt>now+3_600_000||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=p.startAt||p.expiresAt>now+86_400_000||p.startAt+(p.maxTrades-1)*p.intervalSeconds*1000>=p.expiresAt)throw new AutomationError(400,'Start within one hour and expire within 24 hours, after the final scheduled trade.')
 // Reserve a conservative account-rent envelope plus base/priority fees for every attempt.
 const overhead=10_000_000n+5_000n+BigInt(Math.ceil(p.priorityFeeSol*1e9))
 if(per<buy+overhead||total<per*BigInt(p.maxTrades)||total>1_000_000_000n||reserve<5_000_000n||reserve>1_000_000_000n)throw new AutomationError(400,'Allow buy amount plus 0.01 SOL account rent and fees per trade, a 0.005 SOL reserve, and at most 1 SOL total debit.')
 return {version:1,mode:'dca',mint:p.mint,action:p.action,buySol:p.buySol,sellAmountRaw:p.sellAmountRaw,intervalSeconds:p.intervalSeconds,startAt:p.startAt,expiresAt:p.expiresAt,maxTrades:p.maxTrades,maxDebitPerTradeSol:p.maxDebitPerTradeSol,maxTotalDebitSol:p.maxTotalDebitSol,minReserveSol:p.minReserveSol,slippage:p.slippage,priorityFeeSol:p.priorityFeeSol}
}
