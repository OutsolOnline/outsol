import { Keypair, VersionedTransaction, Connection, PublicKey, TransactionInstruction, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, getAccount, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { OnlinePumpSdk, PUMP_SDK, PUMP_FEE_PROGRAM_ID, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, newBondingCurve, type Global, type FeeConfig, type BondingCurve } from '@pump-fun/pump-sdk'
import BN from 'bn.js'
import { getRpcEndpoint } from '@/lib/rpc'
import { fetchBounded, withTimeout } from '@/lib/transactions/http'
import { validatePumpTransaction } from '@/lib/transactions/validatePumpTransaction'
import { sendAndConfirmTransaction } from '@/lib/transactions/send'
import { createVerifiedJitoTipTransaction } from '@/lib/bundler/jito'
import {resolveCreatorFeeRouting,parseResolvedCreatorFeeRouting,migrateLegacyCreatorFeeSelection,assertCreatorFeeRoutingAvailable,type SupportedCreatorFeeSelection,type VerifiedGitHubIndividual,type ResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import {validatePumpLaunchPlan,type NativePumpLaunchPlan,type NativePumpLaunchStep} from '@/lib/transactions/validatePumpLaunchPlan'

// Use our own API route to proxy to Pump.fun (avoids CORS)
const IPFS_PROXY_API = '/api/ipfs'

export interface PumpPortalTokenMetadata {
  name: string
  symbol: string
  description: string
  image?: File | Blob
  twitter?: string
  telegram?: string
  website?: string
}

export interface PumpPortalCreateParams {
  metadata: PumpPortalTokenMetadata
  bannerFile?: File | Blob
  mintKeypair: Keypair
  userPublicKey: string
  initialBuyAmount?: number // SOL amount for initial buy (0 = no initial buy)
  slippage?: number
  priorityFee?: number
  connection?: Connection
  metadataUri?: string
  /** Used only when oversized metadata requires an atomic create + buy bundle. */
  jitoTipLamports?: number
  creatorFeeSelection?: SupportedCreatorFeeSelection
  githubRecipient?: VerifiedGitHubIndividual
  /** Atomic consumers adding buyers reserve a removable final tip-only packet. */
  separateJitoTip?: boolean
}

export interface PumpPortalCreateResult {
  success: boolean
  transaction?: VersionedTransaction
  /** Complete ordered packet array, including the real Jito tip for split mode. */
  transactions?: VersionedTransaction[]
  requiresAtomicBundle?: boolean
  jitoTipLamports?: string
  priorityFeeLamports?: string
  metadataUri?: string
  error?: string
  tokenAmountRaw?: string
  nativeContext?: NativeLaunchContext
  creatorFeeRouting?: ResolvedCreatorFeeRouting
  launchPlan?: NativePumpLaunchPlan
}

export interface NativeLaunchContext {
  global: Global
  feeConfig: FeeConfig | null
  curve: BondingCurve
  tokenAmount: BN
  tokenProgram: PublicKey
  routing?: ResolvedCreatorFeeRouting
  effectiveCreator?: string
}

export function solToLamports(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error('Invalid SOL amount')
  const lamports = Math.round(amount * 1e9)
  if (!Number.isSafeInteger(lamports)) throw new Error('SOL amount is too large')
  return BigInt(lamports)
}

function validateMetadata(metadata: {name:string;symbol:string;uri?:string}) {
  if (!metadata.name.trim() || Buffer.byteLength(metadata.name) > 32) throw new Error('Token name must be 1–32 UTF-8 bytes')
  if (!metadata.symbol.trim() || Buffer.byteLength(metadata.symbol) > 10) throw new Error('Token symbol must be 1–10 UTF-8 bytes')
  if (metadata.uri !== undefined && (!metadata.uri || Buffer.byteLength(metadata.uri) > 200)) throw new Error('Metadata URI must be 1–200 UTF-8 bytes')
}

function assertSlippage(slippage: number) {
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) throw new Error('Slippage must be between 0% and 50%')
}

function computeInstructions(priorityFee: number): TransactionInstruction[] {
  const lamports = solToLamports(priorityFee)
  return computeInstructionsFromLamports(lamports)
}

function computeInstructionsFromLamports(lamports: bigint): TransactionInstruction[] {
  if (lamports > 10_000_000n) throw new Error('Priority fee must not exceed 0.01 SOL')
  return [ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), ComputeBudgetProgram.setComputeUnitPrice({microLamports: lamports * 1_000_000n / 400_000n})]
}

