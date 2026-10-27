import {Keypair,Transaction,PublicKey} from '@solana/web3.js'
import {NATIVE_MINT} from '@solana/spl-token'
import {ActivationType,BaseFeeMode,buildCurve,CollectFeeMode,DynamicBondingCurveClient,DYNAMIC_BONDING_CURVE_PROGRAM_ID,DAMM_V2_PROGRAM_ID,deriveDbcPoolAddress,getQuoteFromInputAmount,MigrationFeeOption,MigrationOption,PROTOCOL_FEE_PERCENT,PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,TokenAuthorityOption,TokenDecimal,TokenType,type ConfigParameters} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import {withTimeout} from '@/lib/transactions/http'
import {packVenueTransactions,validateVenueInput} from './utils'
import type {VenueLaunchInput,VenueLaunchPlan} from './types'

/** Creator owns all non-protocol fees and permanently locked migrated liquidity.
 * No Vanity partner, fee receiver, creation fee or referral is configured.
 */
export function buildMeteoraCurveConfig():ConfigParameters{
  return buildCurve({
    token:{tokenType:TokenType.SPLToken,tokenBaseDecimal:TokenDecimal.SIX,tokenQuoteDecimal:TokenDecimal.NINE,tokenAuthorityOption:TokenAuthorityOption.Immutable,totalTokenSupply:1_000_000_000,leftover:0},
    fee:{baseFeeParams:{baseFeeMode:BaseFeeMode.FeeSchedulerLinear,feeSchedulerParam:{startingFeeBps:25,endingFeeBps:25,numberOfPeriod:0,totalDuration:0}},dynamicFeeEnabled:false,collectFeeMode:CollectFeeMode.QuoteToken,creatorTradingFeePercentage:100,poolCreationFee:0,enableFirstSwapWithMinFee:false},
    migration:{migrationOption:MigrationOption.MET_DAMM_V2,migrationFeeOption:MigrationFeeOption.FixedBps25,migrationFee:{feePercentage:0,creatorFeePercentage:0}},
    liquidityDistribution:{partnerLiquidityPercentage:0,partnerPermanentLockedLiquidityPercentage:0,creatorLiquidityPercentage:0,creatorPermanentLockedLiquidityPercentage:100},
    lockedVesting:{totalLockedVestingAmount:0,numberOfVestingPeriod:0,cliffUnlockAmount:0,totalVestingDuration:0,cliffDurationFromMigrationTime:0},
    activationType:ActivationType.Timestamp,percentageSupplyOnMigration:20,migrationQuoteThreshold:85,
  })
}

export function quoteMeteoraInitialBuy(config:ConfigParameters,buyLamports:bigint,slippage:number){
  if(buyLamports<=0n||buyLamports>=BigInt(config.migrationQuoteThreshold.toString()))throw new Error('Initial buy must be positive and below the graduation threshold')
  if(!Number.isFinite(slippage)||slippage<0||slippage>50)throw new Error('Invalid slippage')
  const quote=getQuoteFromInputAmount({config,swapBaseForQuote:false,amountIn:new BN(buyLamports.toString()),hasReferral:false,slippageBps:Math.floor(slippage*100),eligibleForFirstSwapWithMinFee:false})
  if(!quote.minimumAmountOut||quote.minimumAmountOut.isZero())throw new Error('Initial buy is too small for a minimum token output')
  if(BigInt(quote.includedTransferFeeAmountIn.toString())>buyLamports)throw new Error('Quote exceeds the maximum initial buy budget')
  return {...quote,minimumAmountOut:quote.minimumAmountOut}
}

