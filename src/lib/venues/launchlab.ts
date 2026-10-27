import {ComputeBudgetProgram,Connection,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {createAssociatedTokenAccountIdempotentInstruction,createCloseAccountInstruction,createInitializeAccount3Instruction,createSyncNativeInstruction,getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {Curve,CpmmCreatorFeeOn,LaunchpadConfig,LaunchpadPool,PlatformConfig,LAUNCHPAD_PROGRAM,LAUNCHPAD_PLATFORM,LaunchpadPoolInitParam,getPdaLaunchpadAuth,getPdaLaunchpadConfigId,getPdaLaunchpadPoolId,getPdaLaunchpadVaultId,getPdaMetadataKey,getPdaPlatformVault,getPdaCreatorVault,initializeV2,buyExactInInstruction} from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import {withTimeout} from '@/lib/transactions/http'
import {createJitoTipTransaction} from '@/lib/bundler/jito'
import type {VenueLaunchInput,VenueLaunchPlan} from './types'
import {validateVenueInput} from './utils'

export const BONK_PLATFORM=new PublicKey('8pCtbn9iatQ8493mDQax4xfEUjhoVBpUWYVQoRU18333')
const MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
type LaunchLabInput=Omit<VenueLaunchInput,'connection'|'venue'>&{venue:'raydium-launchlab'|'bonk'}
interface LaunchLabState{config:ReturnType<typeof LaunchpadConfig.decode>;platform:ReturnType<typeof PlatformConfig.decode>;slot:number;blockhash:string;wrappedSolRent:number;estimatedAccountRent:number}

/** Pure construction using pinned native Raydium instructions; no remote trade builder. */
export async function buildLaunchLabInstructions(input:LaunchLabInput,state:LaunchLabState):Promise<VenueLaunchPlan>{
  const {buyLamports,priorityLamports}=validateVenueInput(input)
  const {config,platform}=state
  if(config.curveType!==0||!config.mintB.equals(NATIVE_MINT))throw new Error('Only the canonical constant-product SOL LaunchLab configuration is supported')
  if(platform.restrictGlobalConfig!==0||platform.restrictCurveParam!==0)throw new Error('This venue now restricts launch parameters; support must be reverified before launch')
  if(!platform.platformVestingScale.isZero())throw new Error('This venue now reserves a platform token allocation; support must be reverified')
  const payer=input.payer,mint=input.mintKeypair.publicKey,program=LAUNCHPAD_PROGRAM
  const platformId=input.venue==='bonk'?BONK_PLATFORM:LAUNCHPAD_PLATFORM
  const configId=getPdaLaunchpadConfigId(program,NATIVE_MINT,0,0).publicKey
  const auth=getPdaLaunchpadAuth(program).publicKey,pool=getPdaLaunchpadPoolId(program,mint,NATIVE_MINT).publicKey
  const vaultA=getPdaLaunchpadVaultId(program,pool,mint).publicKey,vaultB=getPdaLaunchpadVaultId(program,pool,NATIVE_MINT).publicKey
  const supply=LaunchpadPoolInitParam.supply,totalSell=LaunchpadPoolInitParam.totalSellA,totalRaise=LaunchpadPoolInitParam.totalFundRaisingB
  // The canonical live SOL platform configurations require CPMM migration.
  // Older Bonk examples use AMM v4 and now fail MigrateTypeNotMatch (6007).
  const migrateType='cpmm' as const
  Curve.checkParam({supply,totalFundRaising:totalRaise,totalSell,totalLockedAmount:new BN(0),decimals:6,config,migrateType})
  if(buyLamports>=BigInt(totalRaise.toString()))throw new Error('Initial buy must be below this curve’s graduation threshold')
  const groups:TransactionInstruction[][]=[[
    initializeV2(program,payer,payer,configId,platformId,auth,pool,mint,NATIVE_MINT,vaultA,vaultB,getPdaMetadataKey(mint).publicKey,TOKEN_PROGRAM_ID,6,input.name,input.symbol,input.metadataUri,{type:'ConstantCurve',totalSellA:totalSell,migrateType,supply,totalFundRaisingB:totalRaise},new BN(0),new BN(0),new BN(0),CpmmCreatorFeeOn.OnlyTokenB),
  ]]
  const signers=[input.mintKeypair]
  let minAmount=new BN(0),quotedAmount=new BN(0)
  if(buyLamports>0n){
    const initial=Curve.getCurve(0).getInitParam({supply,totalFundRaising:totalRaise,totalSell,totalLockedAmount:new BN(0),migrateFee:config.migrateFee})
    const quote=Curve.buyExactIn({poolInfo:{virtualA:initial.a,virtualB:initial.b,realA:new BN(0),realB:new BN(0),totalSellA:totalSell,totalFundRaisingB:totalRaise},amountB:new BN(buyLamports.toString()),protocolFeeRate:config.tradeFeeRate,platformFeeRate:platform.feeRate,creatorFeeRate:platform.creatorFeeRate,curveType:0,shareFeeRate:new BN(0),transferFeeConfigA:undefined,slot:state.slot})
    quotedAmount=quote.amountA.amount
    minAmount=quotedAmount.muln(10_000-Math.floor(input.slippage*100)).divn(10_000)
    if(minAmount.isZero())throw new Error('Initial buy is too small to establish a minimum token output')
    const wrapped=Keypair.generate();signers.push(wrapped)
    const userToken=getAssociatedTokenAddressSync(mint,payer)
    groups.push([
      SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:wrapped.publicKey,lamports:state.wrappedSolRent+Number(buyLamports),space:165,programId:TOKEN_PROGRAM_ID}),
      createInitializeAccount3Instruction(wrapped.publicKey,NATIVE_MINT,payer),
      createSyncNativeInstruction(wrapped.publicKey),
      createAssociatedTokenAccountIdempotentInstruction(payer,userToken,payer,mint),
      buyExactInInstruction(program,payer,auth,configId,platformId,pool,userToken,wrapped.publicKey,vaultA,vaultB,mint,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,getPdaPlatformVault(program,platformId,NATIVE_MINT).publicKey,getPdaCreatorVault(program,payer,NATIVE_MINT).publicKey,new BN(buyLamports.toString()),minAmount,new BN(0)),
      createCloseAccountInstruction(wrapped.publicKey,payer,payer),
    ])
  }
  const instructionsFee=priorityLamports/BigInt(groups.length)
  const transactions=groups.map(instructions=>new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:state.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500_000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:instructionsFee*1_000_000n/500_000n}),...instructions]}).compileToV0Message()))
  const requiresAtomicBundle=transactions.length>1
  if(requiresAtomicBundle)transactions.push(createJitoTipTransaction(payer,state.blockhash,input.jitoTipLamports))
  for(const transaction of transactions)if(transaction.serialize().length>1232)throw new Error('This venue launch exceeds the Solana transaction packet limit; shorten token metadata')
  const tip=requiresAtomicBundle?input.jitoTipLamports:0
  return {transactions,signers,mint,blockhash:state.blockhash,requiresAtomicBundle,venue:input.venue,poolAddress:pool,estimatedTotalSolLamports:(buyLamports+BigInt(state.estimatedAccountRent)+priorityLamports+BigInt(tip)+BigInt(transactions.length*10_000)).toString(),summary:{platformFeeBps:0,protocolFeeRate:config.tradeFeeRate.toString(),venueFeeRate:platform.feeRate.toString(),creatorFeeRate:platform.creatorFeeRate.toString(),feeRateDenominator:'1000000',initialBuyLamports:buyLamports.toString(),minimumTokenAmount:minAmount.toString(),quotedTokenAmount:quotedAmount.toString(),jitoTipLamports:String(tip),migrationVenue:'Raydium CPMM',supplyRaw:supply.toString(),decimals:6}}
}

