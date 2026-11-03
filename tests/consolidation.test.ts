import {describe,it,expect} from 'vitest'
import {Keypair,Connection,PublicKey} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token'
import bs58 from 'bs58'
import {createConsolidation,saveConsolidation,readConsolidations,parseConsolidation,confirmedTransferTotal} from '../src/lib/consolidation/model'
import {prepareConsolidationTransfers,executeConsolidationTransfers,prepareConsolidationSale,executeConsolidationSale,reconcileConsolidation,verifyConfirmedConsolidationTransfer,type ConsolidationPorts,type ConsolidationControls} from '../src/lib/consolidation/engine'
import type {RelayReceipt,PreparedRelayTransfer} from '../src/lib/relay/types'
import type {SaleBatchRecord} from '../src/lib/sales/history'
const memory=()=>{const map=new Map<string,string>();return {map,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value)},removeItem:(key:string)=>{map.delete(key)}}}
function harness(){
 const source=Keypair.generate().publicKey.toBase58(),receiver=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),account=Keypair.generate().publicKey.toBase58(),storage=memory()
 const journal=createConsolidation({mint,receiver:{walletId:'receiver',address:receiver},group:null,rows:[{walletId:'source',input:{source,destination:receiver,mint,sourceAccount:account,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),amountRaw:'100',decimals:6}}]})
 saveConsolidation(journal,undefined,storage)
 let identity=source,now=1000000,transferStatus:RelayReceipt['status']='confirmed',transferCalls=0,saleCalls=0,verified=true
 const roots:RelayReceipt[]=[],sales:SaleBatchRecord[]=[]
 const controls:ConsolidationControls={readWallet:id=>id==='source'?identity:receiver,readGroup:()=>[],readSigner:id=>id==='source'?identity:receiver,sign:async(_id,tx)=>tx}
 const ports:ConsolidationPorts={storage,now:()=>now,
  prepareTransfer:async(_c,input)=>({input,preview:{sourceBeforeLamports:'10000',sourceAfterLamports:'5000',networkFeeLamports:'5000',destinationRentLamports:'0',maxDebitLamports:'5000',sourceTokenBeforeRaw:'100',sourceTokenAfterRaw:'0',destinationBeforeRaw:'900',destinationAfterRaw:'1000'},createdAt:now,blockhash:account,lastValidBlockHeight:100}) as PreparedRelayTransfer,
  executeTransfer:async(_c,plan,options)=>{transferCalls++;options.assertAvailable?.();const receipt:RelayReceipt={...plan.input,signature:bs58.encode(new Uint8Array(64).fill(9)),blockhash:account,lastValidBlockHeight:100,genesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',createdAt:new Date().toISOString(),status:transferStatus,debitLamports:'5000'};roots.push(receipt);options.onChange?.(receipt);return receipt},
  relayReceipts:()=>roots,verifyTransfer:async()=>{if(!verified)throw new Error('No exact confirmed delta')},
  prepareSale:async(_c,requests)=>{expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({payer:receiver,amountRaw:'100'});return {version:1,id:crypto.randomUUID(),createdAt:now,updatedAt:now,status:'ready',rows:requests.map(row=>({...row,status:'ready',minimumSolOut:'50',maxDebitLamports:'5000'}))}},
  executeSale:async(_c,review,signer)=>{saleCalls++;signer.assertAvailable?.();const result={...review,status:'completed' as const,rows:review.rows.map(row=>({...row,status:'confirmed' as const,signature:bs58.encode(new Uint8Array(64).fill(10))}))};sales.push(result);signer.onChange?.(result);return result},saleHistory:()=>sales,
  reconcile:async()=>{},
 }
 return {journal,storage,controls,ports,connection:{} as Connection,roots,sales,get transferCalls(){return transferCalls},get saleCalls(){return saleCalls},setIdentity:(value:string)=>{identity=value},setNow:(value:number)=>{now=value},setStatus:(value:RelayReceipt['status'])=>{transferStatus=value},setVerified:(value:boolean)=>{verified=value}}
}
describe('guided consolidation journal and phase guards',()=>{
 it('sells only exact confirmed journal transfers and excludes pre-existing receiver holdings',async()=>{
  const h=harness(),transferReview=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports)
  await executeConsolidationTransfers(h.connection,transferReview,h.controls,h.ports)
  const saleReview=await prepareConsolidationSale(h.connection,h.journal.id,h.controls,{slippageBps:500,priorityFeeLamports:'0'},h.ports)
  expect(saleReview.sale.rows[0].amountRaw).toBe('100')
  await executeConsolidationSale(h.connection,saleReview,h.controls,h.ports)
  expect(readConsolidations(h.storage)[0].sale.status).toBe('confirmed');expect(h.transferCalls).toBe(1);expect(h.saleCalls).toBe(1)
  await expect(executeConsolidationSale(h.connection,saleReview,h.controls,h.ports)).rejects.toThrow()
  await expect(prepareConsolidationSale(h.connection,h.journal.id,h.controls,{slippageBps:500,priorityFeeLamports:'0'},h.ports)).rejects.toThrow()
 })
 it('does not equate a forged confirmed journal flag with a matching original transfer receipt',()=>{
  const h=harness(),forged={...h.journal,rows:h.journal.rows.map(row=>({...row,status:'confirmed' as const,signature:bs58.encode(new Uint8Array(64).fill(1))}))}
  expect(()=>confirmedTransferTotal(forged,[])).toThrow();expect(()=>saveConsolidation(forged,undefined,memory())).toThrow()
 })
 it('stops after an unknown original transfer and never resumes or resubmits it after refresh',async()=>{
  const h=harness();h.setStatus('unknown');const review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports)
  await executeConsolidationTransfers(h.connection,review,h.controls,h.ports)
  expect(readConsolidations(h.storage)[0].rows[0].status).toBe('unknown')
  await expect(prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports)).rejects.toThrow()
  await expect(prepareConsolidationSale(h.connection,h.journal.id,h.controls,{slippageBps:500,priorityFeeLamports:'0'},h.ports)).rejects.toThrow()
  expect(h.transferCalls).toBe(1);expect(h.saleCalls).toBe(0)
 })
 it.each(['stale','identity','mutated','copied'])('rejects %s transfer reviews without calling the executor',async kind=>{
  const h=harness(),review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports)
  if(kind==='stale')h.setNow(1060001)
  if(kind==='identity')h.setIdentity(Keypair.generate().publicKey.toBase58())
  if(kind==='mutated')review.totalRaw='200'
  await expect(executeConsolidationTransfers(h.connection,kind==='copied'?structuredClone(review):review,h.controls,h.ports)).rejects.toThrow()
  expect(h.transferCalls).toBe(0)
 })
 it('refuses sale preparation if confirmed on-chain deltas cannot establish the transferred amount',async()=>{
  const h=harness(),review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports);await executeConsolidationTransfers(h.connection,review,h.controls,h.ports);h.setVerified(false)
  await expect(prepareConsolidationSale(h.connection,h.journal.id,h.controls,{slippageBps:500,priorityFeeLamports:'0'},h.ports)).rejects.toThrow()
  expect(h.saleCalls).toBe(0)
 })
 it('rejects malformed or secret-bearing public journals and preserves corrupt storage',()=>{
  const h=harness();expect(()=>parseConsolidation({...h.journal,secretKey:''})).toThrow()
  expect(()=>parseConsolidation({...h.journal,receiver:{...h.journal.receiver,address:h.journal.rows[0].input.source}})).toThrow()
  h.storage.setItem('outsol-consolidation-journals-v1','{corrupt');expect(()=>saveConsolidation(h.journal,undefined,h.storage)).toThrow();expect(h.storage.getItem('outsol-consolidation-journals-v1')).toBe('{corrupt')
 })
 it('reconciles only an original unknown signature without preparing or sending another transfer',async()=>{
  const h=harness();h.setStatus('unknown');const review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports);await executeConsolidationTransfers(h.connection,review,h.controls,h.ports)
  const original=h.roots[0].signature;h.ports.reconcile=async()=>{h.roots[0].status='confirmed'}
  const checked=await reconcileConsolidation(h.connection,h.journal.id,h.controls,h.ports)
  expect(checked.rows[0]).toMatchObject({status:'confirmed',signature:original});expect(h.transferCalls).toBe(1)
  await expect(prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports)).rejects.toThrow()
 })
 it('cancellation before a reviewed phase never calls the transfer engine',async()=>{
  const h=harness(),review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports),controller=new AbortController();controller.abort();h.controls.signal=controller.signal
  await expect(executeConsolidationTransfers(h.connection,review,h.controls,h.ports)).rejects.toThrow(/stopped/i);expect(h.transferCalls).toBe(0)
 })
 it('uses actual web3 versioned message keys and proves the specific source and receiver token accounts',async()=>{
  const h=harness(),review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports);await executeConsolidationTransfers(h.connection,review,h.controls,h.ports)
  const root=h.roots[0],destination=getAssociatedTokenAddressSync(new PublicKey(root.mint),new PublicKey(root.destination),false,TOKEN_PROGRAM_ID)
  const token=(accountIndex:number,owner:string,amount:string)=>({accountIndex,owner,mint:root.mint,uiTokenAmount:{amount,decimals:6}})
  const tx={slot:100,blockTime:Math.floor(Date.now()/1000),transaction:{signatures:[root.signature],message:{staticAccountKeys:[new PublicKey(root.source),new PublicKey(root.destination),new PublicKey(root.sourceAccount),destination]}},meta:{err:null,fee:5000,preBalances:[10000,0,2039280,2039280],postBalances:[5000,0,2039280,2039280],preTokenBalances:[token(2,root.source,'100'),token(3,root.destination,'900')],postTokenBalances:[token(2,root.source,'0'),token(3,root.destination,'1000')]}}
  const connection={getTransaction:async(_sig:string,options:unknown)=>{expect(options).toEqual({commitment:'finalized',maxSupportedTransactionVersion:0});return tx}} as unknown as Connection
  await expect(verifyConfirmedConsolidationTransfer(connection,root)).resolves.toBeUndefined()
  tx.transaction.message.staticAccountKeys[2]=Keypair.generate().publicKey
  await expect(verifyConfirmedConsolidationTransfer(connection,root)).rejects.toThrow()
 })
 it('recovers an unknown sale by its original root signature and never enables a second sale',async()=>{
  const h=harness(),transfer=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports);await executeConsolidationTransfers(h.connection,transfer,h.controls,h.ports)
  const sale=await prepareConsolidationSale(h.connection,h.journal.id,h.controls,{slippageBps:500,priorityFeeLamports:'0'},h.ports),signature=bs58.encode(new Uint8Array(64).fill(11))
  h.ports.executeSale=async(_c,review,signer)=>{const result={...review,status:'unknown' as const,rows:review.rows.map(row=>({...row,status:'unknown' as const,signature}))};h.sales.push(result);signer.onChange?.(result);return result}
  await executeConsolidationSale(h.connection,sale,h.controls,h.ports)
  expect(readConsolidations(h.storage)[0].sale).toMatchObject({attempted:true,status:'unknown',signature})
  h.sales[0].rows[0].status='confirmed';h.sales[0].status='completed'
  const result=await reconcileConsolidation(h.connection,h.journal.id,h.controls,h.ports);expect(result.sale).toMatchObject({status:'confirmed',signature})
  await expect(prepareConsolidationSale(h.connection,h.journal.id,h.controls,{slippageBps:500,priorityFeeLamports:'0'},h.ports)).rejects.toThrow()
 })
 it('a changed source group prevents spending even when the individual addresses are unchanged',async()=>{
  const h=harness(),journal=createConsolidation({...h.journal,group:{id:'selected-group',memberIds:['source']},rows:h.journal.rows});saveConsolidation(journal,undefined,h.storage)
  h.controls.readGroup=()=>['source'];const review=await prepareConsolidationTransfers(h.connection,journal.id,h.controls,h.ports);h.controls.readGroup=()=>[]
  await expect(executeConsolidationTransfers(h.connection,review,h.controls,h.ports)).rejects.toThrow(/group/i);expect(h.transferCalls).toBe(0)
 })
 it('rejects a root transfer from before this journal existed',async()=>{
  const h=harness(),review=await prepareConsolidationTransfers(h.connection,h.journal.id,h.controls,h.ports);await executeConsolidationTransfers(h.connection,review,h.controls,h.ports)
  h.roots[0].createdAt=new Date(h.journal.createdAt-1).toISOString()
  expect(()=>confirmedTransferTotal(readConsolidations(h.storage)[0],h.roots)).toThrow()
 })
})