function fitsPumpPacket(transaction: VersionedTransaction): boolean {
  try { return transaction.serialize().length <= 1232 } catch { return false }
}

/** Exact-output quote from the official SDK. Vanity adds no fee or referral. */
export async function buildNativeCreateInstructions(args: {
  global:Global; feeConfig:FeeConfig|null; payer:PublicKey; mint:PublicKey;
  metadata:{name:string;symbol:string;uri:string}; maxBuyLamports:bigint; routing?:ResolvedCreatorFeeRouting; githubSocialExists?:boolean
}): Promise<{instructions:TransactionInstruction[];tokenAmount:BN;curve:BondingCurve;platformFeeLamports:bigint}> {
  const {global,feeConfig,payer,mint,metadata,maxBuyLamports}=args
  const routing=args.routing===undefined?resolveCreatorFeeRouting({selection:{kind:'deployer'},payer:payer.toBase58(),mint:mint.toBase58()}):parseResolvedCreatorFeeRouting(args.routing)
  if(routing.payer!==payer.toBase58()||routing.mint!==mint.toBase58())throw new Error('Creator fee routing payer or mint differs from launch')
  assertCreatorFeeRoutingAvailable(routing,global)
  validateMetadata(metadata)
  if (maxBuyLamports < 0n) throw new Error('Invalid buy budget')
  const curve = newBondingCurve(global)
  curve.creator=new PublicKey(routing.effectiveCreator)
  curve.isMayhemMode=false
  curve.isCashbackCoin=false
  curve.isHolderReward=routing.holderReward
  const createArgs={mint,...metadata,creator:new PublicKey(routing.encodedCreator),user:payer,mayhemMode:false,cashback:false,holderReward:routing.holderReward}
  const setup:TransactionInstruction[]=[]
  if(routing.selection.kind==='github'){
    if(typeof args.githubSocialExists!=='boolean')throw new Error('GitHub social recipient state must be verified before creation')
    if(!args.githubSocialExists)setup.push(await PUMP_SDK.createSocialFeePda({payer,userId:routing.github!.userId,platform:2}))
    setup.push(await PUMP_SDK.createFeeSharingConfig({creator:payer,mint,pool:null}))
    setup.push(await PUMP_SDK.updateFeeSharesV2({authority:payer,mint,currentShareholders:[payer],newShareholders:[{address:new PublicKey(routing.socialRecipient!),shareBps:10000}],quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,bondingCurveComplete:false}))
  }
  if (maxBuyLamports === 0n) return {instructions:[await PUMP_SDK.createV2Instruction(createArgs),...setup],tokenAmount:new BN(0),curve,platformFeeLamports:0n}
  // The official first-buy builder adds 1% to its quote. Keep that within
  // the user's maximum input instead of silently increasing their spend.
  const quotedSol = new BN((maxBuyLamports * 100n / 101n).toString())
  const tokenAmount = getBuyTokenAmountFromSolAmount({global,feeConfig,mintSupply:global.tokenTotalSupply,bondingCurve:curve,amount:quotedSol,quoteMint:NATIVE_MINT})
  if (tokenAmount.isZero()) throw new Error('Buy amount is too small')
  const template=await PUMP_SDK.createV2AndBuyInstructions({global,...createArgs,creator:new PublicKey(routing.selection.kind==='github'?routing.effectiveCreator:routing.encodedCreator),amount:tokenAmount,solAmount:quotedSol})
  const instructions=routing.selection.kind==='github'?[await PUMP_SDK.createV2Instruction(createArgs),...setup,...template.slice(1)]:template
  return {instructions,tokenAmount,curve:advanceNativeCurve(curve,tokenAmount),platformFeeLamports:0n}
}

/** Project only the trade's reserve movement, excluding protocol/creator fees. */
export function advanceNativeCurve(curve: BondingCurve, tokenAmount: BN): BondingCurve {
  if (tokenAmount.isZero()) return curve
  if (tokenAmount.gte(curve.realTokenReserves)) throw new Error('This launch would complete the curve; reduce the buy amount')
  const quoteIn=curve.virtualQuoteReserves.mul(tokenAmount).div(curve.virtualTokenReserves.sub(tokenAmount)).addn(1)
  return {...curve,virtualQuoteReserves:curve.virtualQuoteReserves.add(quoteIn),realQuoteReserves:curve.realQuoteReserves.add(quoteIn),virtualTokenReserves:curve.virtualTokenReserves.sub(tokenAmount),realTokenReserves:curve.realTokenReserves.sub(tokenAmount)}
}

