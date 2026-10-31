import {Connection,PublicKey,SystemProgram,type AccountInfo} from '@solana/web3.js'
import {ExtensionType,NATIVE_MINT,NATIVE_MINT_2022,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,TRANSFER_FEE_CONFIG_SIZE,TRANSFER_FEE_AMOUNT_SIZE,unpackAccount,unpackMint} from '@solana/spl-token'
import {withTimeout} from '@/lib/transactions/http'
import {publicAddress} from '@/lib/walletOperations/model'
import type {RelayAsset,RelayWalletScan} from './types'

export const RELAY_MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
export function relayAddress(value:string,wallet=false):string{return publicAddress(value,wallet)}
export function relayRaw(value:unknown,allowZero=false):bigint{if(typeof value!=='string'||!/^(0|[1-9]\d{0,19})$/.test(value)||BigInt(value)>18446744073709551615n||(!allowZero&&value==='0'))throw new Error('Use a positive exact token amount within the supported integer limit.');return BigInt(value)}
export function relayLamports(value:unknown):bigint{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('The wallet balance or fee cannot be read exactly.');return BigInt(value)}
export async function assertRelayNetwork(connection:Connection){if(await withTimeout(connection.getGenesisHash())!==RELAY_MAINNET_GENESIS)throw new Error('Relay supports Solana mainnet. The RPC network does not match.')}
export function requireRelayWallet(info:AccountInfo<Buffer>|null,required=false){if((required&&!info)||(info&&(info.executable||!info.owner.equals(SystemProgram.programId)||info.data.length)))throw new Error('Relay sources and destinations must be ordinary Solana wallets.')}
function extensionData(data:Buffer,kind:'mint'|'account',marketCandidate=false){
 const seen=new Set<number>();let offset=0
 while(offset<data.length){
  if(data.length-offset<4)throw new Error('Malformed token extension data.')
  const type=data.readUInt16LE(offset),length=data.readUInt16LE(offset+2)
  if(seen.has(type)||offset+4+length>data.length)throw new Error('Malformed token extension data.')
  seen.add(type)
  const allowed=kind==='account'?(type===ExtensionType.ImmutableOwner&&length===0)||(marketCandidate&&type===ExtensionType.TransferFeeAmount&&length===TRANSFER_FEE_AMOUNT_SIZE):(type===ExtensionType.MetadataPointer&&length===64)||(type===ExtensionType.TokenMetadata&&length>=80)||(marketCandidate&&type===ExtensionType.TransferFeeConfig&&length===TRANSFER_FEE_CONFIG_SIZE)
  if(!allowed)throw new Error('This token has an unsupported extension. Only metadata-only Token-2022 assets are supported.')
  offset+=length+4
 }
}
export function relayProgram(value:string){const key=new PublicKey(relayAddress(value));if(!key.equals(TOKEN_PROGRAM_ID)&&!key.equals(TOKEN_2022_PROGRAM_ID))throw new Error('Unsupported token program.');return key}
export function checkedRelayMint(address:PublicKey,info:AccountInfo<Buffer>|null,program:PublicKey,marketCandidate=false){
 if(!info||info.executable||!info.owner.equals(program))throw new Error('The token mint or program could not be verified.')
 const mint=unpackMint(address,info,program)
 if(!mint.isInitialized)throw new Error('The token mint is not initialized.')
 if(address.equals(NATIVE_MINT)||address.equals(NATIVE_MINT_2022))throw new Error('SOL and wrapped SOL are excluded from Relay.')
 if(!program.equals(TOKEN_2022_PROGRAM_ID)&&mint.tlvData.length)throw new Error('Unsupported token mint extensions.')
 extensionData(mint.tlvData,'mint',marketCandidate);return mint
}
export function checkedRelayAccount(address:PublicKey,info:AccountInfo<Buffer>|null,program:PublicKey,mint:PublicKey,owner:PublicKey,marketCandidate=false){
 if(!info||info.executable||!info.owner.equals(program))throw new Error('The token account or program could not be verified.')
 const account=unpackAccount(address,info,program)
 if(!account.owner.equals(owner)||!account.mint.equals(mint))throw new Error('The token account owner or mint changed. Scan again.')
 if(account.isNative||account.mint.equals(NATIVE_MINT)||account.mint.equals(NATIVE_MINT_2022))throw new Error('SOL and wrapped SOL are excluded from Relay.')
 if(!account.isInitialized||account.isFrozen)throw new Error('The token account is frozen or uninitialized.')
 if(!program.equals(TOKEN_2022_PROGRAM_ID)&&account.tlvData.length)throw new Error('Unsupported token account extensions.')
 extensionData(account.tlvData,'account',marketCandidate);return account
}
/** Complete bounded inventory. Unsupported accounts stay visible with an explanation. No keys or sends. */
export async function scanRelayWallet(connection:Connection,address:string):Promise<RelayWalletScan>{
 const owner=new PublicKey(relayAddress(address,true));await assertRelayNetwork(connection)
 const [ownerInfo,balance,...inventories]=await Promise.all([withTimeout(connection.getAccountInfo(owner,'confirmed')),withTimeout(connection.getBalance(owner,'confirmed')),...[TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].map(async program=>({program,response:await withTimeout(connection.getTokenAccountsByOwner(owner,{programId:program},'confirmed'))}))])
 requireRelayWallet(ownerInfo as AccountInfo<Buffer>|null)
 const sources=inventories as {program:PublicKey;response:Awaited<ReturnType<Connection['getTokenAccountsByOwner']>>}[]
 if(sources.some(value=>value.response.value.length>200))throw new Error('A wallet has more than 200 token accounts for one program. Review a smaller inventory before using Relay.')
 const rows=sources.flatMap(({program,response})=>response.value.map(value=>({...value,program}))),mintIds=new Set<string>()
 for(const row of rows)try{mintIds.add(unpackAccount(row.pubkey,row.account,row.program).mint.toBase58())}catch{/* Keep malformed account visible below. */}
 const mintInfos=new Map<string,AccountInfo<Buffer>|null>(),ids=[...mintIds]
 for(let offset=0;offset<ids.length;offset+=100){const batch=ids.slice(offset,offset+100),infos=await withTimeout(connection.getMultipleAccountsInfo(batch.map(value=>new PublicKey(value)),'confirmed'));batch.forEach((value,index)=>mintInfos.set(value,infos[index]))}
 const seen=new Set<string>(),assets:RelayAsset[]=rows.map(row=>{
  const asset:RelayAsset={account:row.pubkey.toBase58(),mint:'',tokenProgram:row.program.toBase58(),amountRaw:'0',decimals:0,eligible:false,saleEligible:false}
  try{
   if(seen.has(asset.account))throw new Error('RPC returned a duplicate token account.');seen.add(asset.account)
   const account=unpackAccount(row.pubkey,row.account,row.program);asset.mint=account.mint.toBase58();asset.amountRaw=account.amount.toString()
   checkedRelayAccount(row.pubkey,row.account,row.program,account.mint,owner,true)
   const mint=checkedRelayMint(account.mint,mintInfos.get(asset.mint)??null,row.program,true);asset.decimals=mint.decimals
   if(!account.amount)throw new Error('Token account is empty.')
   asset.saleEligible=true
   checkedRelayAccount(row.pubkey,row.account,row.program,account.mint,owner)
   checkedRelayMint(account.mint,mintInfos.get(asset.mint)??null,row.program)
   asset.eligible=true
  }catch(error){asset.reason=error instanceof Error?error.message:'This token account cannot be verified.'}
  return asset
 })
 return{owner:owner.toBase58(),solLamports:relayLamports(balance).toString(),assets,scannedAt:new Date().toISOString()}
}
