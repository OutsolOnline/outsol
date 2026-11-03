import {parseLaunchBundleSettings,type LaunchBundleSettings} from '@/lib/launchBundle/types'
import {formatTokenAmount} from '@/lib/walletInspector'
import {BUY_PLAN_KEY,buyPlanAddress,parseBuyPlan,readBuyPlan,saveBuyPlan,solLamports,type BuyPlan,type BuyPlanStorage} from './model'
import {assertNoPendingBuyPlan,readBuyPlanJournals} from './history'

interface Fees {slippage:number;priorityFeeSol:number}
function exactSol(value:number):string {
 if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*1e9)))throw new Error('The launch buy budget cannot be converted to exact SOL.')
 return formatTokenAmount(String(Math.round(value*1e9)),9)
}
function design(settings:LaunchBundleSettings,fees:Fees,id:string,now=Date.now()):BuyPlan {
 const source=parseLaunchBundleSettings(settings),buyers=source.wallets.filter(wallet=>wallet.buySol>0),priority=BigInt(Math.round(fees.priorityFeeSol*1e9))
 if(!source.deferBuys||!buyers.length)throw new Error('Choose buyer amounts before saving a staged launch plan.')
 const rows=buyers.map(wallet=>({id:wallet.walletId,walletId:wallet.walletId,publicKey:wallet.publicKey,name:wallet.name,buySol:exactSol(wallet.buySol),maxDebitSol:formatTokenAmount((BigInt(Math.round(wallet.buySol*1e9))+priority+15_000_000n).toString(),9),delaySeconds:wallet.delaySeconds,...(wallet.transferTo?{transferTo:wallet.transferTo}:{})}))
 return parseBuyPlan({version:1,id,name:'Buy after confirmed launch',createdAt:now,updatedAt:now,mode:'staged',order:'listed',intervalSeconds:0,slippage:fees.slippage,priorityFeeSol:exactSol(fees.priorityFeeSol),maxTotalDebitSol:formatTokenAmount(rows.reduce((total,row)=>total+solLamports(row.maxDebitSol),0n).toString(),9),rows,...(source.observedBuyGuard?{observedBuyGuard:source.observedBuyGuard}:{})})
}
function identity(plan:BuyPlan):string {const {id:_id,name:_name,mint:_mint,createdAt:_created,updatedAt:_updated,...rest}=plan;void _id;void _name;void _mint;void _created;void _updated;return JSON.stringify(rest)}
/** Called only when the user continues from the explicit staged option. No keys or execution state are copied. */
export function saveStagedLaunchPlan(input:LaunchBundleSettings,fees:Fees,storage:BuyPlanStorage=localStorage):LaunchBundleSettings{
 const settings=parseLaunchBundleSettings(input)
 if(!settings.deferBuys)return settings
 assertNoPendingBuyPlan(storage)
 const existing=readBuyPlan(storage),same=!!existing&&existing.id===settings.stagedPlanId&&existing.mint===undefined
 const candidate=design(settings,fees,same?existing.id:crypto.randomUUID())
 if(same&&identity(existing)===identity(candidate))return {...settings,stagedPlanId:existing.id}
 if(same&&!readBuyPlanJournals(storage).some(run=>run.planId===existing.id&&run.rows.some(row=>row.signature)))candidate.id=existing.id
 const saved=saveBuyPlan(candidate,storage,storage.getItem(BUY_PLAN_KEY))
 return {...settings,stagedPlanId:saved.id}
}
export function assertStagedLaunchPlan(settings:LaunchBundleSettings,fees:Fees,storage:BuyPlanStorage=localStorage):BuyPlan|undefined{
 if(!settings.deferBuys)return undefined
 const saved=readBuyPlan(storage)
 if(!settings.stagedPlanId||!saved||saved.id!==settings.stagedPlanId)throw new Error('The matching staged plan is missing. Return to launch settings and save the preparation.')
 if(identity(saved)!==identity(design(settings,fees,saved.id)))throw new Error('Staged buy settings changed. Return to launch settings to review and save the matching preparation.')
 return saved
}
/** Confirmation can bind only this exact saved preparation, never a different earlier plan. */
export function attachStagedLaunchMint(settings:LaunchBundleSettings,fees:Fees,mint:string,storage:BuyPlanStorage=localStorage):BuyPlan|undefined {
 const plan=assertStagedLaunchPlan(settings,fees,storage)
 if(!plan)return undefined
 const address=buyPlanAddress(mint)
 if(plan.mint&&plan.mint!==address)throw new Error('This staged plan already belongs to a different mint. Its original binding was preserved.')
 if(plan.mint===address)return plan
 return saveBuyPlan({...plan,mint:address,updatedAt:Date.now()},storage,storage.getItem(BUY_PLAN_KEY))
}
