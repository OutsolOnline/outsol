import React from 'react'
import Link from 'next/link'
import type {StrategyQueueStep} from '@/lib/tradingSessions/queueModel'
import type {ObservedBuyRule} from '@/lib/tradingSessions/observedTrades'
import {solLamports} from '@/lib/tradingSessions/config'
import {formatTokenAmount} from '@/lib/walletInspector'

const sol=(raw:string)=>formatTokenAmount(raw,9)
function PublicAddress({address}:{address:string}){return <a className="text-accent font-mono text-xs break-all" href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer">{address}</a>}
function Whitelist({addresses}:{addresses:readonly string[]}){return addresses.length?<ul className="space-y-2 mt-2">{addresses.map(address=><li key={address}><PublicAddress address={address}/></li>)}</ul>:<p className="field-help">No extra whitelisted addresses.</p>}

/** Read the persisted step itself, independently of the candidate form above. */
export function StrategyQueueStepReview({step,position,totalSteps,confirmedTrades,reservedDebitLamports,walletName}:{step:StrategyQueueStep;position:number;totalSteps:number;confirmedTrades:number;reservedDebitLamports:string;walletName?:string}){
 const config=step.config,remainingDebit=solLamports(config.maxDebitSol)-BigInt(reservedDebitLamports),priority=sol(String(Math.round(config.priorityFeeSol*1e9)))
 return <div className="mt-4 space-y-4" aria-label={`Stored execution review for ${step.name}`}>
  <p className="field-help">Execution order: {position} of {totalSteps}. {confirmedTrades>=config.maxTrades?'This strategy is complete and will not run again.':position===1?'This strategy runs first.':'This strategy waits for the preceding strategy to finish.'} Strategies run in the displayed order.</p>
  <dl className="grid sm:grid-cols-2 gap-x-5 gap-y-4 text-sm">
   <div className="sm:col-span-2"><dt className="text-muted">Signing wallet{walletName?` · ${walletName}`:''}</dt><dd className="mt-1"><PublicAddress address={config.payer}/><p className="field-help">Library reference: {config.walletId}</p></dd></div>
   <div className="sm:col-span-2"><dt className="text-muted">Token to trade</dt><dd className="mt-1">{config.mode==='new-launch'?<span>New confirmed Pump.fun launches matching the filters below.</span>:<Link className="text-accent font-mono text-xs break-all" href={`/token/${config.mint}`}>{config.mint}</Link>}</dd></div>
   <div><dt className="text-muted">Trade direction and size</dt><dd className="mt-1">{config.action==='buy'?`Buy · ${config.buySol} SOL maximum per trade`:`Sell · ${config.sellPercent}% of remaining token balance per trade`}</dd></div>
   <div><dt className="text-muted">Approved trade count</dt><dd className="mt-1">{confirmedTrades} of {config.maxTrades} confirmed · {Math.max(0,config.maxTrades-confirmedTrades)} remaining</dd></div>
   <div><dt className="text-muted">Complete strategy debit ceiling</dt><dd className="mt-1">{config.maxDebitSol} SOL</dd></div>
   <div><dt className="text-muted">Previously reserved for this strategy</dt><dd className="mt-1">{sol(reservedDebitLamports)} SOL</dd></div>
   <div><dt className="text-muted">Remaining strategy debit allowance</dt><dd className="mt-1">{remainingDebit<0n?'Edited ceiling is below prior reserved spending':`${sol(remainingDebit.toString())} SOL`}</dd></div>
   <div><dt className="text-muted">Active duration per continuation attempt</dt><dd className="mt-1">{config.durationMs/1000} seconds, within the queue’s remaining active-time limit</dd></div>
   <div><dt className="text-muted">{config.mode==='dca'?'Minimum wait between trades':'Trigger poll interval'}</dt><dd className="mt-1">{config.intervalMs/1000} seconds</dd></div>
   <div><dt className="text-muted">Slippage allowance</dt><dd className="mt-1">{config.slippage}%</dd></div>
   <div><dt className="text-muted">Priority fee ceiling per trade</dt><dd className="mt-1">{priority} SOL</dd></div>
   {config.mode==='cap'&&<div><dt className="text-muted">SOL market-cap trigger</dt><dd className="mt-1">{config.capDirection==='at-or-above'?'At or above':'At or below'} {config.capSol} SOL</dd></div>}
  </dl>
  {config.mode==='new-launch'&&<div className="rounded border border-border p-3 space-y-2 text-sm"><h4>Stored launch filters</h4><p className="field-help">Exact creator: {config.creator?<PublicAddress address={config.creator}/>:<span>Any creator</span>}</p><p className="field-help">Name or symbol keyword: {config.keyword?<span className="text-foreground">{config.keyword}</span>:<span>Any keyword</span>}</p><p className="field-help">{config.creator&&config.keyword?'Both filters must match.':'The specified filter must match.'} The first confirmed sample is a baseline. Launch coverage is a bounded recent sample and may miss launches.</p></div>}
  {config.relay?<div className="rounded border border-border p-3 text-sm space-y-2"><h4>Relay after each confirmed buy</h4><p className="field-help">Exact recipient:</p><PublicAddress address={config.relay.destination}/><p className="field-help">Receiver library reference: {config.relay.walletId}</p><p className="field-help">Maximum Relay network fees and account rent: <span className="text-foreground">{config.relay.maxDebitSol} SOL per purchase</span>, reserved inside the strategy and queue ceilings.</p><p className="field-help">Only the newly purchased tokens move in a separate reviewed Relay transaction; existing source holdings remain.</p></div>:<p className="field-help">No Relay transfer. {config.action==='buy'?'Purchased tokens remain in the signing wallet.':'Sale proceeds remain in the signing wallet.'}</p>}
  {step.counter&&<div className="rounded border border-border p-3 space-y-2 text-sm"><h4>Observed external-buy counter</h4><p>At least {step.counter.minBuySol} SOL in one new observed external buy triggers one fixed-size trade using this step’s direction and amount.</p><p className="field-help">The first sample is a baseline. Managed wallet addresses and this stored whitelist are ignored:</p><Whitelist addresses={step.counter.whitelist}/><p className="field-help">Confirmed recent samples may miss trades. Missing, stale or non-overlapping evidence stops the run.</p></div>}
  <p className="field-help">Buy spending, protocol charges, network fees, account rent and any Relay reserve stay within the displayed strategy ceiling and the shared queue ceiling. Sale proceeds do not replenish either ceiling. OutSol fee: 0 SOL.</p>
 </div>
}

/** Keep the complete stored stop rule visible beside the final queue approval. */
export function StrategyQueueGuardReview({rule}:{rule?:ObservedBuyRule}){
 return rule?<div className="rounded border border-border p-4 text-sm space-y-2" aria-label="Stored queue observed-buy stop rule"><h3>Observed external-buy stop rule for this queue</h3><p>Strictly greater than {rule.minBuySol} SOL in accumulated deduplicated observed external buys stops remaining strategies. Exact equality does not trigger.</p><p className="field-help">The first sample is a baseline. Managed wallets and these exact whitelisted addresses are ignored:</p><Whitelist addresses={rule.whitelist}/><p className="field-help">The rule uses a bounded recent confirmed sample, may miss trades and does not monitor paused time. It stops future actions and does not sell existing holdings.</p></div>:<p className="field-help">No queue-wide observed external-buy stop rule is enabled.</p>
}
