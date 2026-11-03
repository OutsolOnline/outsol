import {Connection,PublicKey,type VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync} from '@solana/spl-token'
import {prepareRelayTransfer} from '../relay/prepare'
import {executeRelayTransfer} from '../relay/execute'
import {readRelayReceipts,reconcileRelayReceipt} from '../relay/history'
import type {PreparedRelayTransfer,RelayReceipt,RelayExecutionOptions,RelayTransferInput} from '../relay/types'
import {prepareSaleBatch,executeSaleBatch,type SaleBatchOptions,type SaleBatchSigner} from '../sales/batch'
import {readSaleHistory,reconcileSaleHistory,type SaleBatchRecord,type SaleRequest} from '../sales/history'
import {readTradePending} from '../venues/tradeHistory'
import {reconcilePendingTrade} from '../venues/tradeRecovery'
import {decodeConfirmedBalanceChanges} from '../accounting/fills'
import {withTimeout} from '../transactions/http'
import {readConsolidations,saveConsolidation,matchingTransfer,confirmedTransferTotal,type ConsolidationJournal} from './model'
import type {WalletOperationStorage} from '../walletOperations/history'

export interface ConsolidationControls {readWallet(id:string):string|null|undefined;readGroup(id:string):string[]|null|undefined;readSigner(id:string):string|null|undefined;sign(id:string,tx:VersionedTransaction):Promise<VersionedTransaction>;signal?:AbortSignal}
export interface ConsolidationPorts {
 storage:WalletOperationStorage;now():number
 prepareTransfer(connection:Connection,input:RelayTransferInput):Promise<PreparedRelayTransfer>
 executeTransfer(connection:Connection,prepared:PreparedRelayTransfer,options:RelayExecutionOptions):Promise<RelayReceipt>
 relayReceipts():RelayReceipt[];verifyTransfer(connection:Connection,receipt:RelayReceipt):Promise<void>
 prepareSale(connection:Connection,requests:SaleRequest[],options:SaleBatchOptions):Promise<SaleBatchRecord>
 executeSale(connection:Connection,review:SaleBatchRecord,signer:SaleBatchSigner):Promise<SaleBatchRecord>
 saleHistory():SaleBatchRecord[];reconcile(connection:Connection,journal:ConsolidationJournal):Promise<void>
}
function ports(overrides:Partial<ConsolidationPorts>):ConsolidationPorts{
 const storage=overrides.storage??localStorage
 return {storage,now:Date.now,prepareTransfer:prepareRelayTransfer,executeTransfer:executeRelayTransfer,relayReceipts:()=>readRelayReceipts(storage),verifyTransfer:verifyConfirmedConsolidationTransfer,
  prepareSale:(c,r,o)=>prepareSaleBatch(c,r,o,{storage}),executeSale:(c,r,s)=>executeSaleBatch(c,r,s,{storage}),saleHistory:()=>readSaleHistory(storage),
  reconcile:async(connection,journal)=>{
   const locks=typeof navigator!=='undefined'?navigator.locks:undefined;if(!locks)throw new Error('Use a browser with secure cross-tab transaction coordination.')
   await locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Another tab is signing or checking a transaction.');for(const row of journal.rows){if(!row.signature||!['submitted','unknown'].includes(row.status))continue;const root=readRelayReceipts(storage).find(value=>matchingTransfer(row,value));if(!root)throw new Error('The original Relay receipt is missing.');await reconcileRelayReceipt(connection,root,storage)}})
   if(journal.sale.signature){const pending=readTradePending(storage);if(pending&&pending.signature!==journal.sale.signature)throw new Error('Another trade is pending; check its original signature first.');if(pending)await reconcilePendingTrade(connection,{storage,expectedSignature:journal.sale.signature});reconcileSaleHistory(storage)}
  },...overrides}
}
const current=(id:string,p:ConsolidationPorts)=>{const value=readConsolidations(p.storage).find(row=>row.id===id);if(!value)throw new Error('The original consolidation journal is missing.');return value}
function controlled(journal:ConsolidationJournal,controls:ConsolidationControls){
 if(controls.signal?.aborted)throw new Error('Stopped. Submitted transactions remain in their original receipts.')
 if(controls.readWallet(journal.receiver.walletId)!==journal.receiver.address||journal.rows.some(row=>controls.readWallet(row.walletId)!==row.input.source))throw new Error('A source or receiver wallet identity changed. Nothing further may be sent.')
 if(journal.group){const members=controls.readGroup(journal.group.id);if(!members||JSON.stringify([...members].sort())!==JSON.stringify([...journal.group.memberIds].sort()))throw new Error('The source group changed. Preserve this journal and review the live wallets.')}
}
function session(id:string,controls:ConsolidationControls,p:ConsolidationPorts){
 let journal=current(id,p)
 const check=()=>{controlled(journal,controls);if(JSON.stringify(current(id,p))!==JSON.stringify(journal))throw new Error('The journal changed in another tab. Reload its original signatures.')}
 const update=(mutate:(value:ConsolidationJournal)=>void)=>{check();const next=structuredClone(journal);mutate(next);next.revision++;next.updatedAt=Math.max(Date.now(),next.updatedAt);journal=saveConsolidation(next,journal,p.storage);return journal}
 return {check,update,get journal(){return journal}}
}
export async function verifyConfirmedConsolidationTransfer(connection:Connection,receipt:RelayReceipt):Promise<void>{
 const tx=await withTimeout(connection.getTransaction(receipt.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}))
 const message=tx?.transaction.message as unknown as {staticAccountKeys?:PublicKey[];accountKeys?:PublicKey[]}|undefined
 const keys=(message?.staticAccountKeys??message?.accountKeys??[]).map(key=>key.toBase58()),loaded=tx?.meta?.loadedAddresses
 const normalized=tx?{...tx,transaction:{...tx.transaction,message:{accountKeys:keys}},meta:{...tx.meta,loadedAddresses:{writable:loaded?.writable.map(key=>key.toBase58())??[],readonly:loaded?.readonly.map(key=>key.toBase58())??[]}}}:null
 const changes=decodeConfirmedBalanceChanges(normalized,receipt.signature,receipt.mint,[]),amount=BigInt(receipt.amountRaw)
 if(receipt.status!=='confirmed'||!changes.some(row=>row.wallet===receipt.source&&row.tokenDeltaRaw===(-amount).toString())||!changes.some(row=>row.wallet===receipt.destination&&row.tokenDeltaRaw===amount.toString()))throw new Error('The exact finalized source and receiver token deltas could not be verified. Transfers remain in the receiver; no sale was prepared.')
 const allKeys=[...keys,...(loaded?.writable.map(key=>key.toBase58())??[]),...(loaded?.readonly.map(key=>key.toBase58())??[])],destination=getAssociatedTokenAddressSync(new PublicKey(receipt.mint),new PublicKey(receipt.destination),false,new PublicKey(receipt.tokenProgram)).toBase58()
 const delta=(account:string,owner:string)=>{
  const index=allKeys.indexOf(account);if(index<0)throw new Error('The specific transfer account is absent from its original transaction.')
  const before=tx!.meta!.preTokenBalances?.find(row=>row.accountIndex===index),after=tx!.meta!.postTokenBalances?.find(row=>row.accountIndex===index)
  for(const row of [before,after])if(row&&(row.owner!==owner||row.mint!==receipt.mint))throw new Error('An original transfer account has a different owner or mint.')
  return BigInt(after?.uiTokenAmount.amount??'0')-BigInt(before?.uiTokenAmount.amount??'0')
 }
 if(delta(receipt.sourceAccount,receipt.source)!==-amount||delta(destination,receipt.destination)!==amount)throw new Error('The exact source and receiver accounts do not match the journal transfer.')
}
export interface ConsolidationTransferReview {journalId:string;totalRaw:string;createdAt:number;transfers:PreparedRelayTransfer[]}
const transferPlans=new WeakMap<ConsolidationTransferReview,{snapshot:string;journal:ConsolidationJournal;used:boolean}>()
export async function prepareConsolidationTransfers(connection:Connection,id:string,controls:ConsolidationControls,overrides:Partial<ConsolidationPorts>={}):Promise<ConsolidationTransferReview>{
 const p=ports(overrides),s=session(id,controls,p);s.check()
 if(s.journal.closed||s.journal.sale.attempted||s.journal.rows.some(row=>['executing','submitted','unknown'].includes(row.status)))throw new Error('This journal has closed or uncertain transfers. Check original signatures; nothing will resume automatically.')
 const transfers:PreparedRelayTransfer[]=[]
 for(const row of s.journal.rows.filter(row=>row.status==='planned')){const prepared=await p.prepareTransfer(connection,row.input);s.check();if(JSON.stringify(prepared.input)!==JSON.stringify(row.input))throw new Error('The prepared transfer changed its exact journal scope.');transfers.push(prepared)}
 if(!transfers.length)throw new Error('No unattempted transfers remain in this journal.')
 const result={journalId:id,totalRaw:transfers.reduce((sum,row)=>sum+BigInt(row.input.amountRaw),0n).toString(),createdAt:p.now(),transfers};transferPlans.set(result,{snapshot:JSON.stringify(result),journal:s.journal,used:false});return result
}
export async function executeConsolidationTransfers(connection:Connection,review:ConsolidationTransferReview,controls:ConsolidationControls,overrides:Partial<ConsolidationPorts>={}):Promise<ConsolidationJournal>{
 const p=ports(overrides),internal=transferPlans.get(review),s=session(review.journalId,controls,p)
 if(!internal||internal.used||internal.snapshot!==JSON.stringify(review)||JSON.stringify(internal.journal)!==JSON.stringify(s.journal)||p.now()<review.createdAt||p.now()-review.createdAt>60000)throw new Error('The transfer review changed, expired or was already used. Prepare a fresh explicit review.')
 s.check();internal.used=true
 for(const original of review.transfers){
  const index=s.journal.rows.findIndex(row=>row.input.sourceAccount===original.input.sourceAccount),row=s.journal.rows[index];s.check()
  if(row.status!=='planned')throw new Error('This source transfer has already been attempted. It will not be sent again.')
  const fresh=await p.prepareTransfer(connection,row.input);s.check()
  if(JSON.stringify(fresh.input)!==JSON.stringify(original.input)||BigInt(fresh.preview.maxDebitLamports)>BigInt(original.preview.maxDebitLamports))throw new Error('A transfer cost or amount exceeds the reviewed ceiling. Prepare again.')
  s.update(value=>{value.rows[index].status='executing'})
  const checkpoint=(receipt:RelayReceipt)=>{
   const candidate={...s.journal.rows[index],signature:receipt.signature}
   if(!matchingTransfer(candidate,receipt)||!p.relayReceipts().some(root=>JSON.stringify(root)===JSON.stringify(receipt)))throw new Error('A matching original engine transfer receipt is required.')
   s.update(value=>{value.rows[index].signature=receipt.signature;value.rows[index].status=receipt.status})
  }
  try{
   const receipt=await p.executeTransfer(connection,fresh,{approved:true,readSigner:()=>controls.readSigner(row.walletId),sign:tx=>controls.sign(row.walletId,tx),assertAvailable:s.check,signal:controls.signal,storage:p.storage,onChange:checkpoint})
   checkpoint(receipt);if(receipt.status!=='confirmed')break
  }catch{
   // A lost callback cannot prove a packet was never sent. Keep this attempt
   // blocked until original engine history is inspected; never retry the row.
   s.update(value=>{if(value.rows[index].status!=='confirmed')value.rows[index].status='unknown'});break
  }
 }
 return structuredClone(s.journal)
}
export interface ConsolidationSaleReview {journalId:string;amountRaw:string;createdAt:number;sale:SaleBatchRecord}
const salePlans=new WeakMap<ConsolidationSaleReview,{snapshot:string;journal:ConsolidationJournal;used:boolean}>()
export async function prepareConsolidationSale(connection:Connection,id:string,controls:ConsolidationControls,options:SaleBatchOptions,overrides:Partial<ConsolidationPorts>={}):Promise<ConsolidationSaleReview>{
 const p=ports(overrides),s=session(id,controls,p);s.check();if(s.journal.sale.attempted)throw new Error('A sale was already attempted from this journal. Check its original signature; no sale will be repeated.')
 const roots=p.relayReceipts(),amountRaw=confirmedTransferTotal(s.journal,roots)
 for(const row of s.journal.rows.filter(row=>row.status==='confirmed')){await p.verifyTransfer(connection,roots.find(root=>matchingTransfer(row,root))!);s.check()}
 s.update(value=>{value.closed=true;value.rows.forEach(row=>{if(row.status==='planned')row.status='skipped'})})
 const row=s.journal.rows[0],request:SaleRequest={walletId:s.journal.receiver.walletId,walletName:'Consolidation receiver',payer:s.journal.receiver.address,mint:s.journal.mint,amountRaw,decimals:row.input.decimals,tokenProgram:row.input.tokenProgram}
 const sale=await p.prepareSale(connection,[request],options);s.check()
 if(sale.rows.length!==1||sale.rows[0].payer!==request.payer||sale.rows[0].amountRaw!==amountRaw||sale.rows[0].mint!==request.mint||sale.rows[0].status!=='ready')throw new Error(sale.rows[0]?.error??'A sale route is unavailable. Transfers remain in the receiver; retry only a fresh sale review.')
 s.update(value=>{value.sale={attempted:false,status:'reviewed',batchId:sale.id}})
 const review={journalId:id,amountRaw,createdAt:p.now(),sale};salePlans.set(review,{snapshot:JSON.stringify(review),journal:s.journal,used:false});return review
}
export async function executeConsolidationSale(connection:Connection,review:ConsolidationSaleReview,controls:ConsolidationControls,overrides:Partial<ConsolidationPorts>={}):Promise<ConsolidationJournal>{
 const p=ports(overrides),s=session(review.journalId,controls,p),internal=salePlans.get(review)
 if(!internal||internal.used||internal.snapshot!==JSON.stringify(review)||JSON.stringify(internal.journal)!==JSON.stringify(s.journal)||s.journal.sale.attempted||p.now()<review.createdAt||p.now()-review.createdAt>60000)throw new Error('This sale review changed, expired or was already used. No sale will be repeated.')
 s.check();if(confirmedTransferTotal(s.journal,p.relayReceipts())!==review.amountRaw)throw new Error('The exact confirmed transfer amount changed.')
 internal.used=true;s.update(value=>{value.sale.attempted=true;value.sale.status='running'})
 const checkpoint=(batch:SaleBatchRecord)=>{
  const row=batch.rows[0],root=p.saleHistory().find(value=>value.id===batch.id)
  if(batch.id!==review.sale.id||batch.rows.length!==1||row.payer!==s.journal.receiver.address||row.mint!==s.journal.mint||row.amountRaw!==review.amountRaw||!root||JSON.stringify(root)!==JSON.stringify(batch))throw new Error('The original receiver sale receipt does not match the journal.')
  s.update(value=>{value.sale.status=row.status==='confirmed'?'confirmed':row.status==='failed'?'failed':row.status==='unknown'?'unknown':'running';if(row.signature)value.sale.signature=row.signature})
 }
 try{const result=await p.executeSale(connection,review.sale,{approved:true,readSigner:walletId=>controls.readSigner(walletId),sign:controls.sign,signal:controls.signal,assertAvailable:s.check,onChange:checkpoint});checkpoint(result)}
 catch{s.update(value=>{if(value.sale.status!=='confirmed')value.sale.status='unknown'})}
 return structuredClone(s.journal)
}
/** Explicit read-only recovery. No preparation, resend or automatic continuation. */
export async function reconcileConsolidation(connection:Connection,id:string,controls:ConsolidationControls,overrides:Partial<ConsolidationPorts>={}):Promise<ConsolidationJournal>{
 const p=ports(overrides),s=session(id,controls,p);s.check();await p.reconcile(connection,s.journal);s.check()
 const roots=p.relayReceipts(),sales=p.saleHistory()
 return s.update(value=>{
  for(const row of value.rows)if(row.signature){const root=roots.find(receipt=>matchingTransfer(row,receipt));if(!root)throw new Error('The original transfer receipt is missing.');row.status=root.status}
  if(value.sale.batchId){const batch=sales.find(row=>row.id===value.sale.batchId),row=batch?.rows[0];if(row&&batch!.rows.length===1&&row.payer===value.receiver.address&&row.mint===value.mint&&row.signature===value.sale.signature&&row.amountRaw===confirmedTransferTotal(value,roots))value.sale.status=row.status==='confirmed'?'confirmed':row.status==='failed'?'failed':'unknown'}
 })
}
