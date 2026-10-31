import {Connection,PublicKey,VersionedTransaction,type AccountInfo} from '@solana/web3.js'
import {getAssociatedTokenAddressSync} from '@solana/spl-token'
import {withTimeout} from '@/lib/transactions/http'
import {prepareWalletOperation,type PreparedWalletOperation} from '@/lib/walletOperations/builder'
import {formatUnits} from '@/lib/walletOperations/model'
import {assertRelayNetwork,checkedRelayAccount,checkedRelayMint,relayAddress,relayProgram,relayRaw,requireRelayWallet} from './scan'
import type {PreparedRelayTransfer,RelayTransferInput} from './types'

interface RelayPlanState {connection:Connection;input:RelayTransferInput;operation:PreparedWalletOperation;publicSnapshot:string}
const states=new WeakMap<PreparedRelayTransfer,RelayPlanState>()
export function normalizedRelayInput(value:RelayTransferInput):RelayTransferInput{
 if(!value||typeof value!=='object')throw new Error('Choose the source, destination and token amount.')
 const source=relayAddress(value.source,true),destination=relayAddress(value.destination,true)
 if(source===destination)throw new Error('Source and destination wallets must be different.')
 const amountRaw=relayRaw(value.amountRaw).toString(),priorityFeeLamports=relayRaw(value.priorityFeeLamports??'0',true).toString()
 if(BigInt(priorityFeeLamports)>10000000n)throw new Error('Priority fee must not exceed 0.01 SOL.')
 if(!Number.isInteger(value.decimals)||value.decimals<0||value.decimals>255)throw new Error('Invalid token decimals.')
 return{source,destination,mint:relayAddress(value.mint),sourceAccount:relayAddress(value.sourceAccount),tokenProgram:relayProgram(value.tokenProgram).toBase58(),amountRaw,decimals:value.decimals,priorityFeeLamports}
}
export async function verifyRelayTransferAccounts(connection:Connection,input:RelayTransferInput,expectedSourceRaw?:string){
 const source=new PublicKey(input.source),destination=new PublicKey(input.destination),mint=new PublicKey(input.mint),account=new PublicKey(input.sourceAccount),program=relayProgram(input.tokenProgram),ata=getAssociatedTokenAddressSync(mint,destination,false,program)
 const infos=await withTimeout(connection.getMultipleAccountsInfo([source,destination,mint,account,ata],'confirmed'))
 requireRelayWallet(infos[0],true);requireRelayWallet(infos[1])
 const state=checkedRelayMint(mint,infos[2],program),token=checkedRelayAccount(account,infos[3],program,mint,source)
 if(state.decimals!==input.decimals)throw new Error('Token decimals changed. Scan and review again.')
 if(token.amount<BigInt(input.amountRaw))throw new Error('The reviewed token amount exceeds the source balance.')
 if(expectedSourceRaw!==undefined&&token.amount.toString()!==expectedSourceRaw)throw new Error('The source token balance changed since review. Prepare a fresh preview.')
 if(ata.equals(account))throw new Error('The destination token account must be different from the source.')
 if(infos[4])checkedRelayAccount(ata,infos[4],program,mint,destination)
 return{sourceRaw:token.amount.toString(),infos:infos as (AccountInfo<Buffer>|null)[]}
}
/** Read-only: all balances, account rent and fees are measured in one simulation bank. */
export async function prepareRelayTransfer(connection:Connection,value:RelayTransferInput):Promise<PreparedRelayTransfer>{
 const input=normalizedRelayInput(value);await assertRelayNetwork(connection);await verifyRelayTransferAccounts(connection,input)
 const operation=await prepareWalletOperation(connection,{kind:'token',payer:input.source,mint:input.mint,sourceAccount:input.sourceAccount,priorityFeeSol:formatUnits(input.priorityFeeLamports!,9),recipients:[{address:input.destination,amount:formatUnits(input.amountRaw,input.decimals)}]})
 if(operation.intent.tokenProgram!==input.tokenProgram||operation.intent.decimals!==input.decimals||operation.intent.recipients?.[0]?.rawAmount!==input.amountRaw)throw new Error('The token program or reviewed amount changed. Prepare again.')
 const measured=operation.preview,rent=-BigInt(measured.rentChangeLamports),debit=BigInt(measured.payerBeforeLamports)-BigInt(measured.payerAfterLamports)
 if(rent<0n||debit!==BigInt(measured.networkFeeLamports)+rent)throw new Error('The Relay debit contains an unexpected SOL movement.')
 const prepared:PreparedRelayTransfer={input:structuredClone(input),preview:{sourceBeforeLamports:measured.payerBeforeLamports,sourceAfterLamports:measured.payerAfterLamports,networkFeeLamports:measured.networkFeeLamports,destinationRentLamports:rent.toString(),maxDebitLamports:debit.toString(),sourceTokenBeforeRaw:measured.sourceBeforeRaw!,sourceTokenAfterRaw:measured.sourceAfterRaw!,destinationBeforeRaw:measured.recipients[0].beforeRaw,destinationAfterRaw:measured.recipients[0].afterRaw},createdAt:operation.createdAt,blockhash:operation.transaction.message.recentBlockhash,lastValidBlockHeight:operation.lastValidBlockHeight}
 states.set(prepared,{connection,input:structuredClone(input),operation,publicSnapshot:JSON.stringify(prepared)})
 return prepared
}
/** Internal immutable capability. A JSON copy or changed public review is never executable. */
export function relayPlanState(prepared:PreparedRelayTransfer,connection:Connection):RelayPlanState{
 const state=states.get(prepared)
 if(!state||state.connection!==connection)throw new Error('Use a prepared Relay preview from this connection.')
 if(state.publicSnapshot!==JSON.stringify(prepared))throw new Error('The reviewed Relay preview changed. Prepare again.')
 // Internal consumers receive working copies too; the WeakMap's approval snapshot
 // cannot be mutated through an imported helper or a signed wallet callback.
 return{...state,input:structuredClone(state.input),operation:{...state.operation,intent:structuredClone(state.operation.intent),preview:structuredClone(state.operation.preview),transaction:VersionedTransaction.deserialize(state.operation.transaction.serialize())}}
}
