import {buyPlanObject,buyPlanText} from '@/lib/buyPlans/model'
import {solLamports,validateSessionConfig} from './config'
import {parseObservedBuyRule,type ObservedBuyRule} from './observedTrades'
import type {TradingSessionConfig} from './types'
export interface StrategyQueueStep {id:string;name:string;config:TradingSessionConfig;counter?:ObservedBuyRule}
export interface StrategyQueueConfig {version:1;id:string;name:string;maxDebitSol:string;durationMs:number;steps:StrategyQueueStep[];observedBuyGuard?:ObservedBuyRule}
export function validateStrategyQueue(value:unknown):StrategyQueueConfig {
 const input=buyPlanObject(value,['version','id','name','maxDebitSol','durationMs','steps','observedBuyGuard'])
 if(input.version!==1||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>10||typeof input.durationMs!=='number'||!Number.isInteger(input.durationMs)||input.durationMs<5000||input.durationMs>300000)throw new Error('Choose one to ten strategies and a total active duration of 5–300 seconds.')
 const steps=input.steps.map(value=>{const step=buyPlanObject(value,['id','name','config','counter']),config=validateSessionConfig(step.config),counter=step.counter===undefined?undefined:parseObservedBuyRule(step.counter);if(counter&&(config.mode!=='dca'||config.maxTrades!==1||!config.mint))throw new Error('An observed counter makes one fixed-size trade on an existing mint.');return {id:buyPlanText(step.id,100),name:buyPlanText(step.name),config,...(counter?{counter}:{})}})
 if(new Set(steps.map(step=>step.id)).size!==steps.length)throw new Error('Strategy step identifiers must be distinct.')
 if(steps.reduce((sum,step)=>sum+step.config.maxTrades,0)>10)throw new Error('The complete queue supports at most ten (10) approved trades.')
 const total=solLamports(input.maxDebitSol)
 if(total<=0n||total>1_000_000_000_000n||steps.reduce((sum,step)=>sum+solLamports(step.config.maxDebitSol),0n)>total)throw new Error('The combined strategy ceilings exceed the aggregate queue debit ceiling.')
 const observedBuyGuard=input.observedBuyGuard===undefined?undefined:parseObservedBuyRule(input.observedBuyGuard)
 if(observedBuyGuard&&(steps.some(step=>step.counter||!step.config.mint)||new Set(steps.map(step=>step.config.mint)).size!==1))throw new Error('A stop-on-observed-buy rule needs one existing mint and cannot be combined with counter steps.')
 return {version:1,id:buyPlanText(input.id,100),name:buyPlanText(input.name),maxDebitSol:input.maxDebitSol as string,durationMs:input.durationMs,steps,...(observedBuyGuard?{observedBuyGuard}:{})}
}
