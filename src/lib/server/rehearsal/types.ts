/** Public data only. Never add wallet keys, signed packets, or provider URLs. */
import type {CreatorFeeSelection,ResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
export interface RehearsalInput {
  name: string
  symbol: string
  metadataUri: string
  initialBuySol: string
  priorityFeeSol: string
  jitoTipSol: string
  creatorFeeSelection?: CreatorFeeSelection
}

export interface RehearsalReport {
  network: 'local-mainnet-fork'
  runtimeVersion: '1.6.1'
  mint: string
  payer: string
  name: string
  symbol: string
  metadataUri: string
  decimals: number
  supplyRaw: string
  walletTokenRaw: string
  payerBeforeLamports: string
  payerAfterLamports: string
  totalCostLamports: string
  networkFeeLamports: string
  initialBuyLamports: string
  initialBuyBudgetLamports: string
  jitoTipLamports: string
  platformFeeLamports: '0'
  curveRealSolReservesLamports: string
  curveRealTokenReservesRaw: string
  mintAuthority: null
  freezeAuthority: null
  metadataImmutable: true
  transactionSignatures: string[]
  execution: 'single' | 'atomic-bundle'
  unsupported: { devLock: 'not-configured'; lp: 'not-configured' }
  actualCostBreakdownNote: string
  completedAt: string
  /** Absent only for saved reports predating explicit routing verification. */
  creatorFeeRouting?: ResolvedCreatorFeeRouting
  observedRouting?: { creator:string;isHolderReward:boolean;isCashbackCoin:false;sharing?:{address:string;adminRevoked:true;shareholder:string;shareBps:10000};verifiedRecipient:string }
}

export type RehearsalStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface RehearsalJob {
  id: string
  status: RehearsalStatus
  createdAt: string
  expiresAt: string
  result?: RehearsalReport
  error?: string
}
