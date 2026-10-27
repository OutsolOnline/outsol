import {Connection,PublicKey} from '@solana/web3.js'
import {buildWalletOperationTransaction,prepareWalletOperation,type PreparedWalletOperation} from '../walletOperations/builder'
import {formatUnits,parseExactUnits,publicAddress,type WalletOperationIntent} from '../walletOperations/model'
import {withTimeout} from '../transactions/http'
import {exactLamports,ordinaryAccountBalance,ordinaryWalletBalance,quoteGroupSolFee,simulateGroupSol} from './simulate'
import type {GroupPreviewRow,GroupWallet,PrepareGroupInput,PreparedGroupOperation} from './types'
const MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
export function normalizeGroupInput(input:PrepareGroupInput):PrepareGroupInput{
 if(!input||!['fund','withdraw'].includes(input.kind)||typeof input.groupName!=='string'||!input.groupName.trim()||input.groupName.length>60||/[\u0000-\u001f\u007f]/.test(input.groupName))throw new Error('Choose a valid named wallet group.')
 if(input.groupId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.groupId))throw new Error('Choose a valid group identifier.')
 if(!Array.isArray(input.wallets)||!input.wallets.length||input.wallets.length>20)throw new Error('A group operation supports one to twenty (20) wallets.')
 const wallets:GroupWallet[]=input.wallets.map(wallet=>{if(!wallet||typeof wallet.id!=='string'||!wallet.id||wallet.id.length>60||typeof wallet.name!=='string'||!wallet.name.trim()||wallet.name.length>60||/[\u0000-\u001f\u007f]/.test(wallet.name))throw new Error('Every group member needs a public name and identifier.');return{id:wallet.id,name:wallet.name,address:publicAddress(wallet.address,true)}})
 if(new Set(wallets.map(value=>value.id)).size!==wallets.length||new Set(wallets.map(value=>value.address)).size!==wallets.length)throw new Error('Every group member must be distinct.')
 const priority=parseExactUnits(input.priorityFeeSol,9,true)
 if(priority>10000000n)throw new Error('Priority fee must be between 0 and 0.01 SOL.')
 const base={groupName:input.groupName, ...(input.groupId?{groupId:input.groupId}:{}),wallets,priorityFeeSol:input.priorityFeeSol}
 if(input.kind==='fund'){parseExactUnits(input.amountSol,9);return{...base,kind:'fund',payer:publicAddress(input.payer,true),amountSol:input.amountSol}}
 if(!['available','fixed'].includes(input.amountMode))throw new Error('Choose an available-balance or fixed-amount withdrawal mode.')
 parseExactUnits(input.reserveSol,9,true)
 if(input.amountMode==='fixed')parseExactUnits(input.amountSol||'',9)
 return{...base,kind:'withdraw',destination:publicAddress(input.destination,true),amountMode:input.amountMode,...(input.amountMode==='fixed'?{amountSol:input.amountSol}:{}),reserveSol:input.reserveSol}
}
export function calculateAvailableWithdrawal(balance:bigint,fee:bigint,reserve:bigint,rentMinimum:bigint):{transfer:bigint;remaining:bigint}{
 if(reserve>0n&&reserve<rentMinimum)throw new Error(`The retained reserve must be 0 or at least ${formatUnits(rentMinimum,9)} SOL, the current ordinary-account rent minimum.`)
 if(balance<=fee+reserve)return{transfer:0n,remaining:balance}
 return{transfer:balance-fee-reserve,remaining:reserve}
}
function skipped(wallet:GroupWallet,balance:bigint,reason:string):GroupPreviewRow{return{walletId:wallet.id,name:wallet.name,address:wallet.address,beforeLamports:balance.toString(),afterLamports:balance.toString(),transferLamports:'0',networkFeeLamports:'0',status:'skipped',reason}}
export async function prepareGroupOperation(connection:Connection,raw:PrepareGroupInput):Promise<PreparedGroupOperation>{
 const input=normalizeGroupInput(raw),createdAt=Date.now()
 const [genesis,rent]=await Promise.all([withTimeout(connection.getGenesisHash()),withTimeout(connection.getMinimumBalanceForRentExemption(0))])
 if(genesis!==MAINNET_GENESIS)throw new Error('Group wallet operations support Solana mainnet.')
 const minimum=exactLamports(rent),transactions:PreparedWalletOperation[]=[],rows:GroupPreviewRow[]=[]
 const base={id:crypto.randomUUID(),kind:input.kind,groupName:input.groupName,...(input.groupId?{groupId:input.groupId}:{}),createdAt,expiresAt:createdAt+60000}
 if(input.kind==='fund'){
  const amount=parseExactUnits(input.amountSol,9),selected=input.wallets.filter(wallet=>wallet.address!==input.payer)
  if(!selected.length)throw new Error('The group contains only the sending wallet. Choose a different group or funder.')
  const initial=await ordinaryWalletBalance(connection,input.payer)
  let spent=0n,totalFees=0n
  for(let offset=0;offset<selected.length;offset+=8){
   const members=selected.slice(offset,offset+8),prepared=await prepareWalletOperation(connection,{kind:'sol',payer:input.payer,priorityFeeSol:input.priorityFeeSol,recipients:members.map(wallet=>({address:wallet.address,amount:input.amountSol}))})
   if(BigInt(prepared.preview.payerBeforeLamports)!==initial)throw new Error('The funding wallet balance changed while preparing. Prepare again.')
   const debit=BigInt(prepared.preview.payerBeforeLamports)-BigInt(prepared.preview.payerAfterLamports)
   if(spent+debit>initial)throw new Error('The funding wallet does not have enough SOL for the whole group and every network fee.')
   prepared.preview={...prepared.preview,payerBeforeLamports:(initial-spent).toString(),payerAfterLamports:(initial-spent-debit).toString()}
   transactions.push(prepared);spent+=debit;totalFees+=BigInt(prepared.preview.networkFeeLamports)
   for(const wallet of members){const recipient=prepared.preview.recipients.find(value=>value.address===wallet.address)!;rows.push({walletId:wallet.id,name:wallet.name,address:wallet.address,beforeLamports:recipient.beforeRaw,afterLamports:recipient.afterRaw,transferLamports:amount.toString(),networkFeeLamports:'0',status:'ready'})}
  }
  const remaining=initial-spent
  if(remaining>0n&&remaining<minimum)throw new Error(`The whole-group funding would leave the sender below its ${formatUnits(minimum,9)} SOL rent minimum. Reduce the funding amount.`)
  for(const wallet of input.wallets.filter(wallet=>wallet.address===input.payer))rows.push({...skipped(wallet,initial,'The funding wallet is already the sender and will not fund itself.'),afterLamports:remaining.toString()})
  return{...base,transactions,rows,summary:{walletCount:input.wallets.length,transactionCount:transactions.length,totalTransferLamports:(amount*BigInt(selected.length)).toString(),totalNetworkFeeLamports:totalFees.toString(),platformFeeLamports:'0',reserveLamports:'0',payerBeforeLamports:initial.toString(),payerAfterLamports:remaining.toString()}}
 }
 const reserve=parseExactUnits(input.reserveSol,9,true)
 calculateAvailableWithdrawal(0n,0n,reserve,minimum)
 const addresses=[...new Set([...input.wallets.map(wallet=>wallet.address),input.destination])]
 const[accounts,latest]=await Promise.all([withTimeout(connection.getMultipleAccountsInfo(addresses.map(address=>new PublicKey(address)),'confirmed')),withTimeout(connection.getLatestBlockhash('confirmed'))])
 const balances=new Map(addresses.map((address,index)=>[address,ordinaryAccountBalance(accounts[index])]))
 const destinationBefore=balances.get(input.destination)!,priority=parseExactUnits(input.priorityFeeSol,9,true).toString()
 const quotingWallet=input.wallets.find(wallet=>wallet.address!==input.destination&&(balances.get(wallet.address)||0n)>0n)
 const quotedFee=quotingWallet?await quoteGroupSolFee(connection,quotingWallet.address,input.destination,priority,latest.blockhash):0n
 let received=0n,totalFees=0n
 for(const wallet of input.wallets){
  const balance=balances.get(wallet.address)!
  if(wallet.address===input.destination){rows.push(skipped(wallet,balance,'This wallet is the withdrawal destination.'));continue}
  if(balance===0n){rows.push(skipped(wallet,balance,'This wallet has no SOL to withdraw.'));continue}
  const fee=quotedFee
  const amount=input.amountMode==='available'?calculateAvailableWithdrawal(balance,fee,reserve,minimum).transfer:parseExactUnits(input.amountSol!,9)
  if(amount===0n||balance<amount+fee+reserve){rows.push(skipped(wallet,balance,'Insufficient SOL for the requested withdrawal, network fee and retained reserve.'));continue}
  const remaining=balance-amount-fee
  if(remaining>0n&&remaining<minimum){rows.push(skipped(wallet,balance,`The remaining balance would be below the current ${formatUnits(minimum,9)} SOL rent minimum.`));continue}
  const intent:WalletOperationIntent={kind:'sol',payer:wallet.address,priorityLamports:priority,recipients:[{address:input.destination,rawAmount:amount.toString()}]}
  const transaction=buildWalletOperationTransaction(intent,latest.blockhash),preview=await simulateGroupSol(connection,transaction,intent,false,fee.toString())
  if(BigInt(preview.payerBeforeLamports)!==balance||BigInt(preview.networkFeeLamports)!==fee||BigInt(preview.recipients[0].beforeRaw)!==destinationBefore)throw new Error('A group wallet or destination balance changed while preparing. Prepare again.')
  preview.recipients=[{...preview.recipients[0],beforeRaw:(destinationBefore+received).toString(),afterRaw:(destinationBefore+received+amount).toString()}]
  transactions.push({intent,transaction,preview,message:Buffer.from(transaction.message.serialize()).toString('base64'),lastValidBlockHeight:latest.lastValidBlockHeight,createdAt})
  rows.push({walletId:wallet.id,name:wallet.name,address:wallet.address,beforeLamports:balance.toString(),afterLamports:remaining.toString(),transferLamports:amount.toString(),networkFeeLamports:fee.toString(),status:'ready'})
  received+=amount;totalFees+=fee
 }
 for(const row of rows)if(row.address===input.destination)row.afterLamports=(destinationBefore+received).toString()
 return{...base,transactions,rows,summary:{walletCount:input.wallets.length,transactionCount:transactions.length,totalTransferLamports:received.toString(),totalNetworkFeeLamports:totalFees.toString(),platformFeeLamports:'0',reserveLamports:reserve.toString(),destinationBeforeLamports:destinationBefore.toString(),destinationAfterLamports:(destinationBefore+received).toString()}}
}
