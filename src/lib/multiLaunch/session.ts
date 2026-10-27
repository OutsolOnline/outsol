import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {unpackMint,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {buildCreateTransaction,uploadMetadataToIPFS} from '@/lib/pumpfun/api'
import {simulateAtomicBundle,submitAtomicBundle} from '@/lib/bundler/jito'
import {assertSubmissionSigner,sendAndConfirmTransaction,signedTransactionSignature} from '@/lib/transactions/send'
import {validatePumpLaunchPlan,type NativePumpLaunchPlan} from '@/lib/transactions/validatePumpLaunchPlan'
import {migrateLegacyCreatorFeeSelection,requireSupportedCreatorFeeSelection,parseResolvedCreatorFeeRouting,resolveCreatorFeeRouting,type CreatorFeeSelection,type ResolvedCreatorFeeRouting,type VerifiedGitHubIndividual} from '@/lib/creatorFeeRouting'
import {fetchGitHubIndividual,assertGitHubIdentityUnchanged} from '@/lib/githubRecipient'
import {verifyCreatorFeeRoutingOnChain} from '@/lib/creatorFeeRecovery'
import {withTimeout} from '@/lib/transactions/http'
import {clearPendingIfMatching,readPending,samePending,saveConfirmed,savePending,type PendingLaunch} from '@/lib/launchHistory'
import {readTradePending} from '@/lib/venues/tradeHistory'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {assertNoPendingBundleReceipt} from '@/lib/bundler/pending'
import {validateTokenDetails} from '@/lib/launchConfig'
import {readBatchJournal,saveBatchJournal,type BatchJournal} from './history'
import {simulateMultiLaunchCosts} from './costs'

export interface MultiLaunchRowInput {name:string;symbol:string;buySol:string}
export interface MultiLaunchInput {payer:string;rows:MultiLaunchRowInput[];shared:{description:string;image:Blob;website?:string;twitter?:string;telegram?:string};slippage:number;priorityFeeSol:number;jitoTipSol:number;creatorFeeSelection?:CreatorFeeSelection}
export interface MultiLaunchReviewRow {name:string;symbol:string;mint:string;metadataUri:string;maxBuyLamports:string;debitLamports:string;networkFeeLamports:string;tipLamports:string;packetCount:number;atomicBundle:boolean;creatorFeeRouting:ResolvedCreatorFeeRouting}
export interface MultiLaunchReview {payer:string;createdAt:number;expiresAt:number;balanceLamports:string;totalDebitLamports:string;totalMaxBuyLamports:string;rows:MultiLaunchReviewRow[]}
export interface MultiLaunchSigner {approved:true;readSigner:()=>string|null|undefined;sign:(packets:VersionedTransaction[])=>Promise<VersionedTransaction[]>;signal?:AbortSignal;onChange?:(journal:BatchJournal)=>void;previousGitHubRecipient?:VerifiedGitHubIndividual}
export interface MultiLaunchLocks {request<T>(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>):Promise<T>}
export interface MultiLaunchPorts {build:typeof buildCreateTransaction;upload:typeof uploadMetadataToIPFS;simulate:typeof simulateAtomicBundle;simulatePlan:typeof simulateMultiLaunchCosts;sendSingle:typeof sendAndConfirmTransaction;sendBundle:typeof submitAtomicBundle;resolveGitHub:typeof fetchGitHubIndividual;verifyRouting:typeof verifyCreatorFeeRoutingOnChain;now:()=>number;locks?:MultiLaunchLocks}
const defaults:MultiLaunchPorts={build:buildCreateTransaction,upload:uploadMetadataToIPFS,simulate:simulateAtomicBundle,simulatePlan:simulateMultiLaunchCosts,sendSingle:sendAndConfirmTransaction,sendBundle:submitAtomicBundle,resolveGitHub:fetchGitHubIndividual,verifyRouting:verifyCreatorFeeRoutingOnChain,now:Date.now}
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const message=(tx:VersionedTransaction)=>Buffer.from(tx.message.serialize()).toString('base64')
const packetBytes=(tx:VersionedTransaction)=>Buffer.from(tx.serialize()).toString('base64')
const clonePackets=(packets:VersionedTransaction[])=>packets.map(packet=>VersionedTransaction.deserialize(packet.serialize()))
const errorText=(error:unknown)=>error instanceof Error?error.message:'The multi-launch stopped.'
const bigintAmount=(value:string|undefined,label:string)=>{if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error(`${label} could not be verified`);return BigInt(value)}
function buyAmount(value:string):bigint {
 if(typeof value!=='string'||!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value))throw new Error('Each first buy must be a decimal SOL amount with at most nine places.')
 const [whole,fraction='']=value.split('.'),lamports=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'))
 if(lamports>1_000_000_000_000n)throw new Error('Each first buy must be 0–1,000 SOL.')
 return lamports
}
function available(){
 if(readPending())throw new Error('A previous launch needs a confirmation check in Activity.')
 if(readTradePending())throw new Error('A trade needs a confirmation check in Manage token.')
 assertNoPendingWalletOperation();assertNoPendingGroupOperation();assertNoPendingBundleReceipt()
}
interface PrivateRow {mint:Keypair;packets:VersionedTransaction[];messages:string[];review:MultiLaunchReviewRow;plan:NativePumpLaunchPlan}
function validatePackets(row:PrivateRow,payer:string,priorityFeeSol:number){
 const {review,packets,plan}=row
 if(plan.routing.payer!==payer||plan.routing.mint!==review.mint||JSON.stringify(plan.routing)!==JSON.stringify(review.creatorFeeRouting)||plan.maxBuyLamports!==review.maxBuyLamports||BigInt(plan.maxPriorityFeeLamports)>BigInt(Math.round(priorityFeeSol*1e9))||plan.jitoTipLamports!==review.tipLamports||plan.requiresAtomicBundle!==review.atomicBundle||packets.length!==review.packetCount||plan.metadata.name!==review.name||plan.metadata.symbol!==review.symbol||plan.metadata.uri!==review.metadataUri)throw new Error('Native launch plan differs from the reviewed recipient, amounts or metadata')
 validatePumpLaunchPlan({...plan,packets})
}

