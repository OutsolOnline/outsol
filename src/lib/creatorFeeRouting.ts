import {PublicKey,SystemProgram,ComputeBudgetProgram,AddressLookupTableProgram,Ed25519Program,Secp256k1Program,StakeProgram,VoteProgram,BPF_LOADER_PROGRAM_ID,BPF_LOADER_DEPRECATED_PROGRAM_ID,SYSVAR_RENT_PUBKEY,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js'
import {ASSOCIATED_TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token'
import {feeSharingConfigPda,holderRewardsPda,socialFeePda,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,MAYHEM_PROGRAM_ID,type Global} from '@pump-fun/pump-sdk'

export type CreatorFeeSelection = {kind:'deployer'}|{kind:'wallet';address:string}|{kind:'github';username:string}|{kind:'holder-rewards'}|{kind:'cashback'}
export type SupportedCreatorFeeSelection = Exclude<CreatorFeeSelection,{kind:'cashback'}>
export interface VerifiedGitHubIndividual {userId:string;username:string;profileUrl:string;accountType:'User'}
export interface ResolvedCreatorFeeRouting {
 version:1;selection:SupportedCreatorFeeSelection;payer:string;mint:string;encodedCreator:string;initialCurveCreator:string;effectiveCreator:string;holderReward:boolean;cashback:false;creatorFeeBps:'0';sharingConfig?:string;socialRecipient?:string;github?:VerifiedGitHubIndividual
}
const object=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Invalid creator fee routing object')
 return value as Record<string,unknown>
}
function exact(value:Record<string,unknown>,keys:readonly string[]) {if(Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))throw new Error('Unexpected or missing creator fee routing field')}
function publicKey(value:unknown):string {if(typeof value!=='string'||!value)throw new Error('Invalid public address');try{return new PublicKey(value).toBase58()}catch{throw new Error('Invalid public address')}}
const forbiddenWallets=[SystemProgram.programId,ComputeBudgetProgram.programId,AddressLookupTableProgram.programId,Ed25519Program.programId,Secp256k1Program.programId,StakeProgram.programId,VoteProgram.programId,BPF_LOADER_PROGRAM_ID,BPF_LOADER_DEPRECATED_PROGRAM_ID,SYSVAR_RENT_PUBKEY,SYSVAR_CLOCK_PUBKEY,ASSOCIATED_TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,MAYHEM_PROGRAM_ID].map(key=>key.toBase58()).concat(['metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s','BPFLoaderUpgradeab1e11111111111111111111111'])
function wallet(value:unknown):string {const address=publicKey(value);if(forbiddenWallets.includes(address)||!PublicKey.isOnCurve(new PublicKey(address).toBytes()))throw new Error('Creator fee recipient must be an on-curve Solana wallet');return address}
export function canonicalGitHubUsername(value:unknown):string {
 if(typeof value!=='string'||value.length<1||value.length>39||! /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value))throw new Error('Enter a valid GitHub individual username')
 return value
}
export function parseVerifiedGitHubIndividual(value:unknown):VerifiedGitHubIndividual {
 const input=object(value);exact(input,['userId','username','profileUrl','accountType'])
 const username=canonicalGitHubUsername(input.username)
 if(input.accountType!=='User')throw new Error('GitHub fee recipients must be individual user accounts')
 if(typeof input.userId!=='string'||! /^[1-9][0-9]{0,19}$/.test(input.userId))throw new Error('Invalid immutable GitHub user ID')
 if(input.profileUrl!==`https://github.com/${username}`)throw new Error('Invalid canonical GitHub profile URL')
 return {userId:input.userId,username,profileUrl:input.profileUrl,accountType:'User'}
}
export function parseCreatorFeeSelection(value:unknown):CreatorFeeSelection {
 const input=object(value)
 switch(input.kind){
  case 'wallet':exact(input,['kind','address']);return {kind:'wallet',address:wallet(input.address)}
  case 'github':exact(input,['kind','username']);return {kind:'github',username:canonicalGitHubUsername(input.username)}
  case 'deployer':case 'holder-rewards':case 'cashback':exact(input,['kind']);return {kind:input.kind}
  default:throw new Error('Unknown creator fee recipient mode')
 }
}
export function requireSupportedCreatorFeeSelection(value:unknown):SupportedCreatorFeeSelection {const selection=parseCreatorFeeSelection(value);if(selection.kind==='cashback')throw new Error('Pump no longer permits new cashback coins (CashbackDeprecated, 6082)');return selection}
export function migrateLegacyCreatorFeeSelection(value:unknown):SupportedCreatorFeeSelection {return value===undefined?{kind:'deployer'}:requireSupportedCreatorFeeSelection(value)}
export function resolveCreatorFeeRouting(args:{selection:SupportedCreatorFeeSelection;payer:string;mint:string;github?:VerifiedGitHubIndividual}):ResolvedCreatorFeeRouting {
 const selection=requireSupportedCreatorFeeSelection(args.selection),payer=wallet(args.payer),mint=publicKey(args.mint)
 const route:ResolvedCreatorFeeRouting={version:1,selection,payer,mint,encodedCreator:payer,initialCurveCreator:payer,effectiveCreator:payer,holderReward:false,cashback:false,creatorFeeBps:'0'}
 if(selection.kind==='wallet')route.encodedCreator=route.initialCurveCreator=route.effectiveCreator=selection.address
 if(selection.kind==='holder-rewards'){route.initialCurveCreator=route.effectiveCreator=holderRewardsPda(new PublicKey(mint)).toBase58();route.holderReward=true}
 if(selection.kind==='github'){
  const github=parseVerifiedGitHubIndividual(args.github)
  if(github.username.toLowerCase()!==selection.username.toLowerCase())throw new Error('Verified GitHub identity differs from the selected username; refresh the recipient review')
  route.github=github;route.selection={kind:'github',username:github.username};route.sharingConfig=route.effectiveCreator=feeSharingConfigPda(new PublicKey(mint)).toBase58();route.socialRecipient=socialFeePda(github.userId,2).toBase58()
 }else if(args.github!==undefined)throw new Error('Unexpected GitHub identity for this recipient mode')
 return route
}
export function parseResolvedCreatorFeeRouting(value:unknown):ResolvedCreatorFeeRouting {
 const input=object(value),selection=requireSupportedCreatorFeeSelection(input.selection)
 const fields=['version','selection','payer','mint','encodedCreator','initialCurveCreator','effectiveCreator','holderReward','cashback','creatorFeeBps',...(selection.kind==='github'?['sharingConfig','socialRecipient','github']:[])]
 exact(input,fields)
 const expected=resolveCreatorFeeRouting({selection,payer:input.payer as string,mint:input.mint as string,...(selection.kind==='github'?{github:parseVerifiedGitHubIndividual(input.github)}:{})})
 for(const field of fields){if(field==='selection'||field==='github')continue;if(input[field]!==expected[field as keyof ResolvedCreatorFeeRouting])throw new Error(`Creator fee routing ${field} differs from its derived value`)}
 return expected
}
export function assertCreatorFeeRoutingAvailable(routing:ResolvedCreatorFeeRouting,global:Pick<Global,'isHolderRewardEnabled'>):void {if(routing.holderReward&&global.isHolderRewardEnabled!==true)throw new Error('Pump holder rewards are currently disabled by the protocol')}
export function creatorFeeRoutingLabel(value:CreatorFeeSelection|ResolvedCreatorFeeRouting):string {
 const selection='selection' in value?value.selection:value
 switch(selection.kind){case 'deployer':return 'Deployer wallet';case 'wallet':return `Wallet ${selection.address}`;case 'github':return `GitHub @${selection.username}`;case 'holder-rewards':return 'Holder rewards';case 'cashback':return 'Cashback unavailable (CashbackDeprecated, 6082)'}
}
