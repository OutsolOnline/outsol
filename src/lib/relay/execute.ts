import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync} from '@solana/spl-token'
import bs58 from 'bs58'
import {withTimeout} from '@/lib/transactions/http'
import {assertSubmissionSigner,throwIfAborted} from '@/lib/transactions/send'
import {PENDING_KEY,readPending} from '@/lib/launchHistory'
import {readTradePending} from '@/lib/venues/tradeHistory'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'
import {assertNoPendingWalletOperation,clearPendingWalletOperation,savePendingWalletOperation,type PendingWalletOperation,type WalletOperationStorage} from '@/lib/walletOperations/history'
import type {WalletOperationLocks} from '@/lib/walletOperations/recovery'
import {inspectWalletOperationIntent,simulateWalletOperation} from '@/lib/walletOperations/builder'
import {assertNoPendingRelayTransfer,mirrorResolvedRelayReceipt,readRelayReceipts,reconcileRelayReceipt,saveRelayReceipt} from './history'
import {relayPlanState,prepareRelayTransfer,verifyRelayTransferAccounts} from './prepare'
import {assertRelayNetwork,checkedRelayMint,RELAY_MAINNET_GENESIS,relayAddress,relayRaw} from './scan'
import type {PreparedRelayTransfer,RelayExecutionOptions,RelayReceipt} from './types'

