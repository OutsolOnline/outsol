import {AddressLookupTableAccount,AddressLookupTableProgram,Connection,PublicKey,SystemProgram,VersionedTransaction,type AccountInfo} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token'
import {bondingCurvePda,feeSharingConfigPda,PUMP_FEE_PROGRAM_ID,PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {PUMP_AMM_SDK} from '@pump-fun/pump-sdk/swap'
import {fetchBounded,withTimeout} from '../transactions/http'
import {creatorAddress,creatorAmount,creatorStateBinding,parseCreatorShares,type CreatorOperationIntent,type CreatorOperationPreview,type CreatorState} from './model'

export interface CreatorSimulationBank {addresses:string[];before:unknown[];after:unknown[];networkFeeLamports:string}
function lamports(value:unknown):bigint{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('The simulated account balance is not exact.');return BigInt(value)}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The creator simulation is incomplete.');return value as Record<string,unknown>}
export function creatorSimulationAccount(value:unknown):AccountInfo<Buffer>|null{
 if(value===null)return null
 const row=object(value),raw=row.data
 if(!Array.isArray(raw)||raw.length!==2||raw[1]!=='base64'||typeof raw[0]!=='string'||raw[0].length>32768||typeof row.executable!=='boolean'||row.executable)throw new Error('The simulated creator account is unreadable or executable.')
 const data=Buffer.from(raw[0],'base64');if(data.toString('base64')!==raw[0])throw new Error('The creator simulation account encoding is invalid.')
 const owner=new PublicKey(creatorAddress(row.owner)),amount=lamports(row.lamports)
 if(amount===0n&&data.length===0&&owner.equals(SystemProgram.programId))return null
 return{owner,data,lamports:Number(amount),executable:false,rentEpoch:0}
}
function systemWallet(account:AccountInfo<Buffer>|null):void{if(!account||!account.owner.equals(SystemProgram.programId)||account.data.length)throw new Error('The signing wallet could not be verified in the creator simulation.')}
function matchesState(state:CreatorState,at:(address:string)=>AccountInfo<Buffer>|null):void{
 const curveInfo=at(bondingCurvePda(new PublicKey(state.mint)).toBase58())
 if(!curveInfo?.owner.equals(PUMP_PROGRAM_ID))throw new Error('The simulation is missing the verified Pump curve.')
 const curve=PUMP_SDK.decodeBondingCurve(curveInfo),copy={...state,creator:curve.creator.toBase58(),complete:curve.complete,holderReward:curve.isHolderReward,cashback:curve.isCashbackCoin}
 if(!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT))throw new Error('The simulated quote asset changed.')
 const sharingInfo=at(feeSharingConfigPda(new PublicKey(state.mint)).toBase58())
 if(sharingInfo){
  if(!sharingInfo.owner.equals(PUMP_FEE_PROGRAM_ID))throw new Error('The simulated fee sharing owner changed.')
  const sharing=PUMP_SDK.decodeSharingConfig(sharingInfo);if(!sharing.mint.equals(new PublicKey(state.mint)))throw new Error('The simulated sharing mint changed.')
  copy.sharing={address:feeSharingConfigPda(new PublicKey(state.mint)).toBase58(),version:sharing.version,admin:sharing.admin.toBase58(),adminRevoked:sharing.adminRevoked,shareholders:parseCreatorShares(sharing.shareholders.map(row=>({address:row.address.toBase58(),shareBps:row.shareBps})),false)}
 }else copy.sharing=undefined
 if(state.pool){const poolInfo=at(state.pool.address);if(!poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID))throw new Error('The simulated pool is missing.');const pool=PUMP_AMM_SDK.decodePool(poolInfo);copy.pool={...state.pool,creator:pool.coinCreator.toBase58()}}
 if(creatorStateBinding(copy)!==creatorStateBinding(state))throw new Error('The creator, administrator or fee shares changed since review. Prepare again.')
}
/** Validate same-bank account evidence; displayed amounts are wallet changes, never invented per-token rewards. */
export function validateCreatorSimulation(intent:CreatorOperationIntent,bank:CreatorSimulationBank,state:CreatorState):CreatorOperationPreview{
 if(!Array.isArray(bank.addresses)||bank.addresses.length<1||bank.addresses.length>64||new Set(bank.addresses).size!==bank.addresses.length||bank.addresses.some(value=>creatorAddress(value)!==value)||!Array.isArray(bank.before)||!Array.isArray(bank.after)||bank.before.length!==bank.addresses.length||bank.after.length!==bank.addresses.length)throw new Error('The creator simulation account evidence is incomplete.')
 const before=bank.before.map(creatorSimulationAccount),after=bank.after.map(creatorSimulationAccount),at=(side:(AccountInfo<Buffer>|null)[],address:string)=>{const index=bank.addresses.indexOf(address);if(index<0)throw new Error('A reviewed account is absent from the simulation.');return side[index]}
 const initialPayer=at(before,intent.input.payer),finalPayer=at(after,intent.input.payer);systemWallet(initialPayer);systemWallet(finalPayer)
 const beforeLamports=lamports(initialPayer!.lamports),afterLamports=lamports(finalPayer!.lamports),fee=BigInt(creatorAmount(bank.networkFeeLamports)),debit=beforeLamports>afterLamports?beforeLamports-afterLamports:0n
 const recipients=state.sharing?.shareholders.map(row=>row.address)??[],changes=[...new Set([intent.input.payer,...recipients])].map(address=>({address,changeLamports:((at(after,address)?lamports(at(after,address)!.lamports):0n)-(at(before,address)?lamports(at(before,address)!.lamports):0n)).toString()}))
 let existingWrappedSol=0n,lookupRent=0n
 if(intent.input.kind==='collect'){
  const ata=getAssociatedTokenAddressSync(NATIVE_MINT,new PublicKey(intent.input.payer)).toBase58(),index=bank.addresses.indexOf(ata)
  if(index>=0&&before[index]){const token=unpackAccount(new PublicKey(ata),before[index],TOKEN_PROGRAM_ID);if(!token.owner.equals(new PublicKey(intent.input.payer))||!token.mint.equals(NATIVE_MINT)||token.delegate||token.closeAuthority&&!token.closeAuthority.equals(new PublicKey(intent.input.payer)))throw new Error('The wrapped SOL destination has unexpected authority.');existingWrappedSol=token.amount}
 }
 if(intent.input.kind==='shares'){
  const sharingInfo=at(after,feeSharingConfigPda(new PublicKey(state.mint)).toBase58())
  if(!sharingInfo?.owner.equals(PUMP_FEE_PROGRAM_ID))throw new Error('The simulated fee sharing result is missing.')
  const sharing=PUMP_SDK.decodeSharingConfig(sharingInfo),expectedAdmin=state.sharing?.admin??intent.input.payer
  if(!sharing.mint.equals(new PublicKey(state.mint))||sharing.version!==2||sharing.adminRevoked!==true||sharing.admin.toBase58()!==expectedAdmin||JSON.stringify(parseCreatorShares(sharing.shareholders.map(row=>({address:row.address.toBase58(),shareBps:row.shareBps})),false))!==JSON.stringify(intent.input.shares))throw new Error('The simulated final fee shares or permanently revoked administrator differ from your review.')
 }
 if(intent.input.kind==='lookup'){
  const initial=at(before,intent.lookupAddress!),final=at(after,intent.lookupAddress!)
  if(initial||!final?.owner.equals(AddressLookupTableProgram.programId))throw new Error('The lookup table was not created exactly as reviewed.')
  const table=AddressLookupTableAccount.deserialize(final.data)
  if(table.authority?.toBase58()!==intent.input.payer||table.deactivationSlot!==18446744073709551615n||JSON.stringify(table.addresses.map(key=>key.toBase58()))!==JSON.stringify(intent.input.addresses))throw new Error('The lookup table contents or authority differ from review.')
  lookupRent=lamports(final.lamports);if(beforeLamports-afterLamports!==fee+lookupRent)throw new Error('The lookup setup cost differs from the simulated table rent and network fee.')
 }
 return{payerBeforeLamports:beforeLamports.toString(),payerAfterLamports:afterLamports.toString(),networkFeeLamports:fee.toString(),maxDebitLamports:debit.toString(),existingWrappedSolLamports:existingWrappedSol.toString(),recipientChanges:changes,lookupRentLamports:lookupRent.toString()}
}
export async function simulateCreatorOperation(connection:Connection,transaction:VersionedTransaction,intent:CreatorOperationIntent,state:CreatorState,lookup?:AddressLookupTableAccount,signed=false,guard:()=>void=()=>{}):Promise<CreatorOperationPreview>{
 const keys=transaction.message.getAccountKeys(lookup?{addressLookupTableAccounts:[lookup]}:undefined),all=Array.from({length:keys.length},(_,index)=>keys.get(index)!),mint=new PublicKey(state.mint)
 const addresses=[...new Set([intent.input.payer,...all.filter((_,index)=>transaction.message.isAccountWritable(index)).map(key=>key.toBase58()),bondingCurvePda(mint).toBase58(),feeSharingConfigPda(mint).toBase58(),...(state.pool?[state.pool.address]:[]),...(state.sharing?.shareholders.map(row=>row.address)??[])])]
 if(addresses.length>64)throw new Error('Too many creator-operation accounts to verify safely.')
 guard();await withTimeout(connection.getMultipleAccountsInfo(all,'confirmed'));guard()
 const config={encoding:'base64',addresses},[raw,fee]=await Promise.all([
  fetchBounded<unknown>(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:[Buffer.from(transaction.serialize()).toString('base64')]},{transactionEncoding:'base64',skipSigVerify:!signed,replaceRecentBlockhash:false,preExecutionAccountsConfigs:[config],postExecutionAccountsConfigs:[config]}]})},response=>response.json()),
  withTimeout(connection.getFeeForMessage(transaction.message,'confirmed')),
 ]);guard()
 const response=object(raw),result=object(response.result),value=object(result.value),rows=value.transactionResults
 if(response.error||value.summary!=='succeeded'||!Array.isArray(rows)||rows.length!==1||fee.value===null)throw new Error('A complete creator-operation simulation is unavailable. Nothing was submitted.')
 const row=object(rows[0]);if(row.err!==null||!Array.isArray(row.preExecutionAccounts)||!Array.isArray(row.postExecutionAccounts)||row.preExecutionAccounts.length!==addresses.length||row.postExecutionAccounts.length!==addresses.length)throw new Error('The creator-operation simulation failed or returned incomplete accounts.')
 const bank:CreatorSimulationBank={addresses,before:row.preExecutionAccounts,after:row.postExecutionAccounts,networkFeeLamports:lamports(fee.value).toString()}
 const before=bank.before.map(creatorSimulationAccount);matchesState(state,address=>before[addresses.indexOf(address)]??null)
 const preview=validateCreatorSimulation(intent,bank,state)
 if(intent.input.kind==='shares'){
  const address=feeSharingConfigPda(new PublicKey(state.mint)).toBase58(),expected:CreatorState={...state,creator:address,sharing:{address,version:2,admin:state.sharing?.admin??intent.input.payer,adminRevoked:true,shareholders:intent.input.shares.map(row=>({...row}))},...(state.pool?{pool:{...state.pool,creator:address}}:{})},after=bank.after.map(creatorSimulationAccount)
  matchesState(expected,key=>after[addresses.indexOf(key)]??null)
 }
 if(intent.input.kind!=='shares'&&intent.input.kind!=='lookup'){const after=bank.after.map(creatorSimulationAccount);matchesState(state,address=>after[addresses.indexOf(address)]??null)}
 return preview
}