export async function buildFreshNativeBuy(args: { context:NativeLaunchContext; mint:PublicKey; payer:PublicKey; metadata:{name:string;symbol:string;uri:string};maxBuyLamports:bigint;blockhash:string;priorityFee?:number }): Promise<{transaction:VersionedTransaction;context:NativeLaunchContext}> {
  const {context,mint,payer,metadata,maxBuyLamports,blockhash}=args
  if (maxBuyLamports <= 0n) throw new Error('Buy budget must be positive')
  const quotedSol=new BN((maxBuyLamports*100n/101n).toString())
  const amount=getBuyTokenAmountFromSolAmount({global:context.global,feeConfig:context.feeConfig,mintSupply:context.global.tokenTotalSupply,bondingCurve:context.curve,amount:quotedSol,quoteMint:NATIVE_MINT})
  if (amount.isZero()) throw new Error('Buy amount is too small')
  // The official create-and-buy builder supports a not-yet-created mint.
  // Keep its ATA and buy instructions; the bundle already creates the mint.
  if(context.effectiveCreator&&context.effectiveCreator!==context.curve.creator.toBase58())throw new Error('Launch context creator differs from reviewed routing')
  if(context.routing){const routing=parseResolvedCreatorFeeRouting(context.routing);if(routing.mint!==mint.toBase58()||routing.effectiveCreator!==context.curve.creator.toBase58()||routing.holderReward!==context.curve.isHolderReward)throw new Error('Launch context differs from reviewed creator fee routing')}
  const template=await PUMP_SDK.createV2AndBuyInstructions({global:context.global,mint,...metadata,creator:context.curve.creator,user:payer,amount,solAmount:quotedSol,mayhemMode:false,cashback:context.curve.isCashbackCoin,holderReward:context.curve.isHolderReward})
  const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[...computeInstructions(args.priorityFee??0.0005),...template.slice(1)]}).compileToV0Message())
  validatePumpTransaction(transaction,{action:'buy',payer,mint,maxSolLamports:maxBuyLamports,expectedBuyCreator:context.curve.creator})
  return {transaction,context:{...context,curve:advanceNativeCurve(context.curve,amount),tokenAmount:amount}}
}

export function buildCreateRequestBody(args: {
  userPublicKey: string
  metadata: Pick<PumpPortalTokenMetadata, 'name' | 'symbol'>
  metadataUri: string
  mint: string
  initialBuyAmount: number
  slippage: number
  priorityFee: number
}) {
  const {
    userPublicKey,
    metadata,
    metadataUri,
    mint,
    initialBuyAmount,
    slippage,
    priorityFee,
  } = args

  return {
    publicKey: userPublicKey,
    action: 'create',
    tokenMetadata: {
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadataUri,
    },
    mint,
    denominatedInSol: 'true',
    amount: initialBuyAmount,
    slippage,
    priorityFee,
    pool: 'pump',
  }
}

/**
 * Upload token metadata to Pump.fun's IPFS
 */
export async function uploadMetadataToIPFS(
  metadata: PumpPortalTokenMetadata,
  bannerFile?: File | Blob
): Promise<{ success: boolean; metadataUri?: string; metadata?: { name?: string; symbol?: string }; error?: string }> {
  try {
    const formData = new FormData()
    
    if (metadata.image) {
      formData.append('file', metadata.image, 'image.png')
    } else if (bannerFile) {
      formData.append('file', bannerFile, 'image.png')
    }
    
    formData.append('name', metadata.name)
    formData.append('symbol', metadata.symbol)
    formData.append('description', metadata.description || '')
    formData.append('showName', 'true')
    
    if (metadata.twitter) {
      formData.append('twitter', metadata.twitter)
    }
    if (metadata.telegram) {
      formData.append('telegram', metadata.telegram)
    }
    if (metadata.website) {
      formData.append('website', metadata.website)
    }

    validateMetadata(metadata)
    const result = await fetchBounded(IPFS_PROXY_API, { method:'POST', body:formData }, response => response.json())
    
    if (!result.metadataUri) {
      throw new Error('No metadataUri in response')
    }

    return {
      success: true,
      metadataUri: result.metadataUri,
      metadata: result.metadata,
    }
  } catch (error) {
    console.error('Error uploading to IPFS:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload metadata',
    }
  }
}