/** Read-only preparation from canonical on-chain configurations. */
export async function buildLaunchLabPlan(input:VenueLaunchInput&{venue:'raydium-launchlab'|'bonk'}):Promise<VenueLaunchPlan>{
  validateVenueInput(input)
  const {connection}=input,platformId=input.venue==='bonk'?BONK_PLATFORM:LAUNCHPAD_PLATFORM
  const configId=getPdaLaunchpadConfigId(LAUNCHPAD_PROGRAM,NATIVE_MINT,0,0).publicKey
  const [genesis,accounts,{blockhash},slot,rents]=await Promise.all([
    withTimeout(connection.getGenesisHash()),withTimeout(connection.getMultipleAccountsInfo([LAUNCHPAD_PROGRAM,configId,platformId,input.mintKeypair.publicKey],'confirmed')),
    withTimeout(connection.getLatestBlockhash('confirmed')),withTimeout(connection.getSlot('confirmed')),
    Promise.all([82,679,LaunchpadPool.span,165].map(space=>withTimeout(connection.getMinimumBalanceForRentExemption(space,'confirmed')))),
  ])
  if(genesis!==MAINNET_GENESIS)throw new Error('LaunchLab and Bonk are supported on Solana mainnet only')
  if(!accounts[0]?.executable||!['BPFLoaderUpgradeab1e11111111111111111111111','BPFLoader2111111111111111111111111111111111'].includes(accounts[0].owner.toBase58()))throw new Error('Canonical LaunchLab program is missing or invalid')
  if(!accounts[1]?.owner.equals(LAUNCHPAD_PROGRAM)||accounts[1].data.length!==LaunchpadConfig.span)throw new Error('Canonical LaunchLab curve configuration is missing or invalid')
  if(!accounts[2]?.owner.equals(LAUNCHPAD_PROGRAM)||accounts[2].data.length!==PlatformConfig.span)throw new Error('Canonical venue platform configuration is missing or invalid')
  if(accounts[3])throw new Error('This mint already exists; prepare a fresh mint')
  const plan=await buildLaunchLabInstructions(input,{config:LaunchpadConfig.decode(accounts[1].data),platform:PlatformConfig.decode(accounts[2].data),slot,blockhash,wrappedSolRent:rents[3],estimatedAccountRent:rents[0]+rents[1]+rents[2]+rents[3]*7})
  if(BigInt(await withTimeout(connection.getBalance(input.payer,'confirmed')))<BigInt(plan.estimatedTotalSolLamports))throw new Error('Insufficient SOL for the initial buy, protocol accounts and network costs')
  return plan
}