export async function buildMeteoraPlan(input:VenueLaunchInput&{venue:'meteora-dbc'}):Promise<VenueLaunchPlan>{
  const {buyLamports,priorityLamports}=validateVenueInput(input),{connection,payer}=input
  const [genesis,accounts,{blockhash},rents]=await Promise.all([
    withTimeout(connection.getGenesisHash()),withTimeout(connection.getMultipleAccountsInfo([DYNAMIC_BONDING_CURVE_PROGRAM_ID,DAMM_V2_PROGRAM_ID,input.mintKeypair.publicKey],'confirmed')),
    withTimeout(connection.getLatestBlockhash('confirmed')),Promise.all([4096,679,165].map(space=>withTimeout(connection.getMinimumBalanceForRentExemption(space,'confirmed')))),
  ])
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Meteora DBC is supported on Solana mainnet only')
  if(accounts.slice(0,2).some(account=>!account?.executable||!['BPFLoaderUpgradeab1e11111111111111111111111','BPFLoader2111111111111111111111111111111111'].includes(account.owner.toBase58())))throw new Error('The canonical Meteora DBC or DAMM v2 program is missing or invalid')
  if(accounts[2])throw new Error('This mint already exists; prepare a fresh mint')
  const curve=buildMeteoraCurveConfig(),config=Keypair.generate(),client=new DynamicBondingCurveClient(connection,'confirmed')
  const params={...curve,config:config.publicKey,feeClaimer:payer,leftoverReceiver:payer,quoteMint:NATIVE_MINT,payer,transferFeeParameters:null,preCreatePoolParam:{name:input.name,symbol:input.symbol,uri:input.metadataUri,poolCreator:payer,baseMint:input.mintKeypair.publicKey}}
  let instructions:Transaction['instructions'],minimumAmount='0'
  if(buyLamports>0n){
    const quote=quoteMeteoraInitialBuy(curve,buyLamports,input.slippage)
    minimumAmount=quote.minimumAmountOut.toString()
    const built=await withTimeout(client.partner.createConfigAndPoolWithFirstBuy({...params,firstBuyParam:{buyer:payer,receiver:payer,buyAmount:new BN(buyLamports.toString()),minimumAmountOut:quote.minimumAmountOut,referralTokenAccount:null}}))
    instructions=[...built.createConfigTx.instructions,...built.createPoolWithFirstBuyTx.instructions]
  }else instructions=(await withTimeout(client.partner.createConfigAndPool(params))).instructions
  const transactions=packVenueTransactions(instructions,payer,blockhash,priorityLamports,input.jitoTipLamports)
  const requiresAtomicBundle=transactions.length>1,tip=requiresAtomicBundle?input.jitoTipLamports:0
  // 4096-byte allowances bound config/pool rent above the current accounts.
  // The complete simulation provides the actual debit before wallet signing.
  const estimatedTotalSolLamports=(buyLamports+BigInt(rents[0]*2+rents[1]+rents[2]*6)+priorityLamports+BigInt(tip)+BigInt(transactions.length*15_000)).toString()
  if(BigInt(await withTimeout(connection.getBalance(payer,'confirmed')))<BigInt(estimatedTotalSolLamports))throw new Error('Insufficient SOL for native DBC accounts, initial buy and network costs')
  return {transactions,signers:[input.mintKeypair,config],mint:input.mintKeypair.publicKey,blockhash,requiresAtomicBundle,estimatedTotalSolLamports,venue:'meteora-dbc',poolAddress:deriveDbcPoolAddress(NATIVE_MINT,input.mintKeypair.publicKey,config.publicKey),summary:{platformFeeBps:0,protocolFeeRate:String(25*PROTOCOL_FEE_PERCENT/100),venueFeeRate:'0',creatorFeeRate:String(25*(100-PROTOCOL_FEE_PERCENT)/100),feeRateDenominator:'10000',initialBuyLamports:buyLamports.toString(),minimumTokenAmount:minimumAmount,jitoTipLamports:String(tip),protocolMigrationFeeBps:PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,migrationVenue:'Meteora DAMM v2',creatorPermanentLockedLiquidityPercent:100,supplyRaw:'1000000000000000',decimals:6,configAddress:config.publicKey.toBase58()}}
}
