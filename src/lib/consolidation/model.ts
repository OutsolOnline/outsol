import {normalizedRelayInput} from '../relay/prepare'
import {relayAddress,relayRaw} from '../relay/scan'
import {canonicalSignature} from '../market/validation'
import type {RelayReceipt,RelayTransferInput} from '../relay/types'
import type {WalletOperationStorage} from '../walletOperations/history'

export const CONSOLIDATION_KEY='outsol-consolidation-journals-v1'
export interface ConsolidationRow {walletId:string;input:RelayTransferInput;status:'planned'|'executing'|'submitted'|'confirmed'|'failed'|'unknown'|'skipped';signature?:string}
export interface ConsolidationJournal {version:1;id:string;mint:string;receiver:{walletId:string;address:string};group:{id:string;memberIds:string[]}|null;rows:ConsolidationRow[];createdAt:number;updatedAt:number;revision:number;closed:boolean;sale:{attempted:boolean;status:'none'|'reviewed'|'running'|'confirmed'|'failed'|'unknown';batchId?:string;signature?:string}}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Invalid consolidation journal.');return value as Record<string,unknown>}
const exact=(value:Record<string,unknown>,keys:string[])=>{if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Only public consolidation fields are allowed.')}
const id=(value:unknown):string=>{if(typeof value!=='string'||!value||value.length>100||/[\u0000-\u001f\u007f]/.test(value))throw new Error('A controlled wallet identity is invalid.');return value}
export function parseConsolidation(value:unknown):ConsolidationJournal{
 const row=object(value);exact(row,['version','id','mint','receiver','group','rows','createdAt','updatedAt','revision','closed','sale'])
 if(row.version!==1||typeof row.id!=='string'||!UUID.test(row.id)||!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<0||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt)||!Number.isSafeInteger(row.revision)||Number(row.revision)<0||typeof row.closed!=='boolean')throw new Error('Invalid consolidation version or revision.')
 const receiver=object(row.receiver);exact(receiver,['walletId','address']);const destination={walletId:id(receiver.walletId),address:relayAddress(receiver.address as string,true)},mint=relayAddress(row.mint as string)
 let group:ConsolidationJournal['group']=null
 if(row.group!==null){const input=object(row.group);exact(input,['id','memberIds']);if(!Array.isArray(input.memberIds)||input.memberIds.length>100)throw new Error('Invalid group snapshot.');const memberIds=input.memberIds.map(id);if(new Set(memberIds).size!==memberIds.length)throw new Error('Duplicate group members.');group={id:id(input.id),memberIds}}
 if(!Array.isArray(row.rows)||!row.rows.length||row.rows.length>16)throw new Error('Choose one to sixteen source token accounts.')
 const rows:ConsolidationRow[]=row.rows.map(value=>{
  const item=object(value);exact(item,['walletId','input','status','signature']);const raw=object(item.input);exact(raw,['source','destination','mint','sourceAccount','tokenProgram','amountRaw','decimals','priorityFeeLamports']);const input=normalizedRelayInput(raw as unknown as RelayTransferInput)
  const walletId=id(item.walletId)
  if(input.mint!==mint||input.destination!==destination.address||walletId===destination.walletId||!['planned','executing','submitted','confirmed','failed','unknown','skipped'].includes(String(item.status))||item.signature!==undefined&&!canonicalSignature(item.signature)||['submitted','confirmed'].includes(String(item.status))&&!item.signature||group&&!group.memberIds.includes(walletId))throw new Error('Transfer scope or original signature is invalid.')
  return {walletId,input,status:item.status as ConsolidationRow['status'],...(item.signature?{signature:item.signature as string}:{})}
 })
 if(new Set(rows.map(value=>value.input.sourceAccount)).size!==rows.length||new Set(rows.map(value=>value.signature).filter(Boolean)).size!==rows.filter(value=>value.signature).length||rows.some(value=>value.input.decimals!==rows[0].input.decimals||value.input.tokenProgram!==rows[0].input.tokenProgram))throw new Error('Duplicate accounts or mismatched token programs.')
 relayRaw(rows.reduce((sum,value)=>sum+BigInt(value.input.amountRaw),0n).toString())
 const sale=object(row.sale);exact(sale,['attempted','status','batchId','signature'])
 if(typeof sale.attempted!=='boolean'||!['none','reviewed','running','confirmed','failed','unknown'].includes(String(sale.status))||sale.batchId!==undefined&&(typeof sale.batchId!=='string'||!UUID.test(sale.batchId))||sale.signature!==undefined&&!canonicalSignature(sale.signature)||sale.status==='confirmed'&&(!sale.attempted||!sale.signature)||sale.attempted&&!row.closed)throw new Error('Invalid sale recovery state.')
 return {version:1,id:row.id,mint,receiver:destination,group,rows,createdAt:Number(row.createdAt),updatedAt:Number(row.updatedAt),revision:Number(row.revision),closed:row.closed,sale:{attempted:sale.attempted,status:sale.status as ConsolidationJournal['sale']['status'],...(sale.batchId?{batchId:sale.batchId as string}:{}),...(sale.signature?{signature:sale.signature as string}:{})}}
}
export function createConsolidation(input:{mint:string;receiver:ConsolidationJournal['receiver'];group:ConsolidationJournal['group'];rows:Pick<ConsolidationRow,'walletId'|'input'>[]}):ConsolidationJournal{
 const now=Date.now();return parseConsolidation({version:1,id:crypto.randomUUID(),mint:input.mint,receiver:input.receiver,group:input.group,rows:input.rows.map(row=>({...row,status:'planned'})),createdAt:now,updatedAt:now,revision:0,closed:false,sale:{attempted:false,status:'none'}})
}
export function readConsolidations(storage:WalletOperationStorage=localStorage):ConsolidationJournal[]{
 const raw=storage.getItem(CONSOLIDATION_KEY);if(raw===null)return[]
 try{if(raw.length>500000)throw new Error();const input=JSON.parse(raw);if(!Array.isArray(input)||input.length>20)throw new Error();const rows=input.map(parseConsolidation);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error();const signatures=rows.flatMap(row=>[...row.rows.map(value=>value.signature),row.sale.signature].filter(Boolean));if(new Set(signatures).size!==signatures.length)throw new Error();return rows}catch{throw new Error('Consolidation recovery cannot be read. Preserve browser data and original signatures before spending.')}
}
const identity=(row:ConsolidationJournal)=>JSON.stringify({id:row.id,mint:row.mint,receiver:row.receiver,group:row.group,rows:row.rows.map(value=>({walletId:value.walletId,input:value.input})),createdAt:row.createdAt})
export function saveConsolidation(value:ConsolidationJournal,expected:ConsolidationJournal|undefined,storage:WalletOperationStorage=localStorage):ConsolidationJournal{
 const next=parseConsolidation(value),all=readConsolidations(storage),prior=all.find(row=>row.id===next.id)
 if(expected){
  if(!prior||JSON.stringify(prior)!==JSON.stringify(expected)||identity(prior)!==identity(next)||next.revision!==prior.revision+1||prior.closed&&!next.closed||prior.sale.attempted&&!next.sale.attempted||prior.sale.status==='confirmed'&&next.sale.status!=='confirmed'||prior.sale.signature&&prior.sale.signature!==next.sale.signature||prior.rows.some((row,index)=>row.signature&&row.signature!==next.rows[index].signature||row.status==='confirmed'&&next.rows[index].status!=='confirmed'||row.status!=='planned'&&next.rows[index].status==='planned'))throw new Error('The consolidation journal changed. Reload original receipts before continuing.')
 }else if(prior||next.revision!==0||next.closed||next.sale.status!=='none'||next.sale.attempted||next.rows.some(row=>row.status!=='planned'||row.signature))throw new Error('Only a fresh unexecuted consolidation plan can be added.')
 if(!prior&&all.length>=20)throw new Error('Consolidation history is full. Preserve its public journal before continuing.')
 const result=[next,...all.filter(row=>row.id!==next.id)],signatures=result.flatMap(row=>[...row.rows.map(value=>value.signature),row.sale.signature].filter(Boolean));if(new Set(signatures).size!==signatures.length)throw new Error('An original signature cannot be claimed by another consolidation journal.');const raw=JSON.stringify(result);storage.setItem(CONSOLIDATION_KEY,raw);if(storage.getItem(CONSOLIDATION_KEY)!==raw)throw new Error('The consolidation checkpoint could not be saved. Nothing further may be sent.');return structuredClone(next)
}
export function matchingTransfer(row:ConsolidationRow,receipt:RelayReceipt):boolean{return row.signature===receipt.signature&&['source','destination','mint','sourceAccount','tokenProgram','amountRaw','decimals'].every(key=>row.input[key as keyof RelayTransferInput]===receipt[key as keyof RelayTransferInput])}
export function confirmedTransferTotal(journal:ConsolidationJournal,receipts:RelayReceipt[]):string{
 const safe=parseConsolidation(journal)
 if(safe.rows.some(row=>['executing','submitted','unknown'].includes(row.status)))throw new Error('An original transfer needs confirmation before any sale review.')
 let total=0n
 for(const row of safe.rows)if(row.status==='confirmed'){const root=receipts.find(value=>matchingTransfer(row,value));if(!root||root.status!=='confirmed'||!Number.isFinite(Date.parse(root.createdAt))||Date.parse(root.createdAt)<safe.createdAt)throw new Error('A matching confirmed root transfer receipt from this journal is missing.');total+=BigInt(row.input.amountRaw)}
 if(!total)throw new Error('No confirmed journal transfers are available to sell.');return relayRaw(total.toString()).toString()
}
