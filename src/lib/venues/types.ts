import type {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'

export type NativeVenue='raydium-launchlab'|'bonk'|'meteora-dbc'
export interface VenueLaunchInput {
  connection:Connection
  venue:NativeVenue
  payer:PublicKey
  mintKeypair:Keypair
  name:string
  symbol:string
  metadataUri:string
  initialBuySol:number
  slippage:number
  priorityFeeSol:number
  jitoTipLamports:number
}
export interface VenueLaunchPlan {
  transactions:VersionedTransaction[]
  signers:Keypair[]
  mint:PublicKey
  blockhash:string
  requiresAtomicBundle:boolean
  estimatedTotalSolLamports:string
  venue:NativeVenue
  poolAddress?:PublicKey
  summary:{platformFeeBps:0;protocolFeeRate:string;venueFeeRate:string;creatorFeeRate:string;feeRateDenominator:string;initialBuyLamports:string;minimumTokenAmount:string;jitoTipLamports:string;[key:string]:string|number}
}