/**
 * Build locally through the official Pump SDK; no trading provider fee.
 */
export async function buildCreateTransaction(
  params: PumpPortalCreateParams
): Promise<PumpPortalCreateResult> {
  try {
    const { metadata, bannerFile, mintKeypair, userPublicKey, initialBuyAmount = 0, slippage = 10, priorityFee = 0.0005 } = params
    if(params.separateJitoTip!==undefined&&typeof params.separateJitoTip!=='boolean')throw new Error('Invalid validator tip placement policy')
    const payer=new PublicKey(userPublicKey)
    const routing=resolveCreatorFeeRouting({selection:migrateLegacyCreatorFeeSelection(params.creatorFeeSelection),payer:payer.toBase58(),mint:mintKeypair.publicKey.toBase58(),github:params.githubRecipient})

    // Step 1: Upload metadata to IPFS
    const ipfsResult = params.metadataUri ? {success:true,metadataUri:params.metadataUri} : await uploadMetadataToIPFS(metadata, bannerFile)
    
    if (!ipfsResult.success || !ipfsResult.metadataUri) {
      return {
        success: false,
        error: ipfsResult.error || 'Failed to upload metadata',
      }
    }

    assertSlippage(slippage)
    const maxSolLamports=solToLamports(initialBuyAmount)
    const connection=params.connection??new Connection(getRpcEndpoint(),'confirmed')
    const online=new OnlinePumpSdk(connection)
    const [global,feeConfig,{blockhash}]=await Promise.all([withTimeout(online.fetchGlobal()),withTimeout(online.fetchFeeConfig()),withTimeout(connection.getLatestBlockhash('confirmed'))])
    const expectedMetadata={name:metadata.name,symbol:metadata.symbol,uri:ipfsResult.metadataUri}
    if(routing.selection.kind==='wallet'){
      const recipientInfo=await withTimeout(connection.getAccountInfo(new PublicKey(routing.effectiveCreator),'confirmed'))
      if(recipientInfo?.executable)throw new Error('Creator fee recipient is an executable program, not a Solana wallet')
    }
    let githubSocialExists:boolean|undefined
    if(routing.selection.kind==='github'){
      const socialInfo=await withTimeout(connection.getAccountInfo(new PublicKey(routing.socialRecipient!),'confirmed'))
      githubSocialExists=!!socialInfo
      if(socialInfo){
        if(socialInfo.executable||!socialInfo.owner.equals(PUMP_FEE_PROGRAM_ID))throw new Error('GitHub social recipient has an unexpected account owner')
        const social=PUMP_SDK.decodeSocialFeePda(socialInfo)
        if(social.platform!==2||social.userId!==routing.github!.userId)throw new Error('GitHub social recipient identity differs from the verified individual')
      }
    }
    const native=await buildNativeCreateInstructions({global,feeConfig,payer,mint:mintKeypair.publicKey,metadata:expectedMetadata,maxBuyLamports:maxSolLamports,routing,githubSocialExists})
    const priorityLamports=solToLamports(priorityFee)
    const compile=(instructions:TransactionInstruction[],fee:bigint)=>new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[...computeInstructionsFromLamports(fee),...instructions]}).compileToV0Message())
    const steps:NativePumpLaunchStep[]=['create',...(routing.selection.kind==='github'?[...(!githubSocialExists?['github-social-create' as const]:[]),'github-sharing-create' as const,'github-shares-set' as const]:[]),...(maxSolLamports>0n?['user-token-account' as const,'first-buy' as const]:[])]
    if(steps.length!==native.instructions.length)throw new Error('Unsupported native launch instruction recipe')
    const single=compile(native.instructions,priorityLamports)
    let transactions:VersionedTransaction[],requiresAtomicBundle=false,jitoTipLamports=0,stepsByPacket:NativePumpLaunchStep[][]
    if(fitsPumpPacket(single)){
      transactions=[single];stepsByPacket=[steps]
    }else{
      const groups:{instructions:TransactionInstruction[];steps:NativePumpLaunchStep[]}[]=[]
      for(let index=0;index<native.instructions.length;index++){
        const ix=native.instructions[index],previous=groups.at(-1)
        if(previous&&fitsPumpPacket(compile([...previous.instructions,ix],0n))){previous.instructions.push(ix);previous.steps.push(steps[index])}
        else {if(!fitsPumpPacket(compile([ix],0n)))throw new Error('Token metadata exceeds the native launch packet limit; shorten the metadata URI');groups.push({instructions:[ix],steps:[steps[index]]})}
      }
      jitoTipLamports=params.jitoTipLamports??10000
      const tip=await createVerifiedJitoTipTransaction(connection,payer,blockhash,jitoTipLamports)
      const tipInstruction=TransactionMessage.decompile(tip.message).instructions
      if(tipInstruction.length!==1)throw new Error('Unsupported verified validator tip')
      const last=groups.at(-1)!
      const embedded=!params.separateJitoTip&&fitsPumpPacket(compile([...last.instructions,tipInstruction[0]],0n))
      if(embedded){last.instructions.push(tipInstruction[0]);last.steps.push('validator-tip')}
      const count=BigInt(groups.length),base=priorityLamports/count,remainder=priorityLamports%count
      transactions=groups.map((group,index)=>compile(group.instructions,base+(index===0?remainder:0n)))
      stepsByPacket=groups.map(group=>group.steps)
      if(!embedded){transactions.push(tip);stepsByPacket.push(['validator-tip'])}
      if(transactions.length>5)throw new Error('This recipient and metadata exceed the five-packet atomic launch limit; shorten the metadata URI, remove the first buy, or choose another recipient')
      requiresAtomicBundle=true
    }
    const protocolFeeRecipients=[...new Set([global.feeRecipient,...global.feeRecipients].filter(key=>!key.equals(PublicKey.default)).map(key=>key.toBase58()))]
    const launchPlan:NativePumpLaunchPlan={version:1,routing,metadata:expectedMetadata,maxBuyLamports:maxSolLamports.toString(),firstBuyTokenAmountRaw:native.tokenAmount.toString(),maxPriorityFeeLamports:priorityLamports.toString(),jitoTipLamports:String(jitoTipLamports),requiresAtomicBundle,packets:transactions,stepsByPacket,protocolFeeRecipients,separateJitoTip:params.separateJitoTip??false}
    validatePumpLaunchPlan(launchPlan)
    // Packet limits and spend policies are checked before any signer is invoked.
    transactions[0].sign([mintKeypair])

    return {
      success: true,
      transaction:requiresAtomicBundle?undefined:transactions[0],
      transactions,
      requiresAtomicBundle,
      jitoTipLamports:String(jitoTipLamports),
      priorityFeeLamports:priorityLamports.toString(),
      launchPlan,
      creatorFeeRouting:routing,
      metadataUri: ipfsResult.metadataUri,
      tokenAmountRaw:native.tokenAmount.toString(),
      nativeContext:{global,feeConfig,curve:native.curve,tokenAmount:native.tokenAmount,tokenProgram:TOKEN_2022_PROGRAM_ID,routing,effectiveCreator:routing.effectiveCreator},
    }
  } catch (error) {
    console.error('Error building create transaction:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to build transaction',
    }
  }
}

