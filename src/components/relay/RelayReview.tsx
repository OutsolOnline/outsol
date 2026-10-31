'use client'
import {Loader2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog'
import {formatRawBalance} from '@/lib/venues/trade'
import type {PreparedRelayTransfer} from '@/lib/relay/types'
import type {SaleBatchRecord} from '@/lib/sales/history'
import styles from './RelayWorkspace.module.css'
export interface ReviewedRelay {walletId:string;destinationWalletId:string;routeId:string;name:string;prepared:PreparedRelayTransfer}
export type RelayWorkspaceReview={kind:'relay';rows:ReviewedRelay[];excluded?:{walletName:string;mint:string;reason:string}[]}|{kind:'sell';batch:SaleBatchRecord}
const short=(address:string)=>`${address.slice(0,6)}…${address.slice(-6)}`
const sol=(value:string)=>formatRawBalance(value,9,9)
export function RelayReview({review,busy,approved,onApprove,onClose,onExecute}:{review:RelayWorkspaceReview|null;busy:boolean;approved:boolean;onApprove:(next:boolean)=>void;onClose:()=>void;onExecute:()=>void}){
 const sale=review?.kind==='sell'?review.batch:null,count=review?.kind==='relay'?review.rows.length:sale?.rows.filter(row=>row.status==='ready').length||0
 return <Dialog open={review!==null} onOpenChange={next=>{if(!next&&!busy)onClose()}}><DialogContent className={styles.review} onEscapeKeyDown={e=>{if(busy)e.preventDefault()}} onInteractOutside={e=>{if(busy)e.preventDefault()}}>
  <DialogTitle>{review?.kind==='relay'?'Review token relay':'Review token sales'}</DialogTitle>
  <DialogDescription>{review?.kind==='relay'?'Move the exact token amounts below to their saved recipients. SOL stays in each source wallet, apart from the disclosed fees and account rent.':'Sell the reviewed amounts into SOL in the same wallets. Each sale executes separately; the queue stops if a quote changes beyond your approved limits.'}</DialogDescription>
  <div className={styles.reviewRows}>
   {review?.kind==='relay'&&review.rows.map(row=><article className={styles.reviewRow} key={`${row.walletId}:${row.prepared.input.sourceAccount}`}><header><strong>{row.name}</strong><span>Relay</span></header><p>{row.prepared.input.source} → {row.prepared.input.destination}</p><p>Mint {row.prepared.input.mint}</p><dl><div><dt>Tokens to move</dt><dd>{formatRawBalance(row.prepared.input.amountRaw,row.prepared.input.decimals,9)}</dd></div><div><dt>Network and priority fee</dt><dd>{sol(row.prepared.preview.networkFeeLamports)} SOL</dd></div><div><dt>Recipient account rent</dt><dd>{sol(row.prepared.preview.destinationRentLamports)} SOL</dd></div><div><dt>Maximum source SOL debit</dt><dd>{sol(row.prepared.preview.maxDebitLamports)} SOL</dd></div></dl></article>)}
   {review?.kind==='relay'&&review.excluded?.map((row,index)=><article className={styles.reviewRow} key={`excluded-${index}`}><header><strong>{row.walletName}</strong><span className={styles.failure}>Remains in source</span></header><p>Mint {row.mint}</p><p>{row.reason}</p></article>)}
   {sale?.rows.map(row=><article className={styles.reviewRow} key={`${row.payer}:${row.mint}`}><header><strong>{row.walletName}</strong><span className={row.status==='unavailable'?styles.failure:styles.status}>{row.status==='unavailable'?'Unavailable':row.route==='pump'?'Pump.fun':'Jupiter'}</span></header><p>Wallet {row.payer}</p><p>Mint {row.mint}</p>{row.status==='unavailable'?<p className={styles.failure}>{row.error}</p>:<dl><div><dt>Tokens to sell</dt><dd>{formatRawBalance(row.amountRaw,row.decimals,9)}</dd></div><div><dt>Estimated net SOL change</dt><dd>{sol(row.estimatedNetSolOut!)} SOL</dd></div><div><dt>Minimum gross sale proceeds</dt><dd>{sol(row.minimumSolOut!)} SOL</dd></div><div><dt>Included network / priority fee</dt><dd>{sol(row.networkFeeLamports!)} SOL</dd></div><div><dt>Maximum fee and rent reserve</dt><dd>{sol(row.maxDebitLamports!)} SOL</dd></div></dl>}</article>)}
  </div>
  <p className={styles.quiet}>OutSol platform fee: <strong>0 SOL</strong>. Network fees, account rent and venue costs still apply. Estimates can change; stronger output or lower costs are allowed, weaker limits require a fresh review.</p>
  {sale?.rows.some(row=>row.status==='unavailable')&&<p className={styles.quiet}>Unavailable tokens remain in your wallets. This approval covers only the {count} available sale{count===1?'':'s'}.</p>}
  <label className={styles.confirm}><input type="checkbox" checked={approved} disabled={busy||!count} onChange={e=>onApprove(e.target.checked)}/>I reviewed the wallets, token amounts, recipients and cost limits. Submit these {count} transaction{count===1?'':'s'}.</label>
  <div className={styles.reviewFooter}><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button onClick={onExecute} disabled={!approved||busy||!count}>{busy?<><Loader2 size={16} className="animate-spin"/>Processing…</>:review?.kind==='relay'?`Sign & relay ${count}`:`Sign & sell ${count}`}</Button></div>
 </DialogContent></Dialog>
}
export const shortRelayAddress=short
