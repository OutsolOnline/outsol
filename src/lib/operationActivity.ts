import bs58 from 'bs58'
import {readRelayReceipts} from './relay/history'
import {readSaleHistory} from './sales/history'
import {readSessionHistory} from './tradingSessions/history'
import {readBatchJournal} from './multiLaunch/history'
import {readCreatorOperationHistory,readPendingCreatorOperation} from './creatorOperations/history'
import {readBuyPlanJournals} from './buyPlans/history'
import {readSupplyLockHistory,readPendingSupplyLock} from './supplyLocks/history'
import {readStrategyQueues} from './tradingSessions/queueHistory'
import {readConsolidations} from './consolidation/model'
import type {WorkspaceActivityItem,WorkspaceActivitySnapshot} from './workspaceActivity'

/** Dedicated journals are read only through their public validators. */
export function readOperationActivity(source:{getItem(key:string):string|null}):WorkspaceActivitySnapshot{
 const items:WorkspaceActivityItem[]=[],warnings:string[]=[]
 const storage={getItem:(key:string)=>source.getItem(key),setItem:()=>{throw new Error('Activity is read-only.')},removeItem:()=>{throw new Error('Activity is read-only.')}}
 const checkedSignature=(value:string)=>{if(typeof value!=='string'||value.length>88||bs58.decode(value).length!==64)throw new Error('Invalid original signature.');return value}
 const read=(label:string,project:()=>void)=>{try{project()}catch{warnings.push(`${label} activity could not be read. Preserve browser data and review the original workspace before sending again.`)}}
 read('Relay',()=>{for(const row of readRelayReceipts(storage))items.push({id:`relay:${row.signature}`,kind:'relay',status:row.status==='submitted'||row.status==='unknown'?'pending':row.status,mint:row.mint,venue:'solana',timestamp:row.resolvedAt??row.createdAt,signatures:[checkedSignature(row.signature)],description:`Token transfer to receiver ${row.status==='submitted'||row.status==='unknown'?'awaiting confirmation':row.status}.`,recoveryHref:'/relay'})})
 read('Receiver sales',()=>{for(const batch of readSaleHistory(storage))for(const row of batch.rows){
  if(!row.signature||!['sending','unknown','confirmed','failed'].includes(row.status))continue
  items.push({id:`sale:${row.signature}`,kind:'sale',status:row.status==='sending'||row.status==='unknown'?'pending':row.status as 'confirmed'|'failed',mint:row.mint,venue:row.route==='jupiter'?'solana':'pump',timestamp:new Date(batch.updatedAt).toISOString(),signatures:[checkedSignature(row.signature)],description:`Receiver token sale ${row.status==='sending'||row.status==='unknown'?'awaiting confirmation':row.status}.`,recoveryHref:'/bundler'})
 }})
 read('Trading session',()=>{for(const session of readSessionHistory(storage))for(const row of session.rows){
  if(row.signature&&['sending','unknown','confirmed','failed'].includes(row.status))items.push({id:`session:${row.signature}`,kind:'session',status:row.status==='sending'||row.status==='unknown'?'pending':row.status as 'confirmed'|'failed',mint:row.mint,venue:'pump',timestamp:new Date(row.createdAt).toISOString(),signatures:[checkedSignature(row.signature)],description:`Trading session ${row.action==='buy'?'purchase':'sale'} ${row.status==='sending'||row.status==='unknown'?'awaiting confirmation':row.status}.`,recoveryHref:'/automations'})
  if(row.relay?.signature&&['unknown','confirmed','failed'].includes(row.relay.status))items.push({id:`session-relay:${row.relay.signature}`,kind:'relay',status:row.relay.status==='unknown'?'pending':row.relay.status as 'confirmed'|'failed',mint:row.mint,venue:'solana',timestamp:new Date(row.createdAt).toISOString(),signatures:[checkedSignature(row.relay.signature)],description:`Trading session token forwarding ${row.relay.status==='unknown'?'awaiting confirmation':row.relay.status}.`,recoveryHref:'/automations'})
 }})
 read('Multi-launch',()=>{const batch=readBatchJournal(storage);if(!batch)return;for(const [index,row] of batch.rows.entries()){
  if(!row.signatures.length||!['sending','unknown','confirmed','failed'].includes(row.status))continue
  items.push({id:`multi-launch:${batch.id}:${index}`,kind:'launch',status:row.status==='sending'||row.status==='unknown'?'pending':row.status as 'confirmed'|'failed',mint:row.mint,venue:'pump',timestamp:batch.updatedAt,signatures:row.signatures.map(checkedSignature),description:`Multi-launch token ${row.status==='sending'||row.status==='unknown'?'awaiting confirmation':row.status}.`,recoveryHref:'/multi-launch'})
 }})
 read('Creator operation',()=>{
  const pending=readPendingCreatorOperation(storage),history=readCreatorOperationHistory(storage)
  const rows=[...history.map(row=>({...row,status:row.status as 'confirmed'|'failed'|'pending'})),...(pending?[{...pending,status:'pending' as const}]:[])]
  for(const row of rows){const kind=row.intent.input.kind,action=kind==='lookup'?'Creator account lookup setup':kind==='shares'?'Creator fee share update':kind==='distribute'?'Shared creator reward distribution':'Creator reward collection · wallet-wide';items.push({id:`creator:${row.signature}:${row.status}`,kind:'creator',status:row.status,mint:row.intent.input.mint,venue:'pump',timestamp:'resolvedAt' in row&&typeof row.resolvedAt==='string'?row.resolvedAt:row.submittedAt,signatures:[checkedSignature(row.signature)],description:`${action} ${row.status==='pending'?'awaiting confirmation':row.status}.`,recoveryHref:`/token/${row.intent.input.mint}?section=creator`})}
 })
 read('Wallet buy plan',()=>{for(const run of readBuyPlanJournals(storage))for(const row of run.rows){
  if(!row.signature||!['sending','unknown','confirmed','failed'].includes(row.status))continue
  const status=row.status==='sending'||row.status==='unknown'?'pending':row.status as 'confirmed'|'failed'
  items.push({id:`buy-plan:${row.signature}`,kind:'buy-plan',status,mint:run.mint,venue:'pump',timestamp:new Date(row.submittedAt??run.updatedAt).toISOString(),signatures:[checkedSignature(row.signature)],description:`Saved wallet-plan purchase ${status==='pending'?'awaiting confirmation':status}.`,recoveryHref:`/token/${run.mint}?section=buys`})
 }})
 read('Supply lock',()=>{
  const pending=readPendingSupplyLock(storage),rows=[...readSupplyLockHistory(storage),...(pending?[{...pending,status:'pending' as const}]:[])]
  for(const row of rows)items.push({id:`lock:${row.signature}:${row.status}`,kind:'lock',status:row.status,mint:row.intent.mint,venue:'solana',timestamp:'resolvedAt' in row?row.resolvedAt:row.submittedAt,signatures:[checkedSignature(row.signature)],description:`Streamflow token escrow ${row.status==='pending'?'awaiting confirmation':row.status}. This is not an LP lock.`,recoveryHref:`/token/${row.intent.mint}?section=supply`})
 })
 read('Strategy queue',()=>{for(const queue of readStrategyQueues(storage))for(const attempt of queue.attempts)for(const row of attempt.journal.rows){
  if(row.signature&&['sending','unknown','confirmed','failed'].includes(row.status))items.push({id:`queue:${row.signature}`,kind:'queue',status:row.status==='sending'||row.status==='unknown'?'pending':row.status as 'confirmed'|'failed',mint:row.mint,venue:'pump',timestamp:new Date(row.createdAt).toISOString(),signatures:[checkedSignature(row.signature)],description:`Queued strategy ${row.action==='buy'?'purchase':'sale'} ${row.status==='sending'||row.status==='unknown'?'awaiting confirmation':row.status}.`,recoveryHref:'/automations'})
  if(row.relay?.signature&&['preparing','unknown','confirmed','failed'].includes(row.relay.status))items.push({id:`queue-relay:${row.relay.signature}`,kind:'queue',status:row.relay.status==='preparing'||row.relay.status==='unknown'?'pending':row.relay.status as 'confirmed'|'failed',mint:row.mint,venue:'solana',timestamp:new Date(row.createdAt).toISOString(),signatures:[checkedSignature(row.relay.signature)],description:`Queued strategy token forwarding ${row.relay.status==='preparing'||row.relay.status==='unknown'?'awaiting confirmation':row.relay.status}.`,recoveryHref:'/automations'})
 }})
 read('Consolidation',()=>{for(const journal of readConsolidations(storage)){
  for(const row of journal.rows){if(!row.signature||!['executing','submitted','unknown','confirmed','failed'].includes(row.status))continue;const status=row.status==='confirmed'||row.status==='failed'?row.status:'pending';items.push({id:`consolidation:${row.signature}`,kind:'consolidation',status,mint:journal.mint,venue:'solana',timestamp:new Date(journal.updatedAt).toISOString(),signatures:[checkedSignature(row.signature)],description:`Consolidation transfer ${status==='pending'?'awaiting confirmation':status}.`,recoveryHref:`/token/${journal.mint}?section=supply`})}
  if(journal.sale.signature&&['running','unknown','confirmed','failed'].includes(journal.sale.status)){const status=journal.sale.status==='confirmed'||journal.sale.status==='failed'?journal.sale.status:'pending';items.push({id:`consolidation-sale:${journal.sale.signature}`,kind:'consolidation',status,mint:journal.mint,venue:'pump',timestamp:new Date(journal.updatedAt).toISOString(),signatures:[checkedSignature(journal.sale.signature)],description:`Consolidated receiver sale ${status==='pending'?'awaiting confirmation':status}.`,recoveryHref:`/token/${journal.mint}?section=supply`})}
 }})
 return {items,warnings}
}

/** One row per execution evidence. Dedicated context wins over mirrored receipts;
 * any unresolved source keeps the merged row pending until reconciled. */
export function mergeActivityEvidence(items:WorkspaceActivityItem[]):WorkspaceActivityItem[]{
 const priority=(item:WorkspaceActivityItem)=>item.kind==='consolidation'?5:item.kind==='queue'?4:item.recoveryHref?3:item.kind==='group'||item.kind==='bundle'?2:1
 const ordered=[...items].sort((a,b)=>priority(b)-priority(a)),result:WorkspaceActivityItem[]=[]
 for(const item of ordered){
  const cover=result.find(row=>row.mint===item.mint&&item.signatures.every(sig=>row.signatures.includes(sig)))
  if(cover){if(item.status==='pending')cover.status='pending';continue}
  result.push({...item,signatures:[...item.signatures]})
 }
 return result
}
