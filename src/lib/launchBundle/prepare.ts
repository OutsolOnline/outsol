import {Keypair,PublicKey,type Connection} from '@solana/web3.js'
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {buildCreateTransaction,buildFreshNativeBuy,buildNativeBuyTransaction,solToLamports} from '@/lib/pumpfun/api'
import {createVerifiedJitoTipTransaction,simulateAtomicBundle,submitAtomicBundle} from '@/lib/bundler/jito'
import {sendAndConfirmTransaction,throwIfAborted} from '@/lib/transactions/send'
import {withTimeout} from '@/lib/transactions/http'
import {migrateLegacyCreatorFeeSelection,parseVerifiedGitHubIndividual,resolveCreatorFeeRouting,parseResolvedCreatorFeeRouting,assertCreatorFeeRoutingAvailable} from '@/lib/creatorFeeRouting'
import {validatePumpLaunchPlan} from '@/lib/transactions/validatePumpLaunchPlan'
import {verifyCreatorFeeRoutingOnChain} from '@/lib/creatorFeeRecovery'
import {parseLaunchBundleSettings} from './types'
import {checkLaunchSigners,clonePackets,cloneCreatorPlan,cloneProtocolState,packetMessage,runtimeBundles,validateInitialPackets} from './internal'
import type {LaunchBundleGuards,LaunchBundleInput,LaunchBundlePorts,LaunchBundleReview,PreparedLaunchBundle,RuntimeLaunchBundle,InitialPacketPolicy} from './model'
export type {LaunchBundleInput,LaunchBundleGuards,LaunchBundleReview,PreparedLaunchBundle} from './model'

const defaults:LaunchBundlePorts={buildCreate:buildCreateTransaction,buildFreshBuy:buildFreshNativeBuy,buildBuy:buildNativeBuyTransaction,tip:createVerifiedJitoTipTransaction,simulate:simulateAtomicBundle,sendSingle:sendAndConfirmTransaction,sendBundle:submitAtomicBundle,verifyRouting:verifyCreatorFeeRoutingOnChain,now:Date.now,random:Math.random,wait:async(milliseconds,signal)=>{let remaining=milliseconds;while(remaining>0){throwIfAborted(signal);const gap=Math.min(remaining,250);await new Promise(resolve=>setTimeout(resolve,gap));remaining-=gap}throwIfAborted(signal)}}
const amount=(value:string|undefined,label:string)=>{if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error(`${label} could not be verified.`);return BigInt(value)}

