import {PublicKey,type Connection} from '@solana/web3.js'
import {NATIVE_MINT} from '@solana/spl-token'
import {OnlinePumpSdk,getBuySolAmountFromTokenAmount,newBondingCurve,type Global,type FeeConfig,type BondingCurve} from '@pump-fun/pump-sdk'
import BN from 'bn.js'
import {advanceNativeCurve} from '@/lib/pumpfun/api'
import {withTimeout} from '@/lib/transactions/http'
import {buyPlanAddress,buyPlanText} from './model'

export interface SupplyTarget {name:string;basisPoints:number}
export interface SupplyEstimateRow {name:string;basisPoints:number;tokenRaw:string;buyLamports:string;rentLamports:string;baseNetworkLamports:string;priorityLamports:string;totalFundingLamports:string}
export interface SupplyEstimate {rows:SupplyEstimateRow[];totalFundingLamports:string;remainingSupplyBasisPoints:number;source:'new-curve'|'current-curve';checkedAt:number}
const raw=(value:string)=>{if(typeof value!=='string'||! /^(0|[1-9]\d{0,19})$/.test(value))throw new Error('The funding estimate requires exact nonnegative costs.');return BigInt(value)}
/** SDK quotes include protocol/creator charges. Network, priority and account rent are separate planning allowances. */
export function estimateSupplyTargets(input:{global:Global;feeConfig:FeeConfig|null;curve?:BondingCurve;targets:SupplyTarget[];rentLamportsPerBuyer:string;baseNetworkLamportsPerBuyer:string;priorityLamportsPerBuyer:string},now=Date.now()):SupplyEstimate {
 if(!Array.isArray(input.targets)||!input.targets.length||input.targets.length>17)throw new Error('Choose one creator and at most sixteen holder targets.')
 if(input.targets.some(row=>!row||!Number.isInteger(row.basisPoints)||row.basisPoints<1||row.basisPoints>10000)||input.targets.reduce((sum,row)=>sum+row.basisPoints,0)>10000)throw new Error('Supply targets must use positive whole basis points totaling at most 100%.')
 let curve=input.curve??newBondingCurve(input.global,NATIVE_MINT)
 if(curve.complete||(!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT)))throw new Error('Funding estimates require an active SOL Pump.fun curve.')
 const supply=curve.tokenTotalSupply,rent=raw(input.rentLamportsPerBuyer),base=raw(input.baseNetworkLamportsPerBuyer),priority=raw(input.priorityLamportsPerBuyer)
 const rows=input.targets.map(target=>{
  const tokenAmount=supply.muln(target.basisPoints).divn(10000)
  if(tokenAmount.lten(0)||tokenAmount.gte(curve.realTokenReserves))throw new Error('The target exceeds available curve supply or would complete the curve.')
  const quote=getBuySolAmountFromTokenAmount({global:input.global,feeConfig:input.feeConfig,mintSupply:supply,bondingCurve:curve,amount:tokenAmount,quoteMint:NATIVE_MINT})
  const buy=BigInt(quote.toString());if(buy<=0n)throw new Error('The SDK returned an invalid funding quote.')
  curve=advanceNativeCurve(curve,new BN(tokenAmount.toString()))
  return {name:buyPlanText(target.name,60),basisPoints:target.basisPoints,tokenRaw:tokenAmount.toString(),buyLamports:buy.toString(),rentLamports:rent.toString(),baseNetworkLamports:base.toString(),priorityLamports:priority.toString(),totalFundingLamports:(buy+rent+base+priority).toString()}
 })
 return {rows,totalFundingLamports:rows.reduce((sum,row)=>sum+BigInt(row.totalFundingLamports),0n).toString(),remainingSupplyBasisPoints:10000-input.targets.reduce((sum,row)=>sum+row.basisPoints,0),source:input.curve?'current-curve':'new-curve',checkedAt:now}
}
export async function fetchSupplyEstimate(connection:Connection,targets:SupplyTarget[],priorityLamports:string,mint?:string):Promise<SupplyEstimate>{
 if(await withTimeout(connection.getGenesisHash())!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Supply funding estimates use Solana mainnet Pump.fun state.')
 const sdk=new OnlinePumpSdk(connection)
 const [global,feeConfig,rent,curve]=await Promise.all([withTimeout(sdk.fetchGlobal()),withTimeout(sdk.fetchFeeConfig()),withTimeout(connection.getMinimumBalanceForRentExemption(165)),mint?withTimeout(sdk.fetchBondingCurve(new PublicKey(buyPlanAddress(mint)))):Promise.resolve(undefined)])
 if(!Number.isSafeInteger(rent)||rent<0)throw new Error('Token-account rent cannot be read exactly.')
 // This is a funding allowance, not an executable packet fee quote. Actual native
 // packets are quoted and signed-simulated separately before every purchase.
 return estimateSupplyTargets({global,feeConfig,curve,targets,rentLamportsPerBuyer:(BigInt(rent)*2n).toString(),baseNetworkLamportsPerBuyer:'5000',priorityLamportsPerBuyer:priorityLamports})
}