/** Mint signers and packets stay in private memory and cannot enter a JSON record. */
export class MultiLaunchSession {
 #connection:Connection;#input:MultiLaunchInput;#rows:PrivateRow[];#review:MultiLaunchReview;#ports:MultiLaunchPorts;#used=false
 constructor(connection:Connection,input:MultiLaunchInput,rows:PrivateRow[],review:MultiLaunchReview,ports:MultiLaunchPorts){this.#connection=connection;this.#input=input;this.#rows=rows;this.#review=review;this.#ports=ports}
 review():MultiLaunchReview {return structuredClone(this.#review)}
 async run(signer:MultiLaunchSigner):Promise<BatchJournal>{
  if(this.#used)throw new Error('This reviewed batch was already used. Prepare a new preview; no automatic retry is allowed.')
  if(signer.approved!==true)throw new Error('Explicit approval of the complete reviewed batch is required.')
  const locks=this.#ports.locks??(typeof navigator!=='undefined'?navigator.locks as unknown as MultiLaunchLocks:undefined)
  if(!locks)throw new Error('Use a current browser with secure cross-tab transaction coordination.')
  this.#used=true
  try {
   return await locks.request('vanity-launch-submission',{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is signing or checking a transaction. Finish it there first.')
    if(signer.approved!==true)throw new Error('Explicit batch approval was withdrawn before signing.')
    return this.#execute(signer)
   })
  }finally{this.#rows=[]}
 }
 async #execute(signer:MultiLaunchSigner):Promise<BatchJournal>{
  const ports=this.#ports,review=this.#review,connection=this.#connection
  const now=()=>new Date(ports.now()).toISOString()
  let journal:BatchJournal={version:1,id:crypto.randomUUID(),payer:review.payer,startedAt:now(),updatedAt:now(),totalDebitLamports:review.totalDebitLamports,status:'running',rows:review.rows.map(row=>({mint:row.mint,name:row.name,symbol:row.symbol,metadataUri:row.metadataUri,maxBuyLamports:row.maxBuyLamports,debitLamports:row.debitLamports,creatorFeeRouting:row.creatorFeeRouting,status:'waiting',signatures:[]}))}
  let submitted=false,pending:PendingLaunch|null=null,checkpointed=false
  const check=()=>{if(signer.approved!==true)throw new Error('Explicit batch approval was withdrawn.');assertSubmissionSigner(review.payer,signer.readSigner,signer.signal);if(ports.now()>review.expiresAt)throw new Error('The reviewed batch expired. Prepare all remaining tokens again for fresh blockhashes and costs.')}
  const checkpoint=()=>{journal.updatedAt=now();saveBatchJournal(journal);checkpointed=true;signer.onChange?.(structuredClone(journal))}
  try {
   available();readBatchJournal();check();checkpoint()
   const initialBalance=await withTimeout(connection.getBalance(new PublicKey(review.payer),'confirmed'));check()
   if(!Number.isSafeInteger(initialBalance)||BigInt(initialBalance)<BigInt(review.totalDebitLamports))throw new Error('The current wallet balance no longer covers the entire reviewed batch.')
   for(let index=0;index<this.#rows.length;index++){
    available();check();submitted=false;pending=null
    const row=this.#rows[index],record=journal.rows[index]
    if(!(await withTimeout(connection.isBlockhashValid(row.packets[0].message.recentBlockhash,{commitment:'confirmed'}))).value)throw new Error('A reviewed blockhash expired. Prepare the remaining tokens again.');check()
    const remaining=review.rows.slice(index).reduce((sum,value)=>sum+BigInt(value.debitLamports),0n)
    const balance=await withTimeout(connection.getBalance(new PublicKey(review.payer),'confirmed'));check()
    if(!Number.isSafeInteger(balance)||BigInt(balance)<remaining)throw new Error('The wallet balance no longer covers the remaining reviewed launches.')
    validatePackets(row,review.payer,this.#input.priorityFeeSol)
    const copies=clonePackets(row.packets)
    record.status='signing';checkpoint()
    const walletSigned=await signer.sign(copies);check()
    if(walletSigned.length!==row.messages.length)throw new Error('The wallet did not sign every reviewed packet.')
    // Wallet adapters may retain and later mutate their returned objects. Copy
    // each packet synchronously after checking its message, before any await.
    const signed=walletSigned.map((tx,packetIndex)=>{
     if(message(tx)!==row.messages[packetIndex])throw new Error('The wallet changed a reviewed message. Nothing new was sent.')
     return VersionedTransaction.deserialize(tx.serialize())
    })
    signed.forEach(tx=>{
     if(tx.message.staticAccountKeys.slice(0,tx.message.header.numRequiredSignatures).some(key=>key.equals(row.mint.publicKey)))tx.sign([row.mint])
    })
    validatePackets({...row,packets:signed},review.payer,this.#input.priorityFeeSol)
    const signatures=signed.map(signedTransactionSignature),originalBytes=signed.map(packetBytes)
    const assertStable=(packets:VersionedTransaction[])=>{
     if(packets.length!==originalBytes.length||packets.some((tx,packetIndex)=>message(tx)!==row.messages[packetIndex]||packetBytes(tx)!==originalBytes[packetIndex]||signedTransactionSignature(tx)!==signatures[packetIndex]))throw new Error('A signed packet, reviewed message or original signature changed. Nothing new was sent.')
     validatePackets({...row,packets},review.payer,this.#input.priorityFeeSol)
    }
    const height=await withTimeout(connection.getBlockHeight('confirmed'));check()
    assertStable(signed)
    if(!Number.isSafeInteger(height)||height<0)throw new Error('The expiry boundary could not be verified.')
    // External ports receive isolated copies, which remain checked through the
    // broadcast boundary so retained callbacks cannot invalidate the simulation.
    const simulationPackets=clonePackets(signed)
    const simulation=await ports.simulate(connection,simulationPackets,{verifySignatures:true,payer:review.payer,signal:signer.signal});check()
    assertStable(signed);assertStable(simulationPackets)
    if(!simulation.success||simulation.payerDebitLamports!==row.review.debitLamports)throw new Error(simulation.success?'The reviewed launch cost changed. Prepare again before sending.':simulation.error||'The signed launch simulation failed.')
    // No RPC await between these durable records and the guarded broadcast.
    available();check()
    pending={mode:'standard',venue:'pump',mint:row.review.mint,payer:review.payer,blockhash:signed[0].message.recentBlockhash,signatures,submittedAt:now(),expiresAfterBlockHeight:height+160,creatorFeeRouting:row.review.creatorFeeRouting}
    savePending(pending)
    if(!samePending(readPending(),pending))throw new Error('The original signed signatures could not be saved.')
    record.signatures=signatures;record.status='sending';checkpoint()
    assertStable(signed);assertStable(simulationPackets)
    const submissionPackets=clonePackets(signed)
    const expectedPending=pending
    const assertAllStable=()=>{assertStable(signed);assertStable(simulationPackets);assertStable(submissionPackets)}
    const options={signal:signer.signal,onBroadcast:()=>{check();assertAllStable();if(!samePending(readPending(),expectedPending))throw new Error('The saved launch changed; nothing new was submitted.');submitted=true}}
    const result=row.review.atomicBundle?await ports.sendBundle(connection,submissionPackets,options):await ports.sendSingle(connection,submissionPackets[0],options)
    signer.readSigner()
    assertAllStable()
    const returned='signatures' in result?result.signatures:[result.signature]
    if(returned.length!==signatures.length||returned.some((signature,packetIndex)=>signature!==signatures[packetIndex]))throw new Error('Submission returned different signatures. Preserve the originals in Activity.')
    if(result.status!=='confirmed'){
     if(!submitted&&result.submitted===false){clearPendingIfMatching(pending);pending=null;record.status='failed';journal.status='failed'}
     else {record.status='unknown';journal.status='unknown'}
     journal.error=result.error||'A launch needs a confirmation check in Activity. Remaining rows were stopped.';checkpoint();return journal
    }
    // Finalize the confirmed row even if cancellation arrived during confirmation.
    const mintInfo=await withTimeout(connection.getAccountInfo(row.mint.publicKey,'confirmed'))
    signer.readSigner()
    if(!mintInfo||!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))throw new Error('Signatures confirmed but the expected mint account could not be verified. Check Activity.')
    const mint=unpackMint(row.mint.publicKey,mintInfo,TOKEN_2022_PROGRAM_ID)
    if(!mint.isInitialized||mint.decimals!==6)throw new Error('The confirmed mint account is not the reviewed Pump.fun token. Check Activity.')
    await ports.verifyRouting(connection,row.review.creatorFeeRouting,{payer:review.payer,mint:row.review.mint})
    saveConfirmed(pending)
    if(readPending())throw new Error('The confirmed public receipt could not be saved. Check Activity before continuing.')
    record.status='confirmed';pending=null;submitted=false;checkpoint()
    // A changed wallet can stop future work but never erase a confirmed receipt.
    if(index<this.#rows.length-1)check()
   }
   journal.status='confirmed';checkpoint();return journal
  }catch(error){
   if(!submitted&&pending)clearPendingIfMatching(pending)
   journal.status=submitted?'unknown':signer.signal?.aborted?'cancelled':'failed';journal.error=errorText(error)
   const active=journal.rows.find(row=>row.status==='signing'||row.status==='sending')
   if(active)active.status=submitted?'unknown':'failed'
   if(checkpointed)checkpoint();return journal
  }finally{this.#rows=[]}
 }
}

/** Upload is explicit, then every fresh mint is simulated without spending. */
export async function prepareMultiLaunch(connection:Connection,input:MultiLaunchInput,signer:Pick<MultiLaunchSigner,'readSigner'|'signal'|'previousGitHubRecipient'>,overrides:Partial<MultiLaunchPorts>={}):Promise<MultiLaunchSession>{
 const ports={...defaults,...overrides},payer=new PublicKey(input.payer).toBase58()
 if(!Array.isArray(input.rows)||input.rows.length<2||input.rows.length>5)throw new Error('Choose 2–5 Pump.fun tokens for one reviewed batch.')
 if(!Number.isFinite(input.slippage)||input.slippage<0.1||input.slippage>50||!Number.isFinite(input.priorityFeeSol)||input.priorityFeeSol<0||input.priorityFeeSol>0.01||!Number.isFinite(input.jitoTipSol)||input.jitoTipSol<0.000001||input.jitoTipSol>0.1)throw new Error('Check slippage, priority fee and bundle tip limits.')
 if(!(input.shared.image instanceof Blob)||!['image/png','image/jpeg','image/gif','image/webp'].includes(input.shared.image.type)||!input.shared.image.size||input.shared.image.size>5*1024*1024)throw new Error('Choose local PNG, JPEG, GIF or WebP artwork up to 5 MB.')
 const creatorFeeSelection=Object.hasOwn(input,'creatorFeeSelection')?requireSupportedCreatorFeeSelection(input.creatorFeeSelection):migrateLegacyCreatorFeeSelection(undefined)
 const safeInput:MultiLaunchInput={...input,creatorFeeSelection,payer,shared:{...input.shared},rows:input.rows.map(row=>({...row,name:row.name.trim(),symbol:row.symbol.trim()}))}
 const amounts=safeInput.rows.map(row=>{const errors=validateTokenDetails({name:row.name,symbol:row.symbol,description:safeInput.shared.description,website:safeInput.shared.website,twitter:safeInput.shared.twitter,telegram:safeInput.shared.telegram});if(Object.keys(errors).length)throw new Error(Object.values(errors).join(' '));return buyAmount(row.buySol)})
 const check=()=>{assertSubmissionSigner(payer,signer.readSigner,signer.signal);available()}
 check();readBatchJournal()
 if(await withTimeout(connection.getGenesisHash())!==MAINNET)throw new Error('Multi-launch supports Solana mainnet Pump.fun only.');check()
 const githubRecipient=creatorFeeSelection.kind==='github'?await ports.resolveGitHub(creatorFeeSelection.username,signer.signal):undefined
 check();if(githubRecipient)assertGitHubIdentityUnchanged(signer.previousGitHubRecipient,githubRecipient)
 const privateRows:PrivateRow[]=[]
 for(let index=0;index<safeInput.rows.length;index++){
  check()
  const row=safeInput.rows[index],mint=Keypair.generate(),metadata={...safeInput.shared,name:row.name,symbol:row.symbol}
  const uploaded=await ports.upload(metadata);check()
  if(!uploaded.success||!uploaded.metadataUri)throw new Error(uploaded.error||'Public metadata upload failed.')
  const uri=new URL(uploaded.metadataUri)
  if(!['https:','ipfs:'].includes(uri.protocol)||!uri.hostname||uri.username||uri.password||new TextEncoder().encode(uploaded.metadataUri).length>200)throw new Error('Uploaded metadata URI is not a supported public link.')
  const expectedRouting=resolveCreatorFeeRouting({selection:creatorFeeSelection,payer,mint:mint.publicKey.toBase58(),github:githubRecipient})
  const built=await ports.build({connection,metadata,mintKeypair:mint,userPublicKey:payer,metadataUri:uploaded.metadataUri,initialBuyAmount:Number(amounts[index])/1e9,slippage:safeInput.slippage,priorityFee:safeInput.priorityFeeSol,jitoTipLamports:Math.round(safeInput.jitoTipSol*1e9),creatorFeeSelection,githubRecipient});check()
  const packets=built.transactions||(built.transaction?[built.transaction]:[])
  if(!built.success||!packets.length||!built.launchPlan||!built.creatorFeeRouting)throw new Error(built.error||'The verified native launch plan could not be built.')
  const routing=parseResolvedCreatorFeeRouting(built.creatorFeeRouting)
  if(JSON.stringify(routing)!==JSON.stringify(expectedRouting))throw new Error('The prepared creator fee recipient differs from the selected route.')
  if(privateRows.reduce((sum,row)=>sum+row.packets.length,0)+packets.length+(safeInput.rows.length-index-1)>5)throw new Error('The complete multi-launch cost preview supports five packets total. This recipient setup needs more space: shorten metadata, remove first buys, prepare fewer tokens, or deliberately choose another recipient. No token was signed.')
  if(packets.some(tx=>tx.message.recentBlockhash!==packets[0].message.recentBlockhash))throw new Error('Launch packets have inconsistent blockhashes.')
  const review:MultiLaunchReviewRow={name:row.name,symbol:row.symbol,mint:mint.publicKey.toBase58(),metadataUri:uploaded.metadataUri,maxBuyLamports:amounts[index].toString(),debitLamports:'0',networkFeeLamports:'0',tipLamports:bigintAmount(built.jitoTipLamports??'0','Validator tip').toString(),packetCount:packets.length,atomicBundle:!!built.requiresAtomicBundle,creatorFeeRouting:routing}
  if(BigInt(review.tipLamports)!==(review.atomicBundle?BigInt(Math.round(safeInput.jitoTipSol*1e9)):0n))throw new Error('The validator tip differs from the chosen limit.')
  const privateRow={mint,packets,messages:packets.map(message),review,plan:built.launchPlan};validatePackets(privateRow,payer,safeInput.priorityFeeSol)
  const simulation=await ports.simulate(connection,packets,{payer,signal:signer.signal});check()
  if(!simulation.success)throw new Error(simulation.error||'An unsigned launch simulation failed.')
  review.debitLamports=bigintAmount(simulation.payerDebitLamports,'Complete wallet debit').toString()
  let feeTotal=0n
  for(const tx of packets){const fee=await withTimeout(connection.getFeeForMessage(tx.message,'confirmed'));check();if(fee.value===null||!Number.isSafeInteger(fee.value)||fee.value<0)throw new Error('The network fee could not be verified.');feeTotal+=BigInt(fee.value)}
  review.networkFeeLamports=feeTotal.toString()
  if(BigInt(review.debitLamports)<feeTotal+BigInt(review.tipLamports))throw new Error('The simulated debit does not cover the quoted network fees and tip.')
  privateRows.push(privateRow)
 }
 const costs=await ports.simulatePlan(connection,privateRows.map(row=>row.packets),{payer,signal:signer.signal});check()
 if(costs.rowDebitsLamports.length!==privateRows.length)throw new Error('The complete cost preview did not cover every token.')
 privateRows.forEach((row,index)=>{row.review.debitLamports=bigintAmount(costs.rowDebitsLamports[index],'Sequential row debit').toString();if(BigInt(row.review.debitLamports)<BigInt(row.review.networkFeeLamports)+BigInt(row.review.tipLamports))throw new Error('The ordered cost preview does not cover the quoted fees and tip.')})
 const total=privateRows.reduce((sum,row)=>sum+BigInt(row.review.debitLamports),0n)
 if(total!==bigintAmount(costs.totalDebitLamports,'Total wallet debit'))throw new Error('The complete wallet debit did not match the reviewed rows.')
 const aggregate=await ports.simulate(connection,privateRows.flatMap(row=>row.packets),{payer,signal:signer.signal});check()
 if(!aggregate.success||aggregate.payerDebitLamports!==total.toString())throw new Error('The aggregate wallet requirement changed during preparation. Prepare again for current costs.')
 const balance=await withTimeout(connection.getBalance(new PublicKey(payer),'confirmed'));check()
 if(!Number.isSafeInteger(balance)||balance<0||BigInt(balance)<total)throw new Error('The wallet balance does not cover the exact summed requirement for all launches.')
 const createdAt=ports.now(),review:MultiLaunchReview={payer,createdAt,expiresAt:createdAt+60_000,balanceLamports:String(balance),totalDebitLamports:total.toString(),totalMaxBuyLamports:amounts.reduce((sum,amount)=>sum+amount,0n).toString(),rows:privateRows.map(row=>row.review)}
 return new MultiLaunchSession(connection,safeInput,privateRows,review,ports)
}
