import {PublicKey} from '@solana/web3.js'
import type {RehearsalInput,RehearsalJob,RehearsalReport} from './server/rehearsal/types'
import {migrateLegacyCreatorFeeSelection,requireSupportedCreatorFeeSelection,parseResolvedCreatorFeeRouting,resolveCreatorFeeRouting} from './creatorFeeRouting'
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid saved rehearsal.');return value as Record<string,unknown>}
function text(value:unknown,max=500):string{if(typeof value!=='string'||value.length>max)throw new Error('Invalid saved rehearsal field.');return value}
function date(value:unknown){const result=text(value,40);if(!Number.isFinite(Date.parse(result)))throw new Error('Invalid saved rehearsal date.');return result}
function amount(value:unknown){const result=text(value,30);if(!/^(0|[1-9]\d{0,25})$/.test(result))throw new Error('Invalid saved rehearsal amount.');return result}
function address(value:unknown){return new PublicKey(text(value,44)).toBase58()}
export function restoreRehearsalSession(raw:string):{input:RehearsalInput;job:RehearsalJob;placeholder:boolean}{
 if(raw.length>50000)throw new Error('Saved rehearsal exceeds its read limit.')
 const saved=record(JSON.parse(raw)),source=record(saved.input),value=record(saved.job)
 const input:RehearsalInput={name:text(source.name,80),symbol:text(source.symbol,20),metadataUri:text(source.metadataUri,500),initialBuySol:text(source.initialBuySol,20),priorityFeeSol:text(source.priorityFeeSol,20),jitoTipSol:text(source.jitoTipSol,20),creatorFeeSelection:Object.hasOwn(source,'creatorFeeSelection')?requireSupportedCreatorFeeSelection(source.creatorFeeSelection):migrateLegacyCreatorFeeSelection(undefined)}
 const id=text(value.id,48),status=text(value.status,20)
 if(!/^[a-f0-9]{48}$/.test(id)||!['queued','running','succeeded','failed','cancelled'].includes(status))throw new Error('Invalid saved rehearsal status.')
 const job:RehearsalJob={id,status:status as RehearsalJob['status'],createdAt:date(value.createdAt),expiresAt:date(value.expiresAt),...(typeof value.error==='string'?{error:text(value.error,500)}:{})}
 if(status==='succeeded'){
  const report=record(value.result)
  if(report.network!=='local-mainnet-fork'||report.runtimeVersion!=='1.6.1'||report.platformFeeLamports!=='0'||report.mintAuthority!==null||report.freezeAuthority!==null||report.metadataImmutable!==true||!['single','atomic-bundle'].includes(String(report.execution))||!Number.isInteger(report.decimals)||Number(report.decimals)<0||Number(report.decimals)>18)throw new Error('Invalid saved rehearsal report.')
  const numeric=['supplyRaw','walletTokenRaw','payerBeforeLamports','payerAfterLamports','totalCostLamports','networkFeeLamports','initialBuyLamports','initialBuyBudgetLamports','jitoTipLamports','curveRealSolReservesLamports','curveRealTokenReservesRaw'] as const
  const amounts=Object.fromEntries(numeric.map(key=>[key,amount(report[key])]))
  const signatures=report.transactionSignatures
  if(!Array.isArray(signatures)||!signatures.length||signatures.length>5||signatures.some(value=>typeof value!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)))throw new Error('Invalid local execution signatures.')
  job.result={...amounts,network:'local-mainnet-fork',runtimeVersion:'1.6.1',platformFeeLamports:'0',mintAuthority:null,freezeAuthority:null,metadataImmutable:true,execution:report.execution,mint:address(report.mint),payer:address(report.payer),name:text(report.name,80),symbol:text(report.symbol,20),metadataUri:text(report.metadataUri,500),decimals:report.decimals,transactionSignatures:[...signatures],unsupported:{devLock:'not-configured',lp:'not-configured'},completedAt:date(report.completedAt),actualCostBreakdownNote:text(report.actualCostBreakdownNote,2000)} as RehearsalReport
  if(Object.hasOwn(report,'creatorFeeRouting')||Object.hasOwn(report,'observedRouting')){
   const routing=parseResolvedCreatorFeeRouting(report.creatorFeeRouting),observed=record(report.observedRouting)
   const expectedRouting=resolveCreatorFeeRouting({selection:requireSupportedCreatorFeeSelection(input.creatorFeeSelection),payer:job.result.payer,mint:job.result.mint,github:routing.github})
   if(JSON.stringify(routing)!==JSON.stringify(expectedRouting)||observed.creator!==routing.effectiveCreator||observed.isHolderReward!==routing.holderReward||observed.isCashbackCoin!==false||observed.verifiedRecipient!==(routing.socialRecipient??routing.effectiveCreator))throw new Error('Saved rehearsal routing does not match its verified state.')
   let sharing:NonNullable<RehearsalReport['observedRouting']>['sharing']
   if(routing.selection.kind==='github'){
    const value=record(observed.sharing)
    if(value.address!==routing.sharingConfig||value.adminRevoked!==true||value.shareholder!==routing.socialRecipient||value.shareBps!==10000)throw new Error('Saved GitHub sharing state does not match its reviewed recipient.')
    sharing={address:routing.sharingConfig!,adminRevoked:true,shareholder:routing.socialRecipient!,shareBps:10000}
   }else if(Object.hasOwn(observed,'sharing'))throw new Error('Unexpected saved sharing state.')
   job.result.creatorFeeRouting=routing
   job.result.observedRouting={creator:routing.effectiveCreator,isHolderReward:routing.holderReward,isCashbackCoin:false,verifiedRecipient:routing.socialRecipient??routing.effectiveCreator,...(sharing?{sharing}:{})}
  }
 }
 return {input,job,placeholder:saved.placeholder===true}
}
