import type {BackgroundJobStore} from './store'
import type {HistoryReceipt,JobLease,SignatureEntry} from './model'

export class UnsupportedMintError extends Error{}
export class RpcBudgetError extends Error{}
export interface HistoryReader {
 mintDecimals:(mint:string)=>Promise<number>
 signatures:(mint:string,before:string|null,limit:number)=>Promise<SignatureEntry[]>
 receipt:(mint:string,decimals:number,entry:SignatureEntry)=>Promise<HistoryReceipt>
}
/** Every planned signature is persisted before receipt reads. Each read is
 * checkpointed under a live lease; cancelled/expired owners cannot commit. */
export async function runHistoryJob(store:BackgroundJobStore,lease:JobLease,reader:HistoryReader,maxSteps=25):Promise<void>{
 try{
  let current=store.current(lease);if(!current)return
  if(current.decimals===null){const decimals=await reader.mintDecimals(current.mint);if(!store.saveMint(lease,decimals))return}
  for(let step=0;step<maxSteps;step++){
   current=store.current(lease);if(!current)return
   if(!store.heartbeat(lease))return
   if(!current.page.length){
    const page=await reader.signatures(current.mint,current.before,Math.min(25,current.maxTransactions-current.scanned));if(!store.savePage(lease,page))return
   }else{
    const receipt=await reader.receipt(current.mint,current.decimals!,current.page[current.pageIndex]);if(!store.record(lease,receipt))return
   }
  }
  store.defer(lease)
 }catch(error){
  if(error instanceof UnsupportedMintError)store.fail(lease,'unsupported-mint')
  else if(error instanceof RpcBudgetError)store.defer(lease,60_000)
  else store.retry(lease)
 }
}
