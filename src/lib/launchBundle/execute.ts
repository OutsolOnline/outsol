import {PublicKey,VersionedTransaction} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {signedTransactionSignature} from '@/lib/transactions/send'
import {validatePumpTransaction} from '@/lib/transactions/validatePumpTransaction'
import {withTimeout} from '@/lib/transactions/http'
import {solToLamports} from '@/lib/pumpfun/api'
import {parseResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import {clearPendingIfMatching,type PendingLaunch} from '@/lib/launchHistory'
import type {BundleResult} from '@/lib/bundler/types'
import {checkLaunchSigners,clonePackets,packetMessage,runtimeBundles,validateInitialPackets} from './internal'
import type {LaunchBundleExecutionOptions,PreparedLaunchBundle} from './model'
export type {LaunchBundleExecutionOptions} from './model'

/** Caller owns the canonical navigator lock for this entire reviewed run. */
export async function executePreparedLaunchBundle(prepared:PreparedLaunchBundle,options:LaunchBundleExecutionOptions):Promise<BundleResult>{
 const state=runtimeBundles.get(prepared)
 if(!state||state.used)throw new Error('This launch preview was already used or is unavailable. Prepare again.')
 if(options.approved!==true)throw new Error('Review and approve the complete launch before signing.')
 state.used=true
 const {input,review,ports,connection}=state
 let result:BundleResult={success:false,status:'failed',mintAddress:review.mint,buySignatures:[],bundleSellSignatures:[],submittedSignatures:[],creatorFeeRouting:parseResolvedCreatorFeeRouting(state.creatorPlan.routing)},currentBroadcast=false,initialConfirmed=false,ownsRecord=false,pending:PendingLaunch|undefined
 const checkpoint=()=>options.onReceipt({...result,creatorFeeRouting:parseResolvedCreatorFeeRouting(state.creatorPlan.routing),buySignatures:[...(result.buySignatures??[])],submittedSignatures:[...(result.submittedSignatures??[])],...(result.submissions?{submissions:result.submissions.map(item=>({...item}))}:{})})
 const check=()=>{if(options.approved!==true)throw new Error('Launch approval was withdrawn.');checkLaunchSigners(input,options);if(!ownsRecord)options.assertAvailable?.()}
 const progress=(message:string)=>{options.onProgress?.(message);check()}
 const freshInitial=async()=>{check();if(ports.now()>review.expiresAt)throw new Error('This launch preview expired. Prepare a fresh review.');if(!(await withTimeout(connection.isBlockhashValid(review.blockhash,{commitment:'confirmed'}))).value)throw new Error('The reviewed blockhash expired. Prepare again.');check()}
 const ensureMessages=(packets:readonly VersionedTransaction[])=>{if(packets.length!==state.messages.length||packets.some((tx,index)=>packetMessage(tx)!==state.messages[index]))throw new Error('A reviewed launch message changed. Nothing new was sent.');validateInitialPackets(state,packets)}
 const resetUnsubmittedInitial=()=>{if(pending){if(options.onInitialNotSubmitted)options.onInitialNotSubmitted(pending);else clearPendingIfMatching(pending)}ownsRecord=false;result={...result,status:'failed',error:result.error}}
 try{
  await freshInitial()
  const signed=clonePackets(state.packets),creatorIndexes=state.policies.flatMap((policy,index)=>policy.payer===input.payer?[index]:[])
  progress('Waiting for the signing wallet to approve the reviewed launch…')
  const signedCreator=await options.signCreator(creatorIndexes.map(index=>VersionedTransaction.deserialize(signed[index].serialize())));check()
  if(signedCreator.length!==creatorIndexes.length)throw new Error('The wallet did not sign every reviewed creator packet.')
  signedCreator.forEach((tx,index)=>{const packetIndex=creatorIndexes[index];if(packetMessage(tx)!==state.messages[packetIndex])throw new Error('The signing wallet changed a reviewed message. Nothing was sent.');signed[packetIndex]=VersionedTransaction.deserialize(tx.serialize())})
  signed.forEach((tx,index)=>{
   const policy=state.policies[index]
   if(policy.kind==='create')tx.sign([state.mint])
   if(policy.buyerId){const key=options.readBuyer(policy.buyerId);if(!key||key.publicKey.toBase58()!==policy.payer)throw new Error('A buyer wallet was locked or changed.');tx.sign([key])}
  })
  ensureMessages(signed)
  const signatures=signed.map(signedTransactionSignature),bytes=signed.map(tx=>Buffer.from(tx.serialize()).toString('base64'))
  const stable=(packets:readonly VersionedTransaction[])=>{ensureMessages(packets);if(packets.some((tx,index)=>Buffer.from(tx.serialize()).toString('base64')!==bytes[index]))throw new Error('A signed reviewed packet changed. Nothing new was sent.')}
  const simulationPackets=clonePackets(signed)
  const simulation=await ports.simulate(connection,simulationPackets,{verifySignatures:true,payer:input.payer,accounts:[input.payer,...review.wallets.map(wallet=>wallet.publicKey)],signal:options.signal});check();stable(signed);stable(simulationPackets)
  if(!simulation.success||!simulation.walletDebitsLamports||simulation.walletDebitsLamports[input.payer]!==review.creatorDebitLamports||review.wallets.some(wallet=>simulation.walletDebitsLamports?.[wallet.publicKey]!==wallet.initialDebitLamports))throw new Error(simulation.error||'A reviewed wallet cost changed. Prepare again before sending.')
  await freshInitial();stable(signed);stable(simulationPackets)
  const height=await withTimeout(connection.getBlockHeight('confirmed'));check()
  if(!Number.isSafeInteger(height)||height<0)throw new Error('The launch expiry boundary could not be verified.')
  pending={mode:'standard',venue:'pump',mint:review.mint,payer:input.payer,blockhash:review.blockhash,signatures:[...signatures],submittedAt:new Date(ports.now()).toISOString(),expiresAfterBlockHeight:height+160,creatorFeeRouting:parseResolvedCreatorFeeRouting(state.creatorPlan.routing),bundleExecution:{mode:review.mode,buyerCount:review.wallets.length,status:'partial',message:'Review the original signatures in Activity. Browser-only actions do not resume after an interruption.'}}
  const submissionPackets=clonePackets(signed)
  const onBroadcast=()=>{
   check();if(ports.now()>review.expiresAt)throw new Error('The launch preview expired before broadcast.');stable(signed);stable(simulationPackets);stable(submissionPackets)
   options.onInitialBroadcast({...pending!,bundleExecution:{...pending!.bundleExecution!},creatorFeeRouting:parseResolvedCreatorFeeRouting(state.creatorPlan.routing),signatures:[...signatures]});ownsRecord=true
   result={...result,status:'unknown',createSignature:signatures[0],submittedSignatures:[...signatures],submissions:signatures.map((signature,index)=>({signature,payer:state.policies[index].payer,blockhash:review.blockhash,expiresAfterBlockHeight:pending!.expiresAfterBlockHeight!,submittedAt:pending!.submittedAt}))};checkpoint()
   check();stable(signed);stable(simulationPackets);stable(submissionPackets);currentBroadcast=true
  }
  progress(review.atomic?'Submitting the reviewed atomic launch once…':'Submitting the reviewed launch once…')
  const receipt=review.atomic?await ports.sendBundle(connection,submissionPackets,{signal:options.signal,onBroadcast}):await ports.sendSingle(connection,submissionPackets[0],{signal:options.signal,onBroadcast})
  stable(signed);stable(submissionPackets)
  if(receipt.submitted===false&&!currentBroadcast){result.error=receipt.error;resetUnsubmittedInitial();checkpoint();return result}
  const returned='signatures' in receipt?receipt.signatures:[receipt.signature]
  if(returned.length!==signatures.length||returned.some((signature,index)=>signature!==signatures[index]))throw new Error('Submission returned different signatures. Preserve the reviewed originals.')
  if(receipt.status!=='confirmed'){result={...result,status:'unknown',error:receipt.error||'The launch needs a confirmation check.'};checkpoint();return result}
  const mintInfo=await withTimeout(connection.getAccountInfo(new PublicKey(review.mint),'confirmed'))
  if(!mintInfo||!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))throw new Error('The signatures confirmed but the selected Pump mint could not be verified. Check Activity.')
  await ports.verifyRouting(connection,parseResolvedCreatorFeeRouting(state.creatorPlan.routing),{payer:input.payer,mint:review.mint});check()
  options.onInitialConfirmed({...pending,bundleExecution:{...pending.bundleExecution!},creatorFeeRouting:parseResolvedCreatorFeeRouting(state.creatorPlan.routing),signatures:[...signatures]})
  initialConfirmed=true;currentBroadcast=false
  result={...result,status:'partial',...('bundleId' in receipt?{bundleId:receipt.bundleId}:{}),buySignatures:state.policies.flatMap((policy,index)=>policy.kind==='buyer-buy'?[signatures[index]]:[])};checkpoint()
  const confirmedAt=ports.now(),queue=review.followups.map(wallet=>({...wallet})).sort((a,b)=>input.settings.mode==='manual'?a.delaySeconds-b.delaySeconds:0)
  for(const wallet of queue){
   check()
   const random=ports.random();if(!Number.isFinite(random)||random<0||random>=1)throw new Error('The browser interval could not be determined.')
   const due=input.settings.mode==='organic'?ports.now()+(input.settings.intervalMinSeconds+random*(input.settings.intervalMaxSeconds-input.settings.intervalMinSeconds))*1000:confirmedAt+wallet.delaySeconds*1000
   progress(`Waiting for ${wallet.name||'buyer wallet'} · keep this launch open.`)
   while(ports.now()<due){await ports.wait(Math.min(250,due-ports.now()),options.signal);check()}
   const tx=await ports.buildBuy({connection,userPublicKey:wallet.publicKey,mintAddress:review.mint,maxBuyAmountSol:wallet.buySol,slippage:input.slippage,priorityFee:input.priorityFeeSol});check()
   validatePumpTransaction(tx,{action:'buy',payer:wallet.publicKey,mint:review.mint,maxSolLamports:solToLamports(wallet.buySol),maxPriorityFeeLamports:solToLamports(input.priorityFeeSol),expectedBuyCreator:state.creatorPlan.routing.effectiveCreator})
   const key=options.readBuyer(wallet.walletId);if(!key||key.publicKey.toBase58()!==wallet.publicKey)throw new Error('A buyer wallet was locked or changed.');tx.sign([key])
   const message=packetMessage(tx),encoded=Buffer.from(tx.serialize()).toString('base64'),signature=signedTransactionSignature(tx)
   const stableBuy=(packet:VersionedTransaction)=>{if(packetMessage(packet)!==message||Buffer.from(packet.serialize()).toString('base64')!==encoded)throw new Error('A signed buyer packet changed. Nothing new was sent.')}
   const simulationCopy=VersionedTransaction.deserialize(tx.serialize()),preview=await ports.simulate(connection,[simulationCopy],{verifySignatures:true,payer:wallet.publicKey,accounts:[wallet.publicKey],signal:options.signal});check();stableBuy(tx);stableBuy(simulationCopy)
   const debit=preview.walletDebitsLamports?.[wallet.publicKey]??preview.payerDebitLamports
   if(!preview.success||typeof debit!=='string'||!/^\d{1,20}$/.test(debit)||BigInt(debit)>BigInt(wallet.requiredLamports))throw new Error(preview.error||'A future buy exceeds its approved budget and reserve. Remaining buys stopped.')
   if(!(await withTimeout(connection.isBlockhashValid(tx.message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('A buyer quote expired. Remaining buys stopped.');check();stableBuy(tx);stableBuy(simulationCopy)
   const height=await withTimeout(connection.getBlockHeight('confirmed'));check();stableBuy(tx);stableBuy(simulationCopy)
   if(!Number.isSafeInteger(height)||height<0)throw new Error('The buyer expiry boundary could not be verified.')
   const context={signature,payer:wallet.publicKey,blockhash:tx.message.recentBlockhash,expiresAfterBlockHeight:height+160,submittedAt:new Date(ports.now()).toISOString()}
   const sendCopy=VersionedTransaction.deserialize(tx.serialize()),before={...result,submittedSignatures:[...(result.submittedSignatures??[])]}
   currentBroadcast=false
   const sent=await ports.sendSingle(connection,sendCopy,{signal:options.signal,onBroadcast:()=>{check();stableBuy(tx);stableBuy(simulationCopy);stableBuy(sendCopy);result={...result,status:'unknown',submittedSignatures:[...(result.submittedSignatures??[]),signature],submissions:[...(result.submissions??[]),context]};checkpoint();check();stableBuy(tx);stableBuy(simulationCopy);stableBuy(sendCopy);currentBroadcast=true}})
   stableBuy(tx);stableBuy(sendCopy)
   if(sent.submitted===false&&!currentBroadcast){result={...(result.submittedSignatures?.includes(signature)?result:before),status:'partial',error:sent.error};checkpoint();return result}
   if(sent.signature!==signature)throw new Error('A buyer submission returned a different signature. Preserve the originals.')
   if(sent.status!=='confirmed'){result={...result,status:'unknown',error:sent.error||'A buyer transaction needs a confirmation check.'};checkpoint();return result}
   currentBroadcast=false;result={...result,status:'partial',buySignatures:[...(result.buySignatures??[]),signature]};checkpoint()
  }
  result={...result,success:true,status:'confirmed',error:undefined};checkpoint();return result
 }catch(error){
  result={...result,success:false,status:currentBroadcast||(!initialConfirmed&&ownsRecord)?'unknown':initialConfirmed?'partial':'failed',error:error instanceof Error?error.message:'The reviewed launch stopped.'}
  try{checkpoint()}catch{/* Durable originals, if already recorded, remain the recovery authority. */}
  return result
 }finally{state.packets=[];runtimeBundles.delete(prepared)}
}
