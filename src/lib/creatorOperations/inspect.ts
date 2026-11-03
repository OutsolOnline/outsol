import {Connection,PublicKey,type AccountInfo} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint} from '@solana/spl-token'
import {OnlinePumpSdk,PUMP_SDK,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,bondingCurvePda,canonicalPumpPoolPda,feeSharingConfigPda} from '@pump-fun/pump-sdk'
import {PUMP_AMM_SDK} from '@pump-fun/pump-sdk/swap'
import {withTimeout} from '../transactions/http'
import {creatorAddress,creatorAmount,parseCreatorShares,type CreatorState} from './model'

function owned(info:AccountInfo<Buffer>|null,owner:PublicKey,label:string):AccountInfo<Buffer>{if(!info||info.executable||!info.owner.equals(owner))throw new Error(`The ${label} account could not be verified.`);return info}
/** Read-only confirmed snapshot. Program ownership and mint bindings are checked before decoding authority. */
export async function inspectCreatorState(connection:Connection,address:string,guard:()=>void=()=>{}):Promise<CreatorState>{
 const mint=new PublicKey(creatorAddress(address)),curveAddress=bondingCurvePda(mint),sharingAddress=feeSharingConfigPda(mint),poolAddress=canonicalPumpPoolPda(mint)
 guard();const result=await withTimeout(connection.getMultipleAccountsInfoAndContext([mint,curveAddress,sharingAddress,poolAddress],{commitment:'confirmed'}));guard()
 if(!Number.isSafeInteger(result.context.slot)||result.context.slot<1||result.value.length!==4)throw new Error('The confirmed creator snapshot is incomplete.')
 const [mintInfo,curveInfo,sharingInfo,poolInfo]=result.value
 if(!mintInfo||mintInfo.executable||(!mintInfo.owner.equals(TOKEN_PROGRAM_ID)&&!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))||!unpackMint(mint,mintInfo,mintInfo.owner).isInitialized)throw new Error('Choose an initialized Solana token mint.')
 const curve=PUMP_SDK.decodeBondingCurve(owned(curveInfo,PUMP_PROGRAM_ID,'Pump curve'))
 if(!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT))throw new Error('Creator operations currently support SOL-quoted Pump.fun tokens.')
 const state:CreatorState={mint:mint.toBase58(),slot:result.context.slot,checkedAt:Date.now(),creator:creatorAddress(curve.creator.toBase58()),complete:curve.complete,holderReward:curve.isHolderReward,cashback:curve.isCashbackCoin,curveFeeLamports:creatorAmount(curve.creatorFee.toString()),vaultBalanceLamports:'0'}
 if([state.complete,state.holderReward,state.cashback].some(value=>typeof value!=='boolean'))throw new Error('The Pump creator flags could not be verified.')
 if(sharingInfo){
  const sharing=PUMP_SDK.decodeSharingConfig(owned(sharingInfo,PUMP_FEE_PROGRAM_ID,'fee sharing'))
  if(!sharing.mint.equals(mint)||![1,2].includes(sharing.version)||typeof sharing.adminRevoked!=='boolean')throw new Error('The fee sharing configuration does not match this token.')
  state.sharing={address:sharingAddress.toBase58(),version:sharing.version,admin:creatorAddress(sharing.admin.toBase58()),adminRevoked:sharing.adminRevoked,shareholders:parseCreatorShares(sharing.shareholders.map(row=>({address:row.address.toBase58(),shareBps:row.shareBps})),false)}
  if(!curve.creator.equals(sharingAddress))throw new Error('The fee sharing configuration is not the current curve creator. Use Pump.fun to inspect this route.')
 }else if(curve.creator.equals(sharingAddress))throw new Error('The current fee sharing configuration is missing.')
 if(poolInfo){
  const pool=PUMP_AMM_SDK.decodePool(owned(poolInfo,PUMP_AMM_PROGRAM_ID,'canonical Pump pool'))
  if(!pool.baseMint.equals(mint)||!pool.quoteMint.equals(NATIVE_MINT))throw new Error('The canonical pool does not match this SOL-quoted token.')
  state.pool={address:poolAddress.toBase58(),creator:creatorAddress(pool.coinCreator.toBase58()),feeLamports:creatorAmount(pool.creatorFees.toString())}
 }
 const balance=await withTimeout(new OnlinePumpSdk(connection).getCreatorVaultBalanceBothPrograms(new PublicKey(state.creator)));guard()
 state.vaultBalanceLamports=creatorAmount(balance.toString());return state
}