async function verifySignature(transaction:VersionedTransaction,expectedMessage:Uint8Array,payer:string){
 if(transaction.signatures.length!==1||transaction.message.header.numRequiredSignatures!==1)throw new Error('Relay requires exactly the source wallet signature.')
 const key=await crypto.subtle.importKey('raw',new Uint8Array(new PublicKey(payer).toBytes()),{name:'Ed25519'},false,['verify'])
 if(!await crypto.subtle.verify({name:'Ed25519'},key,new Uint8Array(transaction.signatures[0]),new Uint8Array(expectedMessage)))throw new Error('The source wallet returned an invalid signature. Nothing was submitted.')
}
async function executeInsideLock(connection:Connection,prepared:PreparedRelayTransfer,options:RelayExecutionOptions):Promise<RelayReceipt>{
 if(options.approved!==true)throw new Error('Review the Relay amounts and destination before signing.')
 const state=relayPlanState(prepared,connection),operation=state.operation
 const check=()=>{
  relayPlanState(prepared,connection);throwIfAborted(options.signal);options.assertAvailable?.();assertSubmissionSigner(state.input.source,options.readSigner,options.signal)
  // A review can remain open after another tab releases its lock with an unknown
  // result. Check every durable spending gate again after each asynchronous step.
  // Legacy launch storage is browser-global; injected test storage is checked by
  // presence and fails closed even if that legacy record cannot be decoded.
  if(options.storage?options.storage.getItem(PENDING_KEY)!==null:!!readPending())throw new Error('A launch is pending confirmation. Check its original transaction before relaying.')
  if(readTradePending(options.storage))throw new Error('A trade is pending confirmation. Check its original signature before relaying.')
  assertNoPendingRelayTransfer(options.storage);assertNoPendingWalletOperation(options.storage);assertNoPendingGroupOperation(options.storage);assertNoPendingBundleReceipt(options.storage)
 }
 check()
 if(Date.now()<operation.createdAt||Date.now()-operation.createdAt>60000)throw new Error('This Relay preview expired. Prepare a fresh review.')
 await assertRelayNetwork(connection);check()
 await verifyRelayTransferAccounts(connection,state.input,operation.preview.sourceBeforeRaw);check()
 if(!(await withTimeout(connection.isBlockhashValid(operation.transaction.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('This transaction expired. Prepare a fresh Relay preview.')
 check();inspectWalletOperationIntent(operation.transaction,operation.intent)
 const expected=Buffer.from(operation.transaction.message.serialize())
 const returned=await options.sign(VersionedTransaction.deserialize(operation.transaction.serialize()));check()
 if(!(returned instanceof VersionedTransaction)||!Buffer.from(returned.message.serialize()).equals(expected))throw new Error('The wallet changed the reviewed Relay transaction. Nothing was submitted.')
 const bytes=returned.serialize(),signed=VersionedTransaction.deserialize(bytes)
 if(!Buffer.from(signed.message.serialize()).equals(expected)||!Buffer.from(signed.serialize()).equals(Buffer.from(bytes)))throw new Error('The wallet changed the serialized Relay transaction. Nothing was submitted.')
 inspectWalletOperationIntent(signed,operation.intent);await verifySignature(signed,expected,state.input.source);check()
 const actual=await simulateWalletOperation(connection,signed,operation.intent,true);check()
 if(JSON.stringify(actual)!==JSON.stringify(operation.preview))throw new Error('A token balance or account cost changed since review. Prepare a fresh Relay preview.')
 await verifyRelayTransferAccounts(connection,state.input,operation.preview.sourceBeforeRaw);check()
 if(!(await withTimeout(connection.isBlockhashValid(signed.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('This transaction expired while signing. Prepare a fresh Relay preview.')
 check()
 const signature=bs58.encode(signed.signatures[0]),record:RelayReceipt={...state.input,signature,blockhash:signed.message.recentBlockhash,lastValidBlockHeight:operation.lastValidBlockHeight,genesisHash:RELAY_MAINNET_GENESIS,createdAt:new Date().toISOString(),status:'submitted',debitLamports:prepared.preview.maxDebitLamports}
 const shared:PendingWalletOperation={...operation.intent,signature,blockhash:record.blockhash,lastValidBlockHeight:record.lastValidBlockHeight,submittedAt:record.createdAt}
 // The existing wallet pending key immediately protects all established OutSol workflows.
 savePendingWalletOperation(shared,options.storage)
 try{saveRelayReceipt(record,options.storage)}catch(error){clearPendingWalletOperation(signature,options.storage);throw error}
 try{
  options.onChange?.({...record})
  // No generic availability guard after saving: it would reject this operation's own pending record.
  // There are no awaits between this identity/cancellation check and the one transport call.
  assertSubmissionSigner(state.input.source,options.readSigner,options.signal)
  const saved=readRelayReceipts(options.storage).find(value=>value.signature===signature)
  if(!saved||saved.status!=='submitted'||saved.amountRaw!==state.input.amountRaw||saved.destination!==state.input.destination)throw new Error('The saved Relay receipt changed before submission.')
 }catch(error){const stopped=saveRelayReceipt({...record,status:'failed',resolvedAt:new Date().toISOString(),error:'Cancelled before broadcast.'},options.storage);mirrorResolvedRelayReceipt(stopped,options.storage);throw error}
 let sendError=false
 try{const returnedSignature=await withTimeout(connection.sendRawTransaction(bytes,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}),Math.min(options.timeoutMs??20000,20000));if(returnedSignature!==signature)sendError=true}catch{sendError=true}
 const deadline=Date.now()+(options.timeoutMs??30000)
 let result=record
 do{
  try{result=await reconcileRelayReceipt(connection,result,options.storage)}catch{result=saveRelayReceipt({...record,status:'unknown',error:'Finalized confirmation could not be checked.'},options.storage)}
  if(result.status==='confirmed'||result.status==='failed')break
  if(options.signal?.aborted||Date.now()>=deadline)break
  await new Promise(resolve=>setTimeout(resolve,Math.min(options.pollIntervalMs??1000,Math.max(1,deadline-Date.now()))))
 }while(Date.now()<deadline)
 if(result.status==='submitted'||(sendError&&result.status==='unknown'))result=saveRelayReceipt({...record,status:'unknown',error:'Submission or confirmation is uncertain. Preserve the original signature.'},options.storage)
 options.onChange?.({...result});return result
}
/** User-reviewed manual transfer. The complete shared lock lasts through reconciliation. */
export async function executeRelayTransfer(connection:Connection,prepared:PreparedRelayTransfer,options:RelayExecutionOptions):Promise<RelayReceipt>{
 if(!options.approved)throw new Error('Review the Relay destination and amounts first.')
 const locks=(options.locks??(typeof navigator!=='undefined'?navigator.locks:undefined)) as WalletOperationLocks|undefined
 if(!locks)throw new Error('Use a current browser with secure cross-tab transaction coordination.')
 return locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Another tab is signing or checking a transaction.');return executeInsideLock(connection,prepared,options)})
}
export interface ConfirmedBuyRelayInput {source:string;destination:string;mint:string;amountRaw:string;maxDebitLamports:string;readSigner:()=>string|null|undefined;sign:(transaction:VersionedTransaction)=>Promise<VersionedTransaction>;signal?:AbortSignal;guard:()=>void;storage?:WalletOperationStorage;onChange?:(receipt:RelayReceipt)=>void;timeoutMs?:number;pollIntervalMs?:number}
/** Session-only adapter: the caller already holds vanity-launch-submission and proved the buy confirmed.
 * The exact newly purchased amount is supplied by that receipt, never inferred from total holdings.
 */
export async function executeConfirmedBuyRelay(connection:Connection,input:ConfirmedBuyRelayInput):Promise<{signature:string;status:'confirmed'|'failed'|'unknown';debitLamports:string;error?:string}>{
 const source=new PublicKey(relayAddress(input.source,true)),mint=new PublicKey(relayAddress(input.mint)),ceiling=relayRaw(input.maxDebitLamports)
 relayRaw(input.amountRaw);input.guard();assertSubmissionSigner(source.toBase58(),input.readSigner,input.signal)
 const mintInfo=await withTimeout(connection.getAccountInfo(mint,'confirmed'));input.guard();assertSubmissionSigner(source.toBase58(),input.readSigner,input.signal)
 if(!mintInfo)throw new Error('The purchased token mint could not be loaded.')
 const state=checkedRelayMint(mint,mintInfo,mintInfo.owner),prepared=await prepareRelayTransfer(connection,{source:source.toBase58(),destination:input.destination,mint:mint.toBase58(),sourceAccount:getAssociatedTokenAddressSync(mint,source,false,mintInfo.owner).toBase58(),tokenProgram:mintInfo.owner.toBase58(),amountRaw:input.amountRaw,decimals:state.decimals})
 input.guard();assertSubmissionSigner(source.toBase58(),input.readSigner,input.signal)
 if(BigInt(prepared.preview.maxDebitLamports)>ceiling)throw new Error('Relay account rent and fees exceed the approved SOL cost ceiling. Nothing was transferred.')
 const result=await executeInsideLock(connection,prepared,{approved:true,readSigner:input.readSigner,sign:input.sign,assertAvailable:input.guard,signal:input.signal,storage:input.storage,onChange:input.onChange,timeoutMs:input.timeoutMs,pollIntervalMs:input.pollIntervalMs})
 return{signature:result.signature,status:result.status==='submitted'?'unknown':result.status,debitLamports:result.debitLamports,...(result.error?{error:result.error}:{})}
}
