import {Connection,PublicKey,SystemProgram,VersionedTransaction,type AccountInfo} from '@solana/web3.js'
import {buildWalletOperationTransaction,inspectWalletOperationIntent,type WalletOperationPreview} from '../walletOperations/builder'
import {publicWalletOperationIntent} from '../walletOperations/history'
import type {WalletOperationIntent} from '../walletOperations/model'
import {fetchBounded,withTimeout} from '../transactions/http'

export function exactLamports(value:unknown):bigint{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('A SOL balance could not be read exactly.');return BigInt(value)}
function systemLamports(value:unknown):bigint{
 if(value===null)return 0n
 if(!value||typeof value!=='object')throw new Error('The RPC returned an incomplete SOL account.')
 const info=value as {owner?:string;executable?:boolean;data?:unknown;lamports?:unknown}
 if(info.owner!==SystemProgram.programId.toBase58()||info.executable||!Array.isArray(info.data)||info.data[0]!==''||info.data[1]!=='base64')throw new Error('Use ordinary Solana wallets for group SOL transfers.')
 return exactLamports(info.lamports)
}
/** Same-bank SOL-only simulation, including a legitimate sender drain to zero. */
export async function simulateGroupSol(connection:Connection,transaction:VersionedTransaction,input:WalletOperationIntent,signed=false,quotedNetworkFee?:string):Promise<WalletOperationPreview>{
 const intent=publicWalletOperationIntent(input)
 if(intent.kind!=='sol')throw new Error('Group operations support SOL transfers only.')
 inspectWalletOperationIntent(transaction,intent)
 const addresses=[intent.payer,...intent.recipients!.map(value=>value.address)]
 if(!signed)await withTimeout(connection.getMultipleAccountsInfo(transaction.message.staticAccountKeys,'confirmed'))
 const snapshot={encoding:'base64',addresses}
 const [response,fee]=await Promise.all([
  fetchBounded<any>(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:[Buffer.from(transaction.serialize()).toString('base64')]},{transactionEncoding:'base64',skipSigVerify:!signed,replaceRecentBlockhash:false,preExecutionAccountsConfigs:[snapshot],postExecutionAccountsConfigs:[snapshot]}]})},response=>response.json()),
  // The fee calculator belongs to this recent blockhash and message shape.
  // Preparation may share its exact quote across equivalent SOL transfers;
  // signed re-simulation reuses the review after message equality. The actual
  // same-bank payer debit below must still equal transfers plus this exact fee.
  quotedNetworkFee!==undefined?Promise.resolve({value:Number(quotedNetworkFee)}):withTimeout(connection.getFeeForMessage(transaction.message,'confirmed')),
 ])
 const value=response.result?.value,result=value?.transactionResults?.[0]
 if(response.error||value?.summary!=='succeeded'||value.transactionResults?.length!==1||result?.err!==null||!Array.isArray(result.preExecutionAccounts)||!Array.isArray(result.postExecutionAccounts)||result.preExecutionAccounts.length!==addresses.length||result.postExecutionAccounts.length!==addresses.length||fee.value===null)throw new Error(`The complete group transfer simulation did not pass. Nothing new was submitted.${result?.err?` ${JSON.stringify(result.err)}`:''}`)
 const before=result.preExecutionAccounts.map(systemLamports) as bigint[],after=result.postExecutionAccounts.map(systemLamports) as bigint[],networkFee=exactLamports(fee.value)
 if(!result.preExecutionAccounts[0])throw new Error('The sending wallet is not funded.')
 const recipients=intent.recipients!.map((recipient,index)=>{if(after[index+1]-before[index+1]!==BigInt(recipient.rawAmount))throw new Error('The simulated recipient amount changed.');return{...recipient,beforeRaw:before[index+1].toString(),afterRaw:after[index+1].toString()}})
 const total=intent.recipients!.reduce((sum,recipient)=>sum+BigInt(recipient.rawAmount),0n)
 if(before[0]-after[0]!==total+networkFee)throw new Error('The simulated group debit does not match its transfers and fee.')
 return{payerBeforeLamports:before[0].toString(),payerAfterLamports:after[0].toString(),networkFeeLamports:networkFee.toString(),rentChangeLamports:'0',recipients}
}
export async function quoteGroupSolFee(connection:Connection,payer:string,destination:string,priorityLamports:string,blockhash:string):Promise<bigint>{
 const transaction=buildWalletOperationTransaction({kind:'sol',payer,priorityLamports,recipients:[{address:destination,rawAmount:'1'}]},blockhash)
 const result=await withTimeout(connection.getFeeForMessage(transaction.message,'confirmed'))
 if(result.value===null)throw new Error('A current network fee could not be quoted.')
 return exactLamports(result.value)
}
export async function ordinaryWalletBalance(connection:Connection,address:string):Promise<bigint>{
 const info=await withTimeout(connection.getAccountInfo(new PublicKey(address),'confirmed'))
 return ordinaryAccountBalance(info)
}
export function ordinaryAccountBalance(info:AccountInfo<Buffer>|null):bigint{
 if(!info)return 0n
 if(info.executable||!info.owner.equals(SystemProgram.programId)||info.data.length)throw new Error('Use ordinary Solana wallet accounts for group transfers.')
 return exactLamports(info.lamports)
}
