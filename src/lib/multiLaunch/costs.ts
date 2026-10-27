import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {fetchBounded} from '@/lib/transactions/http'
import {throwIfAborted} from '@/lib/transactions/send'

export interface MultiLaunchCosts {rowDebitsLamports:string[];totalDebitLamports:string}
/** Snapshot every ordered row in the same simulation bank, including shared-account rent. */
export async function simulateMultiLaunchCosts(connection:Connection,groups:VersionedTransaction[][],options:{payer:string;signal?:AbortSignal}):Promise<MultiLaunchCosts>{
 throwIfAborted(options.signal)
 const packets=groups.flat()
 if(groups.length<2||groups.length>5||groups.some(group=>!group.length)||packets.length>5)throw new Error('The complete multi-launch preview supports up to five packets. Shorten token details to use one packet per token, or prepare fewer tokens.')
 if(packets.some(packet=>packet.serialize().length>1232))throw new Error('A launch packet exceeds the Solana packet limit.')
 const account={encoding:'base64',addresses:[new PublicKey(options.payer).toBase58()]}
 const response=await fetchBounded(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:packets.map(packet=>Buffer.from(packet.serialize()).toString('base64'))},{transactionEncoding:'base64',skipSigVerify:true,replaceRecentBlockhash:true,preExecutionAccountsConfigs:packets.map(()=>account),postExecutionAccountsConfigs:packets.map(()=>account)}]})},result=>result.json())
 throwIfAborted(options.signal)
 const value=response.result?.value,results=value?.transactionResults
 if(response.error||value?.summary!=='succeeded'||!Array.isArray(results)||results.length!==packets.length||results.some(result=>result.err!==null))throw new Error('The RPC could not simulate every launch together for a complete same-bank cost preview.')
 const snapshots=results.map(result=>{
  const before=result.preExecutionAccounts?.[0]?.lamports,after=result.postExecutionAccounts?.[0]?.lamports
  if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||before<0||after<0||after>before)throw new Error('A complete simulated wallet debit could not be verified.')
  return {before:BigInt(before),after:BigInt(after)}
 })
 if(snapshots.some((snapshot,index)=>index>0&&snapshot.before!==snapshots[index-1].after))throw new Error('The cost preview did not preserve one ordered simulation bank.')
 let cursor=0
 const rowDebitsLamports=groups.map(group=>{const first=cursor;cursor+=group.length;return (snapshots[first].before-snapshots[cursor-1].after).toString()})
 const total=snapshots[0].before-snapshots[snapshots.length-1].after
 if(rowDebitsLamports.reduce((sum,debit)=>sum+BigInt(debit),0n)!==total)throw new Error('The complete batch cost did not match its rows.')
 return {rowDebitsLamports,totalDebitLamports:total.toString()}
}
