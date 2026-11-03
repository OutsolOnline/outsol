import type {BuyPlan,BuyPlanRow} from './model'

/** One resolved scope for the visible step, unlock controls and review request. */
export function resolveBuyPlanSelection(plan:Pick<BuyPlan,'mode'|'order'|'rows'>|null,completed:ReadonlySet<string>,requestedStepId:string,unlockedIds:readonly string[]):{remaining:BuyPlanRow[];selectedStepId:string;selectedRows:BuyPlanRow[];reviewRowIds:string[];lockedRows:BuyPlanRow[]}{
 const ordered=plan?.order==='reverse'?[...plan.rows].reverse():plan?.rows??[]
 const remaining=ordered.filter(row=>!completed.has(row.id))
 const selectedStepId=remaining.some(row=>row.id===requestedStepId)?requestedStepId:remaining[0]?.id??''
 const selectedRows=plan?.mode==='staged'?remaining.filter(row=>row.id===selectedStepId):remaining
 const unlocked=new Set(unlockedIds)
 return {remaining,selectedStepId,selectedRows,reviewRowIds:selectedRows.map(row=>row.id),lockedRows:selectedRows.filter(row=>!unlocked.has(row.walletId))}
}