/** Read-only native preparation. Metadata and the selected mint are never replaced. */
export async function prepareLaunchBundle(connection:Connection,raw:LaunchBundleInput,guards:LaunchBundleGuards,overrides:Partial<LaunchBundlePorts>={}):Promise<PreparedLaunchBundle>{
 const selection=migrateLegacyCreatorFeeSelection(raw.creatorFeeSelection),github=raw.githubRecipient===undefined?undefined:parseVerifiedGitHubIndividual(raw.githubRecipient)
 const input:LaunchBundleInput={...raw,payer:new PublicKey(raw.payer).toBase58(),mintKeypair:Keypair.fromSecretKey(new Uint8Array(raw.mintKeypair.secretKey)),metadata:{...raw.metadata},settings:parseLaunchBundleSettings(raw.settings),creatorFeeSelection:selection,githubRecipient:github},ports={...defaults,...overrides}
 const routing=resolveCreatorFeeRouting({selection,payer:input.payer,mint:input.mintKeypair.publicKey.toBase58(),github})
 if(!Number.isFinite(input.slippage)||input.slippage<0.1||input.slippage>50||!Number.isFinite(input.priorityFeeSol)||input.priorityFeeSol<0||input.priorityFeeSol>0.01||!Number.isFinite(input.jitoTipSol)||input.jitoTipSol<0||input.jitoTipSol>0.1)throw new Error('Check slippage, priority fee and bundle tip limits.')
 const developerBudget=solToLamports(input.devBuySol),tipBudget=solToLamports(input.jitoTipSol),buyers=input.settings.wallets.filter(wallet=>wallet.buySol>0)
 if(developerBudget>1_000_000_000_000n)throw new Error('The developer buy must be 0–1,000 SOL.')
 if(buyers.some(wallet=>wallet.publicKey===input.payer))throw new Error('The creator and buyer wallets must have unique identities.')
 if(input.settings.mode==='block0'&&tipBudget<1000n)throw new Error('Block-0 requires an approved validator tip of at least 0.000001 SOL.')
 const check=()=>{checkLaunchSigners(input,guards);guards.assertAvailable?.()}
 check()
 const built=await ports.buildCreate({connection,userPublicKey:input.payer,mintKeypair:input.mintKeypair,metadata:{name:input.metadata.name,symbol:input.metadata.symbol,description:''},metadataUri:input.metadata.uri,initialBuyAmount:input.devBuySol,slippage:input.slippage,priorityFee:input.priorityFeeSol,jitoTipLamports:Number(tipBudget),creatorFeeSelection:selection,githubRecipient:github,separateJitoTip:true});check()
 if(!built.success||!built.launchPlan||!built.nativeContext||built.metadataUri!==input.metadata.uri)throw new Error(built.error||'The selected native launch plan could not be verified.')
 validatePumpLaunchPlan(built.launchPlan)
 const creatorPlan=cloneCreatorPlan(built.launchPlan),contextMatches=(context:NonNullable<typeof built.nativeContext>)=>{
  if(!context.routing||JSON.stringify(parseResolvedCreatorFeeRouting(context.routing))!==JSON.stringify(routing)||context.effectiveCreator!==routing.effectiveCreator||context.curve.creator.toBase58()!==routing.effectiveCreator||context.curve.isHolderReward!==routing.holderReward||context.curve.isCashbackCoin!==false||context.curve.isMayhemMode!==false||!context.tokenProgram.equals(TOKEN_2022_PROGRAM_ID))throw new Error('The native launch context differs from the reviewed creator fee routing.')
  assertCreatorFeeRoutingAvailable(routing,context.global)
 }
 let context=cloneProtocolState(built.nativeContext);contextMatches(context)
 const recipients=[...new Set([context.global.feeRecipient,...context.global.feeRecipients].filter(key=>!key.equals(PublicKey.default)).map(key=>key.toBase58()))]
 if(JSON.stringify(creatorPlan.routing)!==JSON.stringify(routing)||['name','symbol','uri'].some(key=>creatorPlan.metadata[key as keyof typeof creatorPlan.metadata]!==input.metadata[key as keyof typeof input.metadata])||creatorPlan.maxBuyLamports!==developerBudget.toString()||creatorPlan.maxPriorityFeeLamports!==solToLamports(input.priorityFeeSol).toString()||creatorPlan.firstBuyTokenAmountRaw!==built.tokenAmountRaw||creatorPlan.firstBuyTokenAmountRaw!==context.tokenAmount.toString()||JSON.stringify(creatorPlan.protocolFeeRecipients)!==JSON.stringify(recipients)||creatorPlan.requiresAtomicBundle!==!!built.requiresAtomicBundle||(built.creatorFeeRouting&&JSON.stringify(parseResolvedCreatorFeeRouting(built.creatorFeeRouting))!==JSON.stringify(routing)))throw new Error('The native launch plan differs from the approved recipient, mint, metadata or amounts.')
 if(built.transactions&&(built.transactions.length!==creatorPlan.packets.length||built.transactions.some((tx,index)=>packetMessage(tx)!==packetMessage(creatorPlan.packets[index]))))throw new Error('The native compatibility packets differ from the validated launch plan.')
 if(creatorPlan.requiresAtomicBundle&&(creatorPlan.separateJitoTip!==true||creatorPlan.jitoTipLamports!==tipBudget.toString()||JSON.stringify(creatorPlan.stepsByPacket.at(-1))!==JSON.stringify(['validator-tip'])))throw new Error('The native atomic launch must reserve an exact final validator-tip packet.')
 const atomic=input.settings.mode==='block0'||creatorPlan.requiresAtomicBundle
 const creatorPacketCount=creatorPlan.packets.length-(creatorPlan.requiresAtomicBundle?1:0)
 const packets=clonePackets(creatorPlan.packets.slice(0,creatorPacketCount))
 const policies:InitialPacketPolicy[]=packets.map((_,index)=>({kind:index===0?'create':'developer-buy',payer:input.payer,maxSolLamports:index===0&&packets.length>1?0n:developerBudget}))
 if(!packets.length||packets.length>4)throw new Error('The native launch plan exceeds the atomic packet capacity.')
 const blockhash=packets[0].message.recentBlockhash
 if(input.settings.mode==='block0')for(const wallet of buyers){
  if(packets.length+2>5)throw new Error('This metadata leaves insufficient atomic packet capacity. Reduce immediate buyers or shorten the metadata URI.')
  const next=await ports.buildFreshBuy({context:cloneProtocolState(context),mint:input.mintKeypair.publicKey,payer:new PublicKey(wallet.publicKey),metadata:{...input.metadata},maxBuyLamports:solToLamports(wallet.buySol),blockhash,priorityFee:input.priorityFeeSol});check()
  context=cloneProtocolState(next.context);contextMatches(context);packets.push(clonePackets([next.transaction])[0]);policies.push({kind:'buyer-buy',payer:wallet.publicKey,maxSolLamports:solToLamports(wallet.buySol),buyerId:wallet.walletId})
 }
 if(atomic){if(tipBudget<1000n)throw new Error('This launch requires an atomic bundle and a nonzero approved tip reserve.');packets.push(await ports.tip(connection,new PublicKey(input.payer),blockhash,Number(tipBudget)));check();policies.push({kind:'tip',payer:input.payer,maxSolLamports:0n})}
 const createdAt=ports.now(),review:LaunchBundleReview={payer:input.payer,mint:input.mintKeypair.publicKey.toBase58(),mode:input.settings.mode,metadataUri:input.metadata.uri,createdAt,expiresAt:createdAt+60_000,blockhash,atomic,packetCount:packets.length,creatorDebitLamports:'0',initialDebitLamports:'0',totalRequirementLamports:'0',networkFeeLamports:'0',jitoTipLamports:atomic?tipBudget.toString():'0',wallets:[],followups:[],creatorFeeRouting:parseResolvedCreatorFeeRouting(routing)}
 const state:RuntimeLaunchBundle={connection,input,mint:input.mintKeypair,review,packets,messages:packets.map(packetMessage),policies,ports,used:false,creatorPlan,creatorPacketCount}
 validateInitialPackets(state,packets)
 const addresses=[input.payer,...buyers.map(wallet=>wallet.publicKey)]
 const simulationPackets=clonePackets(packets)
 const simulated=await ports.simulate(connection,simulationPackets,{payer:input.payer,accounts:addresses,signal:guards.signal});check()
 if(simulationPackets.length!==state.messages.length||simulationPackets.some((tx,index)=>packetMessage(tx)!==state.messages[index]))throw new Error('The simulated launch message changed. Prepare again.')
 if(!simulated.success||!simulated.walletDebitsLamports)throw new Error(simulated.error||'The complete participating wallet costs could not be verified.')
 const debits=simulated.walletDebitsLamports
 review.creatorDebitLamports=amount(debits[input.payer],'Creator debit').toString()
 review.initialDebitLamports=addresses.reduce((total,address)=>total+amount(debits[address],'Wallet debit'),0n).toString()
 const fees=await Promise.all(packets.map(tx=>withTimeout(connection.getFeeForMessage(tx.message,'confirmed'))));check()
 if(fees.some(fee=>fee.value===null||!Number.isSafeInteger(fee.value)||fee.value!<0))throw new Error('The initial network fees could not be verified.')
 review.networkFeeLamports=fees.reduce((total,fee)=>total+BigInt(fee.value!),0n).toString()
 if(BigInt(review.initialDebitLamports)<BigInt(review.networkFeeLamports)+BigInt(review.jitoTipLamports))throw new Error('The simulated launch costs omit network fees or the validator tip.')
 review.wallets=buyers.map(wallet=>{const initialDebit=amount(debits[wallet.publicKey],'Buyer debit'),reserve=input.settings.mode==='block0'?0n:10_000_000n+solToLamports(input.priorityFeeSol);if(input.settings.mode!=='block0'&&initialDebit!==0n)throw new Error('A future buyer was unexpectedly charged during creation.');return {...wallet,initialDebitLamports:initialDebit.toString(),followupReserveLamports:reserve.toString(),requiredLamports:(input.settings.mode==='block0'?initialDebit:solToLamports(wallet.buySol)+reserve).toString()}})
 review.followups=input.settings.mode==='block0'?[]:review.wallets.map(wallet=>({...wallet}))
 review.totalRequirementLamports=(BigInt(review.creatorDebitLamports)+review.wallets.reduce((total,wallet)=>total+BigInt(wallet.requiredLamports),0n)).toString()
 await Promise.all([{address:input.payer,required:review.creatorDebitLamports},...review.wallets.map(wallet=>({address:wallet.publicKey,required:wallet.requiredLamports}))].map(async row=>{const balance=await withTimeout(connection.getBalance(new PublicKey(row.address),'confirmed'));check();if(!Number.isSafeInteger(balance)||BigInt(balance)<BigInt(row.required))throw new Error(`Wallet ${row.address.slice(0,6)} has insufficient SOL for its reviewed requirement.`)}));check()
 const prepared:PreparedLaunchBundle={review:structuredClone(review),transactions:clonePackets(packets),expectedMessages:[...state.messages],followups:structuredClone(review.followups),creatorLaunchPlan:cloneCreatorPlan(creatorPlan)}
 runtimeBundles.set(prepared,state)
 return prepared
}
