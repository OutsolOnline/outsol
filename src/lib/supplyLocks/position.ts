import {Connection,PublicKey,SystemProgram} from '@solana/web3.js'
import {ExtensionType,getAssociatedTokenAddressSync,getExtensionTypes,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackAccount,unpackMint} from '@solana/spl-token'
import {withTimeout} from '../transactions/http'
import {creatorAddress} from '../creatorOperations/model'
import {LOCK_ORACLE,LOCK_ORACLE_PROGRAM,LOCK_PROGRAM,readSupplyLockFees,type SupplyLockPosition} from './model'

export async function readSupplyLockPosition(connection:Connection,mintAddress:string,payerAddress:string,guard:()=>void=()=>{}):Promise<SupplyLockPosition>{
 const mint=new PublicKey(creatorAddress(mintAddress)),payer=new PublicKey(creatorAddress(payerAddress,true))
 guard();const [genesis,bank]=await Promise.all([withTimeout(connection.getGenesisHash()),withTimeout(connection.getMultipleAccountsInfoAndContext([mint,payer,LOCK_PROGRAM,LOCK_ORACLE],{commitment:'confirmed'}))]);guard()
 if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Supply locks support the Solana mainnet program.')
 const [mintInfo,payerInfo,program,oracle]=bank.value
 if(!mintInfo||mintInfo.executable||(!mintInfo.owner.equals(TOKEN_PROGRAM_ID)&&!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)))throw new Error('No supported token mint was found.')
 const state=unpackMint(mint,mintInfo,mintInfo.owner)
 if(!state.isInitialized||state.decimals>9||state.freezeAuthority||state.mintAuthority||getExtensionTypes(state.tlvData).some(type=>type!==ExtensionType.MetadataPointer&&type!==ExtensionType.TokenMetadata))throw new Error('This lock supports initialized fixed-supply tokens with revoked mint and freeze authorities and metadata-only extensions.')
 if(!payerInfo||payerInfo.executable||!payerInfo.owner.equals(SystemProgram.programId)||payerInfo.data.length)throw new Error('Choose an ordinary funded signing wallet.')
 if(!program?.executable||!['BPFLoaderUpgradeab1e11111111111111111111111','BPFLoader2111111111111111111111111111111111'].includes(program.owner.toBase58()))throw new Error('The canonical Streamflow program could not be verified.')
 if(!oracle||oracle.executable||!oracle.owner.equals(LOCK_ORACLE_PROGRAM))throw new Error('The live Streamflow fee oracle has an unexpected owner.')
 const fees=readSupplyLockFees(oracle.data),source=getAssociatedTokenAddressSync(mint,payer,false,mintInfo.owner),[sourceInfo,chainTime]=await Promise.all([withTimeout(connection.getAccountInfo(source,'confirmed')),withTimeout(connection.getBlockTime(bank.context.slot))]);guard()
 const account=unpackAccount(source,sourceInfo,mintInfo.owner)
 if(!account.isInitialized||account.isFrozen||!account.mint.equals(mint)||!account.owner.equals(payer)||account.delegate||account.closeAuthority&&!account.closeAuthority.equals(payer)||getExtensionTypes(account.tlvData).some(type=>type!==ExtensionType.ImmutableOwner))throw new Error('The token source has unsupported authority, delegation or extensions.')
 if(typeof chainTime!=='number'||!Number.isSafeInteger(chainTime)||chainTime<1||!Number.isSafeInteger(bank.context.slot)||bank.context.slot<1)throw new Error('Confirmed chain time could not be established for the lock.')
 return{mint:mint.toBase58(),payer:payer.toBase58(),tokenProgram:mintInfo.owner.toBase58(),decimals:state.decimals,supplyRaw:state.supply.toString(),balanceRaw:account.amount.toString(),chainTime,slot:bank.context.slot,...fees,oracleData:oracle.data.toString('base64')}
}
export const supplyPositionBinding=(state:SupplyLockPosition)=>JSON.stringify({mint:state.mint,payer:state.payer,tokenProgram:state.tokenProgram,decimals:state.decimals,supplyRaw:state.supplyRaw,oracleData:state.oracleData,feeUnits:state.feeUnits,creationFeeLamports:state.creationFeeLamports})