/**
 * Native SDK trade builders use on-chain state and add no Vanity fee.
 */
export async function buildSellTransaction(params: {
  userPublicKey: string
  mintAddress: string
  sellPercent: number // 0-100
  slippage?: number
  priorityFee?: number
  connection?: Connection
}): Promise<{ success: boolean; transaction?: VersionedTransaction; error?: string }> {
  try {
    const { userPublicKey, mintAddress, sellPercent, slippage = 20, priorityFee = 0.0005 } = params

    assertSlippage(slippage)
    if (!Number.isFinite(sellPercent) || sellPercent <= 0 || sellPercent > 100) throw new Error('Sell percentage must be above 0 and at most 100')
    const connection=params.connection??new Connection(getRpcEndpoint(),'confirmed')
    const payer=new PublicKey(userPublicKey),mint=new PublicKey(mintAddress)
    const online=new OnlinePumpSdk(connection)
    const mintInfo=await withTimeout(connection.getAccountInfo(mint,'confirmed'))
    if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Token mint is missing or unsupported')
    const tokenProgram=mintInfo.owner
    const [global,feeConfig,state,account,{blockhash}]=await Promise.all([withTimeout(online.fetchGlobal()),withTimeout(online.fetchFeeConfig()),withTimeout(online.fetchSellState(mint,payer,tokenProgram)),withTimeout(getAccount(connection,getAssociatedTokenAddressSync(mint,payer,false,tokenProgram),'confirmed',tokenProgram)),withTimeout(connection.getLatestBlockhash('confirmed'))])
    if (state.bondingCurve.complete) throw new Error('This token graduated; use a supported AMM trading route')
    if (!state.quoteMint.equals(NATIVE_MINT)) throw new Error('Only SOL-quoted curves are supported')
    const amount=new BN(account.amount.toString()).muln(Math.floor(sellPercent*100)).divn(10000)
    if (amount.isZero()) throw new Error('No token balance to sell')
    const solAmount=getSellSolAmountFromTokenAmount({global,feeConfig,mintSupply:state.bondingCurve.tokenTotalSupply,bondingCurve:state.bondingCurve,amount})
    const instructions=await PUMP_SDK.sellInstructions({global,...state,mint,user:payer,amount,solAmount,slippage,tokenProgram,mayhemMode:state.bondingCurve.isMayhemMode,cashback:state.bondingCurve.isCashbackCoin})
    const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[...computeInstructions(priorityFee),...instructions]}).compileToV0Message())
    validatePumpTransaction(transaction,{action:'sell',payer,mint,maxSolLamports:0n,expectedBuyCreator:state.bondingCurve.creator})

    return {
      success: true,
      transaction,
    }
  } catch (error) {
    console.error('Error building sell transaction:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to build sell transaction',
    }
  }
}

