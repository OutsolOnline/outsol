import {AutomationError,parseAutomationPlan,solLamports} from '../../automationWallets/model'
import type {AutomationStore} from './store'
import {automationTradeInput,type AutomationPorts} from './worker'

export function createAutomationService(options:{store:AutomationStore;ports:AutomationPorts;balance:(address:string)=>Promise<string>;enabled:()=>boolean;ensureWorker?:()=>void;workerReady?:()=>boolean}){
 const {store,ports}=options
 const enabled=()=>{if(!options.enabled())throw new AutomationError(503,'Unattended trading is disabled by the site owner.')}
 const mainnet=async()=>{if(await ports.genesis()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new AutomationError(503,'The server could not verify Solana mainnet.')}
 return {
  create(){enabled();return store.createWallet(ports.now())},
  async status(capability:string){const wallet=store.read(capability);if(options.enabled())try{options.ensureWorker?.()}catch{/* Preserve owned recovery/status while startup is retried on future requests. */}let balanceLamports:string|null=null;try{await mainnet();balanceLamports=await options.balance(wallet.address)}catch{}return {wallet,balanceLamports,enabled:options.enabled(),workerRunning:options.workerReady?.()??false}},
  backup(capability:string,consent:boolean){return {keypair:store.backup(capability,consent)}},
  async review(capability:string,value:unknown){
   enabled();const plan=parseAutomationPlan(value,ports.now()),wallet=store.read(capability);if(!wallet.backupAcknowledged)throw new AutomationError(409,'Download and keep the dedicated keypair backup first.')
   await mainnet();const prepared=await ports.prepare(automationTradeInput(plan,wallet.address),plan.action==='sell'?{exactSellAmountRaw:plan.sellAmountRaw}:{})
   const debit=-BigInt(prepared.solChangeLamports),balance=BigInt(prepared.position.solLamports)
   if(plan.action==='sell'&&BigInt(prepared.position.tokenRaw)<BigInt(plan.sellAmountRaw)*BigInt(plan.maxTrades))throw new AutomationError(409,'The dedicated token balance does not cover every exact scheduled sell.')
   if(debit>solLamports(plan.maxDebitPerTradeSol)||balance<solLamports(plan.maxTotalDebitSol)+solLamports(plan.minReserveSol))throw new AutomationError(409,'Fund the dedicated wallet for the full approved debit ceiling plus its minimum reserve.')
   const review=store.review(capability,plan,ports.now())
   return {...review,preview:{tokenDecimals:prepared.position.decimals,tokenAmountRaw:prepared.tokenAmountRaw,minimumSolOut:prepared.minimumSolOut,simulatedDebitLamports:(debit>0n?debit:0n).toString(),networkFeeLamports:prepared.networkFeeLamports},notice:'This approves the exact schedule, mint, amounts and ceilings. Future native quotes are freshly simulated within those limits. Network fees and account rent count inside the debit ceiling.'}
  },
  async arm(capability:string,hash:string,consent:boolean){enabled();if(consent!==true)throw new AutomationError(400,'Explicitly approve server signing and browser-closed execution of the exact reviewed plan.');await mainnet();const wallet=store.read(capability);if(!wallet.policy||BigInt(await options.balance(wallet.address))<solLamports(wallet.policy.plan.maxTotalDebitSol)+solLamports(wallet.policy.plan.minReserveSol))throw new AutomationError(409,'The wallet no longer covers the full approved ceiling and reserve.');options.ensureWorker?.();if(options.workerReady&&!options.workerReady())throw new AutomationError(503,'The unattended worker could not start. The reviewed plan has not been armed.');return {wallet:store.arm(capability,hash,ports.now())}},
  cancel(capability:string){return {wallet:store.cancel(capability,ports.now())}},
 }
}
