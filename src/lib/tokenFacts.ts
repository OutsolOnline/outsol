import {Connection,PublicKey} from '@solana/web3.js'
import {ExtensionType,getExtensionData,unpackMint,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT,getMetadataPointerState} from '@solana/spl-token'
import {unpack} from '@solana/spl-token-metadata'
import {bondingCurvePda,feeSharingConfigPda,PUMP_FEE_PROGRAM_ID,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {withTimeout} from './transactions/http'
export interface TokenFacts {mint:string;slot:number;checkedAt:string;decimals:number;supplyRaw:string;mintAuthority:string|null;freezeAuthority:string|null;tokenProgram:string;name?:string;symbol?:string;metadataUri?:string;metadataAuthority?:string|null;metadataPointerAuthority?:string|null;curveAddress:string;curveStatus:'active'|'graduated'|'unverified';curveSolRaw?:string;curveTokensRaw?:string;creator?:string;isHolderReward?:boolean;isCashbackCoin?:boolean;feeSharing?:{address:string;adminRevoked:boolean;shareholders:{address:string;shareBps:number}[]}}
export function safeMetadataHref(uri?:string):string|undefined {try{const url=new URL(uri||'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:undefined}catch{return undefined}}
/** Mint and curve are decoded from one confirmed bank snapshot. No arbitrary metadata URL is fetched. */
export async function readTokenFacts(connection:Connection,address:string):Promise<TokenFacts>{
 const mint=new PublicKey(address),curve=bondingCurvePda(mint),sharingAddress=feeSharingConfigPda(mint)
 const response=await withTimeout(connection.getMultipleAccountsInfoAndContext([mint,curve,sharingAddress],{commitment:'confirmed'}))
 const [info,curveInfo,sharingInfo]=response.value
 if(!info||(!info.owner.equals(TOKEN_PROGRAM_ID)&&!info.owner.equals(TOKEN_2022_PROGRAM_ID)))throw new Error('No supported token mint was found at this address. Check the address or retry after confirmation.')
 const state=unpackMint(mint,info,info.owner)
 if(!state.isInitialized)throw new Error('This token mint is not initialized.')
 const facts:TokenFacts={mint:mint.toBase58(),slot:response.context.slot,checkedAt:new Date().toISOString(),decimals:state.decimals,supplyRaw:state.supply.toString(),mintAuthority:state.mintAuthority?.toBase58()??null,freezeAuthority:state.freezeAuthority?.toBase58()??null,tokenProgram:info.owner.toBase58(),curveAddress:curve.toBase58(),curveStatus:'unverified'}
 if(info.owner.equals(TOKEN_2022_PROGRAM_ID)){
  const data=getExtensionData(ExtensionType.TokenMetadata,state.tlvData),pointer=getMetadataPointerState(state)
  if(data&&pointer?.metadataAddress?.equals(mint)){
   const metadata=unpack(data)
   if(metadata.mint.equals(mint)){facts.name=metadata.name.slice(0,80);facts.symbol=metadata.symbol.slice(0,20);facts.metadataUri=metadata.uri.slice(0,500);facts.metadataAuthority=metadata.updateAuthority?.toBase58()??null;facts.metadataPointerAuthority=pointer.authority?.toBase58()??null}
  }
 }
 if(curveInfo?.owner.equals(PUMP_PROGRAM_ID)){
  const decoded=PUMP_SDK.decodeBondingCurve(curveInfo)
  if(decoded.quoteMint.equals(PublicKey.default)||decoded.quoteMint.equals(NATIVE_MINT)){
   facts.curveStatus=decoded.complete?'graduated':'active';facts.curveSolRaw=decoded.realQuoteReserves.toString();facts.curveTokensRaw=decoded.realTokenReserves.toString();facts.creator=decoded.creator.toBase58();facts.isHolderReward=decoded.isHolderReward;facts.isCashbackCoin=decoded.isCashbackCoin
   if(decoded.creator.equals(sharingAddress)&&sharingInfo?.owner.equals(PUMP_FEE_PROGRAM_ID)){
    const sharing=PUMP_SDK.decodeSharingConfig(sharingInfo)
    if(sharing.mint.equals(mint))facts.feeSharing={address:sharingAddress.toBase58(),adminRevoked:sharing.adminRevoked,shareholders:sharing.shareholders.map(share=>({address:share.address.toBase58(),shareBps:share.shareBps}))}
   }
  }
 }
 return facts
}
