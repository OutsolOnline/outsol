import type {Connection,Keypair,VersionedTransaction} from '@solana/web3.js'
import type {buildCreateTransaction,buildFreshNativeBuy,buildNativeBuyTransaction} from '@/lib/pumpfun/api'
import type {createVerifiedJitoTipTransaction,simulateAtomicBundle,submitAtomicBundle} from '@/lib/bundler/jito'
import type {sendAndConfirmTransaction} from '@/lib/transactions/send'
import type {BundleResult} from '@/lib/bundler/types'
import type {PendingLaunch} from '@/lib/launchHistory'
import type {LaunchBundleSettings,LaunchBundleWallet} from './types'
import type {CreatorFeeSelection,VerifiedGitHubIndividual,ResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import type {NativePumpLaunchPlan} from '@/lib/transactions/validatePumpLaunchPlan'
import type {verifyCreatorFeeRoutingOnChain} from '@/lib/creatorFeeRecovery'

export interface LaunchBundleInput {payer:string;mintKeypair:Keypair;metadata:{name:string;symbol:string;uri:string};devBuySol:number;slippage:number;priorityFeeSol:number;jitoTipSol:number;settings:LaunchBundleSettings;creatorFeeSelection?:CreatorFeeSelection;githubRecipient?:VerifiedGitHubIndividual}
export interface LaunchBundleGuards {readSigner:()=>string|null|undefined;readBuyer:(walletId:string)=>Keypair|null;signal?:AbortSignal;assertAvailable?:()=>void}
export interface LaunchBundleWalletReview extends LaunchBundleWallet {initialDebitLamports:string;followupReserveLamports:string;requiredLamports:string}
export interface LaunchBundleReview {
 payer:string;mint:string;mode:LaunchBundleSettings['mode'];metadataUri:string;createdAt:number;expiresAt:number;blockhash:string;atomic:boolean;packetCount:number;
 creatorDebitLamports:string;initialDebitLamports:string;totalRequirementLamports:string;networkFeeLamports:string;jitoTipLamports:string;wallets:LaunchBundleWalletReview[];followups:LaunchBundleWalletReview[]
 creatorFeeRouting:ResolvedCreatorFeeRouting
}
/** Public inspection copies. Runtime keys and canonical packets are held separately. */
export interface PreparedLaunchBundle {review:LaunchBundleReview;transactions:VersionedTransaction[];expectedMessages:string[];followups:LaunchBundleWalletReview[];creatorLaunchPlan:NativePumpLaunchPlan}
export interface LaunchBundlePorts {
 buildCreate:typeof buildCreateTransaction;buildFreshBuy:typeof buildFreshNativeBuy;buildBuy:typeof buildNativeBuyTransaction;tip:typeof createVerifiedJitoTipTransaction;simulate:typeof simulateAtomicBundle;
 sendSingle:typeof sendAndConfirmTransaction;sendBundle:typeof submitAtomicBundle;now:()=>number;wait:(milliseconds:number,signal?:AbortSignal)=>Promise<void>;random:()=>number
 verifyRouting:typeof verifyCreatorFeeRoutingOnChain
}
export interface LaunchBundleExecutionOptions extends LaunchBundleGuards {
 approved:true;signCreator:(packets:VersionedTransaction[])=>Promise<VersionedTransaction[]>;
 onInitialBroadcast:(pending:PendingLaunch)=>void;onInitialConfirmed:(pending:PendingLaunch)=>void;onInitialNotSubmitted?:(pending:PendingLaunch)=>void;
 onReceipt:(receipt:BundleResult)=>void;onProgress?:(message:string)=>void
}
export interface InitialPacketPolicy {kind:'create'|'developer-buy'|'buyer-buy'|'tip';payer:string;maxSolLamports:bigint;buyerId?:string}
export interface RuntimeLaunchBundle {connection:Connection;input:LaunchBundleInput;mint:Keypair;review:LaunchBundleReview;packets:VersionedTransaction[];messages:string[];policies:InitialPacketPolicy[];ports:LaunchBundlePorts;used:boolean;creatorPlan:NativePumpLaunchPlan;creatorPacketCount:number}
