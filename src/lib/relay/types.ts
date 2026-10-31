import type {VersionedTransaction} from '@solana/web3.js'
import type {WalletOperationStorage} from '@/lib/walletOperations/history'
import type {WalletOperationLocks} from '@/lib/walletOperations/recovery'

/** saleEligible means a verified candidate; a quote and complete simulation are still required. */
export interface RelayAsset {account:string;mint:string;tokenProgram:string;amountRaw:string;decimals:number;eligible:boolean;saleEligible?:boolean;reason?:string}
export interface RelayWalletScan {owner:string;solLamports:string;assets:RelayAsset[];scannedAt:string}
export interface RelayTransferInput {source:string;destination:string;mint:string;sourceAccount:string;tokenProgram:string;amountRaw:string;decimals:number;priorityFeeLamports?:string}
export interface RelayTransferPreview {sourceBeforeLamports:string;sourceAfterLamports:string;networkFeeLamports:string;destinationRentLamports:string;maxDebitLamports:string;sourceTokenBeforeRaw:string;sourceTokenAfterRaw:string;destinationBeforeRaw:string;destinationAfterRaw:string}
export interface PreparedRelayTransfer {input:RelayTransferInput;preview:RelayTransferPreview;createdAt:number;blockhash:string;lastValidBlockHeight:number}
export interface RelayReceipt extends RelayTransferInput {signature:string;blockhash:string;lastValidBlockHeight:number;genesisHash:string;createdAt:string;status:'submitted'|'confirmed'|'failed'|'unknown';debitLamports:string;error?:string;resolvedAt?:string}
export interface RelayExecutionOptions {approved:boolean;readSigner:()=>string|null|undefined;sign:(transaction:VersionedTransaction)=>Promise<VersionedTransaction>;assertAvailable?:()=>void;signal?:AbortSignal;storage?:WalletOperationStorage;locks?:WalletOperationLocks;onChange?:(receipt:RelayReceipt)=>void;timeoutMs?:number;pollIntervalMs?:number}
export interface RelayRoute {id:string;name:string;sourceWalletId:string;destinationWalletId:string;createdAt:string;updatedAt:string}
export interface RelayRouteWallet {id:string;publicKey?:string;address?:string}