/**
 * Send a signed transaction
 */
export async function sendTransaction(
  connection: Connection,
  transaction: VersionedTransaction
): Promise<{ success: boolean; signature?: string; error?: string; status?: 'confirmed'|'failed'|'unknown' }> {
  try {
    const receipt=await sendAndConfirmTransaction(connection,transaction)
    return {success:receipt.status==='confirmed',...receipt}
  } catch (error) {
    console.error('Error sending transaction:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send transaction',
    }
  }
}

export async function buildNativeBuyTransaction(params:{connection:Connection;userPublicKey:string;mintAddress:string;maxBuyAmountSol:number;slippage?:number;priorityFee?:number}): Promise<VersionedTransaction> {
  const {connection,userPublicKey,mintAddress,maxBuyAmountSol,slippage=10,priorityFee=0.0005}=params
  assertSlippage(slippage)
  const maxSolLamports=solToLamports(maxBuyAmountSol)
  if (maxSolLamports===0n) throw new Error('Buy budget must be positive')
  const payer=new PublicKey(userPublicKey),mint=new PublicKey(mintAddress),online=new OnlinePumpSdk(connection)
  const mintInfo=await withTimeout(connection.getAccountInfo(mint,'confirmed'))
  if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Token mint is missing or unsupported')
  const tokenProgram=mintInfo.owner
  const [global,feeConfig,state,{blockhash}]=await Promise.all([withTimeout(online.fetchGlobal()),withTimeout(online.fetchFeeConfig()),withTimeout(online.fetchBuyState(mint,payer,tokenProgram)),withTimeout(connection.getLatestBlockhash('confirmed'))])
  if (state.bondingCurve.complete) throw new Error('This token graduated; use a supported AMM trading route')
  if (!state.quoteMint.equals(NATIVE_MINT)) throw new Error('Only SOL-quoted curves are supported')
  const solAmount=new BN((maxSolLamports*1000n/BigInt(1000+Math.floor(slippage*10))).toString())
  const amount=getBuyTokenAmountFromSolAmount({global,feeConfig,mintSupply:state.bondingCurve.tokenTotalSupply,bondingCurve:state.bondingCurve,amount:solAmount,quoteMint:NATIVE_MINT})
  if (amount.isZero()) throw new Error('Buy budget is too small')
  const instructions=await PUMP_SDK.buyInstructions({global,...state,mint,user:payer,amount,solAmount,slippage,tokenProgram})
  const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[...computeInstructions(priorityFee),...instructions]}).compileToV0Message())
  validatePumpTransaction(transaction,{action:'buy',payer,mint,maxSolLamports,expectedBuyCreator:state.bondingCurve.creator})
  return transaction
}
