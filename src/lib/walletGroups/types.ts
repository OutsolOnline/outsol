import type { VersionedTransaction } from '@solana/web3.js'
import type { PreparedWalletOperation } from '../walletOperations/builder'
import type { WalletOperationIntent } from '../walletOperations/model'
import type { WalletOperationLocks } from '../walletOperations/recovery'

export interface GroupWallet { id: string; name: string; address: string }
interface GroupInput { groupId?: string; groupName: string; wallets: GroupWallet[]; priorityFeeSol: string }
export type PrepareGroupInput = GroupInput & (
  { kind: 'fund'; payer: string; amountSol: string } |
  { kind: 'withdraw'; destination: string; amountMode: 'available' | 'fixed'; amountSol?: string; reserveSol: string }
)
export interface GroupPreviewRow {
  walletId: string; name: string; address: string; beforeLamports: string; afterLamports: string
  transferLamports: string; networkFeeLamports: string; status: 'ready' | 'skipped'; reason?: string
}
export interface GroupSummary {
  walletCount: number; transactionCount: number; totalTransferLamports: string; totalNetworkFeeLamports: string
  platformFeeLamports: '0'; reserveLamports: string; payerBeforeLamports?: string; payerAfterLamports?: string
  destinationBeforeLamports?: string; destinationAfterLamports?: string
}
export interface PreparedGroupOperation {
  id: string; kind: 'fund' | 'withdraw'; groupId?: string; groupName: string; createdAt: number; expiresAt: number
  transactions: PreparedWalletOperation[]; rows: GroupPreviewRow[]; summary: GroupSummary
}
export type GroupPacketStatus = 'ready' | 'submitted' | 'confirmed' | 'failed' | 'unknown' | 'not-submitted'
export interface GroupPacketRecord {
  index: number; intent: WalletOperationIntent; payerBeforeLamports: string; payerAfterLamports: string
  networkFeeLamports: string; status: GroupPacketStatus; signature?: string; blockhash?: string
  lastValidBlockHeight?: number; submittedAt?: string; error?: string
}
export interface GroupOperationRecord {
  version: 1; id: string; kind: 'fund' | 'withdraw'; groupId?: string; groupName: string; createdAt: string
  updatedAt: string; status: 'running' | 'confirmed' | 'partial' | 'failed' | 'unknown' | 'cancelled'
  packets: GroupPacketRecord[]; skipped: GroupPreviewRow[]; summary: GroupSummary; error?: string
}
export interface GroupOperationStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface GroupSubmissionOptions {
  approved: boolean; canSign(payer: string): boolean; signTransaction(payer: string, transaction: VersionedTransaction): Promise<VersionedTransaction>
  assertAvailable(): void; signal?: AbortSignal; storage?: GroupOperationStorage; locks?: WalletOperationLocks
  onProgress?(record: GroupOperationRecord): void; timeoutMs?: number; pollIntervalMs?: number
}
