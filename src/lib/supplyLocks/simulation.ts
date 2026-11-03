import {Connection,PublicKey,SystemProgram,VersionedTransaction,type AccountInfo} from '@solana/web3.js'
import {unpackAccount,unpackMint} from '@solana/spl-token'
import {creatorSimulationAccount,type CreatorSimulationBank} from '../creatorOperations/simulation'
import {fetchBounded,withTimeout} from '../transactions/http'
import {creatorAmount} from '../creatorOperations/model'
import {LOCK_PROGRAM,LOCK_ORACLE,parseSupplyLockIntent,type SupplyLockIntent,type SupplyLockPreview} from './model'
import {assertSupplyLockTransaction,supplyLockAccounts,decodeSupplyLockContract} from './native'

const safe=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('A simulated lock balance is not exact.');return BigInt(value)}
function ordinary(account:AccountInfo<Buffer>|null):void{if(!account||!account.owner.equals(SystemProgram.programId)||account.data.length)throw new Error('The simulated signing wallet is invalid.')}
/** Verify the actual escrow, immutable contract, source debit, token fee and complete SOL cost. */
export function validateSupplyLockSimulation(value:SupplyLockIntent,bank:CreatorSimulationBank):SupplyLockPreview{
 const intent=parseSupplyLockIntent(value),accounts=supplyLockAccounts(intent),program=accounts.tokenProgram
 if(bank.addresses.length<1||bank.addresses.length>40||new Set(bank.addresses).size!==bank.addresses.length||bank.before.length!==bank.addresses.length||bank.after.length!==bank.addresses.length)throw new Error('The supply lock simulation is incomplete.')
 const before=bank.before.map(creatorSimulationAccount),after=bank.after.map(creatorSimulationAccount),at=(rows:(AccountInfo<Buffer>|null)[],address:PublicKey)=>{const index=bank.addresses.indexOf(address.toBase58());if(index<0)throw new Error('A required lock account is absent from simulation.');return rows[index]}
 const payerBefore=at(before,accounts.sender),payerAfter=at(after,accounts.sender);ordinary(payerBefore);ordinary(payerAfter)
 const token=(rows:(AccountInfo<Buffer>|null)[],address:PublicKey,owner?:PublicKey)=>{const info=at(rows,address);if(!info)return 0n;const account=unpackAccount(address,info,program);if(!account.mint.equals(accounts.mint)||owner&&!account.owner.equals(owner)||account.isFrozen||account.delegate||account.closeAuthority)throw new Error('A simulated token account has unexpected mint or authority.');return account.amount}
 const sourceBefore=token(before,accounts.senderTokens,accounts.sender),sourceAfter=token(after,accounts.senderTokens,accounts.sender)
 if(sourceBefore-sourceAfter!==BigInt(intent.sourceDebitRaw))throw new Error('The simulated source debit differs from the reviewed lock amount plus token fee.')
 if(at(before,accounts.metadata)||at(before,accounts.escrowTokens))throw new Error('This lock identity already exists. Prepare a new lock.')
 const metadata=at(after,accounts.metadata),escrow=at(after,accounts.escrowTokens)
 if(!metadata?.owner.equals(LOCK_PROGRAM)||metadata.data.length<819||!escrow?.owner.equals(program))throw new Error('The new Streamflow lock or escrow could not be verified.')
 const contract=decodeSupplyLockContract(metadata.data)
 for(const [field,address] of Object.entries({sender:accounts.sender,senderTokens:accounts.senderTokens,recipient:accounts.recipient,recipientTokens:accounts.recipientTokens,mint:accounts.mint,escrowTokens:accounts.escrowTokens,streamflowTreasury:accounts.streamflowTreasury,streamflowTreasuryTokens:accounts.streamflowTreasuryTokens,partner:accounts.partner,partnerTokens:accounts.partnerTokens}))if((contract[field as keyof typeof contract] as PublicKey).toBase58()!==address.toBase58())throw new Error('The simulated escrow has a different lock recipient, token or fee account.')
 // The deployed program clamps the SDK's1-second frequency to30 seconds;
 // automatic withdrawal remains disabled and the full deposit is the cliff.
 if(contract.start.toString()!==String(intent.unlockAt)||contract.cliff.toString()!==String(intent.unlockAt)||contract.depositedAmount.toString()!==intent.amountRaw||contract.cliffAmount.toString()!==intent.amountRaw||contract.period.toString()!=='1'||contract.amountPerPeriod.toString()!=='1'||contract.withdrawFrequency.toString()!=='30'||BigInt(contract.createdAt.toString())>BigInt(intent.unlockAt-60)||contract.cancelableBySender||contract.cancelableByRecipient||contract.transferableBySender||contract.transferableByRecipient||contract.canTopup||contract.automaticWithdrawal||contract.closed||!contract.isPda||contract.nonce!==intent.nonce||!contract.withdrawnAmount.isZero()||!contract.canceledAt.isZero()||metadata.data[539]!==0||metadata.data[540]!==0)throw new Error('The simulated contract does not match the future immutable lock schedule.')
 if(contract.streamflowFeeTotal.toString()!==intent.tokenFeeRaw||Math.round(Number(contract.streamflowFeePercent.toFixed(4))*10000)!==intent.feeUnits||!contract.partnerFeeTotal.isZero()||contract.partnerFeePercent!==0||metadata.data.readUInt32LE(704)!==Number(intent.creationFeeLamports))throw new Error('The simulated Streamflow fees differ from the reviewed live oracle.')
 const escrowAccount=unpackAccount(accounts.escrowTokens,escrow,program)
 if(!escrowAccount.owner.equals(accounts.metadata)&&!escrowAccount.owner.equals(accounts.escrowTokens)||escrowAccount.delegate||escrowAccount.closeAuthority||escrowAccount.isFrozen)throw new Error('The lock escrow is not controlled by its protocol-derived authority.')
 const feeWithdrawn=BigInt(contract.streamflowFeeWithdrawn.toString()),treasuryChange=token(after,accounts.streamflowTreasuryTokens,accounts.streamflowTreasury)-token(before,accounts.streamflowTreasuryTokens,accounts.streamflowTreasury)
 // Contract fee counters do not establish current token custody. Prove the
 // source debit is entirely in escrow plus the canonical treasury instead.
 if(feeWithdrawn>BigInt(intent.tokenFeeRaw)||treasuryChange<0n||treasuryChange>BigInt(intent.tokenFeeRaw)||escrowAccount.amount<BigInt(intent.amountRaw)||escrowAccount.amount+treasuryChange!==BigInt(intent.sourceDebitRaw))throw new Error('The escrow reserve or protocol token fee does not balance exactly.')
 if(!accounts.recipient.equals(accounts.sender)&&token(after,accounts.recipientTokens,accounts.recipient)!==token(before,accounts.recipientTokens,accounts.recipient))throw new Error('Tokens escaped to the recipient before the reviewed unlock.')
 const mintBefore=at(before,accounts.mint),mintAfter=at(after,accounts.mint)
 if(!mintBefore||!mintAfter||!mintBefore.owner.equals(program)||!mintAfter.owner.equals(program)||!mintBefore.data.equals(mintAfter.data)||unpackMint(accounts.mint,mintAfter,program).supply!==unpackMint(accounts.mint,mintBefore,program).supply)throw new Error('A token lock must preserve mint supply and authorities.')
 const fee=BigInt(creatorAmount(bank.networkFeeLamports)),payerBeforeRaw=safe(payerBefore!.lamports),payerAfterRaw=safe(payerAfter!.lamports),debit=payerBeforeRaw-payerAfterRaw,rent=debit-fee-BigInt(intent.creationFeeLamports)
 if(debit<0n||rent<0n||before.reduce((sum,account)=>sum+(account?safe(account.lamports):0n),0n)-after.reduce((sum,account)=>sum+(account?safe(account.lamports):0n),0n)!==fee)throw new Error('The lock SOL cost does not reconcile with fees, account rent and wallet balances.')
 return{payerBeforeLamports:payerBeforeRaw.toString(),payerAfterLamports:payerAfterRaw.toString(),networkFeeLamports:fee.toString(),rentLamports:rent.toString(),creationFeeLamports:intent.creationFeeLamports,maxDebitLamports:debit.toString(),sourceBeforeRaw:sourceBefore.toString(),sourceAfterRaw:sourceAfter.toString(),lockedRaw:intent.amountRaw,tokenFeeRaw:intent.tokenFeeRaw}
}
export async function simulateSupplyLock(connection:Connection,transaction:VersionedTransaction,intent:SupplyLockIntent,signed=false,guard:()=>void=()=>{}):Promise<SupplyLockPreview>{
 await assertSupplyLockTransaction(transaction,intent);guard()
 const addresses=[...new Set([...transaction.message.staticAccountKeys.filter((_,index)=>transaction.message.isAccountWritable(index)).map(key=>key.toBase58()),intent.mint,LOCK_ORACLE.toBase58()])]
 await withTimeout(connection.getMultipleAccountsInfo(transaction.message.staticAccountKeys,'confirmed'));guard()
 const config={encoding:'base64',addresses},[response,fee]=await Promise.all([
  fetchBounded<{error?:unknown;result?:{value?:{summary?:string;transactionResults?:{err:unknown;preExecutionAccounts:unknown[];postExecutionAccounts:unknown[]}[]}}}>(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:[Buffer.from(transaction.serialize()).toString('base64')]},{transactionEncoding:'base64',skipSigVerify:!signed,replaceRecentBlockhash:false,preExecutionAccountsConfigs:[config],postExecutionAccountsConfigs:[config]}]})},response=>response.json()),
  withTimeout(connection.getFeeForMessage(transaction.message,'confirmed')),
 ]);guard()
 const value=response.result?.value,row=value?.transactionResults?.[0]
 if(response.error||value?.summary!=='succeeded'||value.transactionResults?.length!==1||row?.err!==null||!Array.isArray(row.preExecutionAccounts)||!Array.isArray(row.postExecutionAccounts)||fee.value===null)throw new Error('A complete supply lock simulation is unavailable. Nothing was submitted.')
 return validateSupplyLockSimulation(intent,{addresses,before:row.preExecutionAccounts,after:row.postExecutionAccounts,networkFeeLamports:safe(fee.value).toString()})
}
