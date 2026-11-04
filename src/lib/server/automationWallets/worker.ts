import {Connection,type VersionedTransaction} from '@solana/web3.js'
import {solLamports,type AutomationPlan} from '../../automationWallets/model'
import {inspectTradeIntent,preparePumpTrade,type PreparedTrade,type TradeInput} from '../../venues/trade'
import {simulateSignedTrade} from '../../tradingSessions/chain'
import type {SignedTradePreview} from '../../tradingSessions/types'
import {signedTransactionSignature} from '../../transactions/send'
import {withTimeout} from '../../transactions/http'
import {AutomationStore,type AutomationLease} from './store'
import {createAutomationSimulationFetch} from './rpc'

export interface AutomationPorts {
 now:()=>number;genesis:()=>Promise<string>;prepare:(input:TradeInput,options?:{exactSellAmountRaw?:string})=>Promise<PreparedTrade>
 simulate:(transaction:VersionedTransaction,prepared:PreparedTrade,guard:()=>void)=>Promise<SignedTradePreview>
 blockhashValid:(blockhash:string)=>Promise<boolean>;send:(packet:Uint8Array)=>Promise<string>;status:(signature:string)=>Promise<'confirmed'|'failed'|'unknown'>
}
export function automationTradeInput(plan:AutomationPlan,address:string):TradeInput{return {action:plan.action,mint:plan.mint,payer:address,buySol:plan.buySol,sellPercent:100,slippage:plan.slippage,priorityFeeSol:plan.priorityFeeSol}}
export function createAutomationPorts(connection:Connection):AutomationPorts{const simulationFetch=createAutomationSimulationFetch(connection.rpcEndpoint);return {
 now:Date.now,genesis:()=>withTimeout(connection.getGenesisHash()),prepare:(input,options)=>preparePumpTrade(connection,input,{...options,simulationFetch}),simulate:(tx,p,guard)=>simulateSignedTrade(connection,tx,p,guard,simulationFetch),
 blockhashValid:async blockhash=>(await withTimeout(connection.isBlockhashValid(blockhash,{commitment:'confirmed'}))).value,
 send:packet=>withTimeout(connection.sendRawTransaction(packet,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0})),
 status:async signature=>{const result=await withTimeout(connection.getSignatureStatuses([signature],{searchTransactionHistory:true})),s=result.value[0];if(!s||!['confirmed','finalized'].includes(s.confirmationStatus||''))return 'unknown';return s.err?'failed':'confirmed'},
}}

/** One signed packet per recorded attempt. Pending packets are read only, even after a crash before send. */
export class AutomationWorker {
 private running=false
 private stopped=false
 constructor(private readonly store:AutomationStore,private readonly ports:AutomationPorts){}
 stop(){this.stopped=true}
 async tick():Promise<void>{
  if(this.running||this.stopped)return;this.running=true
  try{
   if(await this.ports.genesis()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')return
   for(const pending of this.store.pending()){
    if(this.stopped)return
    try{const status=await this.ports.status(pending.signature);if(status!=='unknown')this.store.resolvePending(pending.signature,status,this.ports.now())}catch{/* Keep the original signature pending. Never resubmit or replace it. */}
   }
   if(this.stopped)return
   const lease=this.store.claim(this.ports.now());if(lease)await this.execute(lease)
  }finally{this.running=false}
 }
 private async execute(lease:AutomationLease):Promise<void>{
  const guard=()=>{if(this.stopped)throw new Error('Worker stopped');this.store.guard(lease,this.ports.now())}
  try{
   guard();const input=automationTradeInput(lease.plan,lease.address),prepared=await this.ports.prepare(input,lease.plan.action==='sell'?{exactSellAmountRaw:lease.plan.sellAmountRaw}:{})
   guard()
   if(prepared.position.status!=='active'||prepared.position.payer!==lease.address||prepared.position.mint!==lease.plan.mint||JSON.stringify(prepared.input)!==JSON.stringify(input))throw new Error('Native trade authority changed')
   if(Buffer.from(prepared.transaction.message.serialize()).toString('base64')!==prepared.message)throw new Error('Prepared native message changed')
   const exactSell=lease.plan.action==='sell'?BigInt(lease.plan.sellAmountRaw):0n
   if(BigInt(prepared.maxSellRaw)!==exactSell)throw new Error('Exact token amount changed')
   inspectTradeIntent(prepared.transaction,input,exactSell)
   this.store.sign(lease,prepared.transaction,this.ports.now())
   if(Buffer.from(prepared.transaction.message.serialize()).toString('base64')!==prepared.message)throw new Error('Signing changed the approved native message')
   const signature=signedTransactionSignature(prepared.transaction),preview=await this.ports.simulate(prepared.transaction,prepared,guard)
   guard()
   const per=solLamports(lease.plan.maxDebitPerTradeSol),before=BigInt(preview.walletBeforeLamports),debit=BigInt(preview.netDebitLamports),fee=BigInt(preview.networkFeeLamports),feeCeiling=5_000n+BigInt(Math.ceil(lease.plan.priorityFeeSol*1e9))
   if(debit<0n||debit>per||fee<0n||fee>feeCeiling||before<per+solLamports(lease.plan.minReserveSol))throw new Error('Signed debit, fee or reserve ceiling cannot be verified')
   if(lease.plan.action==='buy'&&debit>solLamports(lease.plan.buySol)+10_000_000n+fee)throw new Error('The purchase exceeds the native rent envelope')
   if(!await this.ports.blockhashValid(prepared.transaction.message.recentBlockhash))throw new Error('The signed original blockhash expired')
   guard()
   if(Buffer.from(prepared.transaction.message.serialize()).toString('base64')!==prepared.message||signedTransactionSignature(prepared.transaction)!==signature)throw new Error('The original signed message or signature changed before broadcast')
   inspectTradeIntent(prepared.transaction,input,exactSell)
   // No await between this durable commit and the one permitted send. A crash here
   // deliberately leaves an ambiguous original that is only ever reconciled.
   const packet=prepared.transaction.serialize()
   this.store.recordPending(lease,signature,Buffer.from(packet).toString('base64'),debit.toString(),this.ports.now())
   try{await this.ports.send(packet)}catch{/* Lost RPC responses never trigger a second send. */}
  }catch{this.store.block(lease,'The native trade, balance, simulation, signature lifetime, or approved limits could not be verified. The plan stopped before any fresh submission. Review a new plan after resolving original pending signatures.')}
 }
}
