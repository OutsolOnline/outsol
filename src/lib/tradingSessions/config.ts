import {PublicKey} from '@solana/web3.js'
import type {TradingSessionConfig} from './types'
export function sessionModeFromQuery(value:unknown):TradingSessionConfig['mode'] {return value==='cap'||value==='new-launch'?value:'dca'}

export function solLamports(value:unknown):bigint {
 if(typeof value!=='string'||value.length>24||!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value))throw new Error('Use a decimal SOL amount with at most nine places.')
 const [whole,fraction='']=value.split('.')
 return BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'))
}
function address(value:unknown,label:string):string {if(typeof value!=='string')throw new Error(`Choose a valid ${label}.`);try{return new PublicKey(value).toBase58()}catch{throw new Error(`Choose a valid ${label}.`)}}
function boundedInteger(value:unknown,min:number,max:number,label:string):number {if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new Error(`${label} must be ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}.`);return value}

/** This public projection is also the only config that may enter browser storage. */
export function validateSessionConfig(value:unknown):TradingSessionConfig {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid trading session.')
 const input=value as Record<string,unknown>
 if(input.version!==1||!['dca','cap','new-launch'].includes(String(input.mode))||!['buy','sell'].includes(String(input.action)))throw new Error('Choose a supported session mode and trade direction.')
 if(typeof input.walletId!=='string'||!input.walletId.trim()||input.walletId.length>100)throw new Error('Choose a wallet from your library.')
 const payer=address(input.payer,'library wallet'),maxTrades=boundedInteger(input.maxTrades,1,10,'Maximum trades'),intervalMs=boundedInteger(input.intervalMs,5000,300000,'Interval in milliseconds'),durationMs=boundedInteger(input.durationMs,5000,300000,'Session duration in milliseconds')
 if(typeof input.slippage!=='number'||!Number.isFinite(input.slippage)||input.slippage<0||input.slippage>50)throw new Error('Slippage must be 0–50%.')
 if(typeof input.priorityFeeSol!=='number'||!Number.isFinite(input.priorityFeeSol)||input.priorityFeeSol<0||input.priorityFeeSol>0.01)throw new Error('Priority fee must be 0–0.01 SOL.')
 const sellPercent=boundedInteger(input.sellPercent,1,100,'Sell percentage of the remaining balance')
 const budget=solLamports(input.maxDebitSol)
 if(budget<=0n||budget>1_000_000_000_000n)throw new Error('The complete session debit ceiling must be above 0 and no more than 1,000 SOL.')
 const buy=solLamports(input.buySol)
 if(input.action==='buy'&&(buy<=0n||buy>1_000_000_000_000n))throw new Error('Buy amount must be above 0 and no more than 1,000 SOL.')
 const result:TradingSessionConfig={version:1,mode:input.mode as TradingSessionConfig['mode'],walletId:input.walletId,payer,action:input.action as 'buy'|'sell',buySol:input.buySol as string,sellPercent,maxTrades,intervalMs,durationMs,maxDebitSol:input.maxDebitSol as string,slippage:input.slippage,priorityFeeSol:input.priorityFeeSol}
 if(result.mode==='new-launch') {
  if(result.action!=='buy')throw new Error('Confirmed launch detection supports buy sessions only.')
  if(input.creator!==undefined&&input.creator!=='')result.creator=address(input.creator,'exact creator filter')
  if(input.keyword!==undefined&&input.keyword!=='') {
   if(typeof input.keyword!=='string'||input.keyword.trim().length<3||input.keyword.trim().length>80)throw new Error('The keyword filter must contain 3–80 characters.')
   result.keyword=input.keyword.trim()
  }
  if(!result.creator&&!result.keyword)throw new Error('Set an exact creator or a keyword filter of at least three characters.')
 } else result.mint=address(input.mint,'token mint')
 if(result.mode==='cap') {
  if(maxTrades!==1)throw new Error('A cap trigger makes one trade. Set maximum trades to 1.')
  if(input.capDirection!=='at-or-above'&&input.capDirection!=='at-or-below')throw new Error('Choose a market-cap trigger direction.')
  if(solLamports(input.capSol)<=0n)throw new Error('The SOL market-cap threshold must be positive.')
  result.capDirection=input.capDirection;result.capSol=input.capSol as string
 }
 return result
}
