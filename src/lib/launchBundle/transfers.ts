import {ComputeBudgetProgram,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction,type AccountMeta} from '@solana/web3.js'
import {createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction,getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {GLOBAL_PDA,PUMP_PROGRAM_ID,PUMP_EVENT_AUTHORITY_PDA,GLOBAL_VOLUME_ACCUMULATOR_PDA,PUMP_FEE_CONFIG_PDA,PUMP_FEE_PROGRAM_ID,bondingCurvePda,bondingCurveV2Pda,creatorVaultPda,userVolumeAccumulatorPda} from '@pump-fun/pump-sdk'
import {validatePumpTransaction,type PumpTransactionPolicy} from '@/lib/transactions/validatePumpTransaction'
import {publicLaunchBundleTransfers,type LaunchBundleTransfer} from './receipt'
import type {AtomicSimulationResult,AtomicTokenExpectation} from '@/lib/bundler/jito'

const PUMP=new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),BUY=Buffer.from([102,6,61,18,1,218,235,234])
// Same pinned SDK protocol destinations as the native create/first-buy policy.
const BUYBACK_RECIPIENTS=['5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD','9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7','GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL','3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR','5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6','EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL','5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD','A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW']
export type NativeBuyTransferPolicy=PumpTransactionPolicy&{protocolFeeRecipients:readonly string[]}
const meta=(pubkey:PublicKey,isWritable=false,isSigner=false):AccountMeta=>({pubkey,isWritable,isSigner})
/** Only the native exact-output buy supports a composed output transfer. */
export function nativeBuyOutput(transaction:VersionedTransaction,policy:NativeBuyTransferPolicy):{rawAmount:string;tokenProgram:string}{
 if(policy.action!=='buy'||transaction.message.addressTableLookups.length)throw new Error('A composed transfer requires a native buy without lookup tables.')
 validatePumpTransaction(transaction,policy)
 const message=TransactionMessage.decompile(transaction.message),instructions=message.instructions,buys=instructions.filter(ix=>ix.programId.equals(PUMP)&&ix.data.subarray(0,8).equals(BUY))
 if(buys.length!==1||buys[0].data.length!==26||buys[0].data[24]!==1||buys[0].data[25]!==0)throw new Error('The exact native buy output could not be verified; partial fills are unsupported.')
 const rawAmount=buys[0].data.readBigUInt64LE(8).toString()
 if(rawAmount==='0')throw new Error('The native buy output must be positive.')
 const [limit,price,ata,buy]=instructions
 if(instructions.length!==4||buy!==buys[0]||limit.keys.length||price.keys.length||!limit.programId.equals(ComputeBudgetProgram.programId)||!price.programId.equals(ComputeBudgetProgram.programId)||limit.data.length!==5||limit.data[0]!==2||price.data.length!==9||price.data[0]!==3||buy.keys.length!==18||!policy.expectedBuyCreator||!policy.protocolFeeRecipients?.includes(buy.keys[1].pubkey.toBase58())||!BUYBACK_RECIPIENTS.includes(buy.keys[17].pubkey.toBase58()))throw new Error('The composed transfer requires the exact native buyer instruction recipe and protocol recipients.')
 const payer=new PublicKey(policy.payer),mint=new PublicKey(policy.mint),program=TOKEN_2022_PROGRAM_ID,curve=bondingCurvePda(mint),source=getAssociatedTokenAddressSync(mint,payer,false,program)
 const canonicalBuy=new TransactionInstruction({programId:PUMP_PROGRAM_ID,data:Buffer.from(buy.data),keys:[meta(GLOBAL_PDA),meta(buy.keys[1].pubkey,true),meta(mint),meta(curve,true),meta(getAssociatedTokenAddressSync(mint,curve,true,program),true),meta(source,true),meta(payer,true,true),meta(SystemProgram.programId),meta(program),meta(creatorVaultPda(new PublicKey(policy.expectedBuyCreator)),true),meta(PUMP_EVENT_AUTHORITY_PDA),meta(PUMP_PROGRAM_ID),meta(GLOBAL_VOLUME_ACCUMULATOR_PDA),meta(userVolumeAccumulatorPda(payer),true),meta(PUMP_FEE_CONFIG_PDA),meta(PUMP_FEE_PROGRAM_ID),meta(bondingCurveV2Pda(mint)),meta(buy.keys[17].pubkey,true)]})
 const canonical=new TransactionMessage({payerKey:payer,recentBlockhash:message.recentBlockhash,instructions:[new TransactionInstruction({programId:ComputeBudgetProgram.programId,data:Buffer.from(limit.data),keys:[]}),new TransactionInstruction({programId:ComputeBudgetProgram.programId,data:Buffer.from(price.data),keys:[]}),createAssociatedTokenAccountIdempotentInstruction(payer,source,payer,mint,program),canonicalBuy]}).compileToV0Message()
 if(!ata||!Buffer.from(canonical.serialize()).equals(Buffer.from(transaction.message.serialize())))throw new Error('Native buyer account flags or complete instruction sequence changed.')
 return {rawAmount,tokenProgram:buys[0].keys[8].pubkey.toBase58()}
}
/** The uncomposed buy is separately validated, then the entire final message is reconstructed. */
export function composeNativeBuyTransfer(nativeBuy:VersionedTransaction,value:LaunchBundleTransfer,policy:NativeBuyTransferPolicy):VersionedTransaction{
 const transfer=publicLaunchBundleTransfers([value])[0],output=nativeBuyOutput(nativeBuy,policy)
 if(transfer.payer!==new PublicKey(policy.payer).toBase58()||transfer.mint!==new PublicKey(policy.mint).toBase58()||transfer.rawAmount!==output.rawAmount||transfer.tokenProgram!==output.tokenProgram||transfer.decimals!==6)throw new Error('The token transfer differs from the exact native buy output, mint or program.')
 const payer=new PublicKey(transfer.payer),recipient=new PublicKey(transfer.recipient),mint=new PublicKey(transfer.mint),program=new PublicKey(transfer.tokenProgram),source=getAssociatedTokenAddressSync(mint,payer,false,program),destination=getAssociatedTokenAddressSync(mint,recipient,false,program),message=TransactionMessage.decompile(nativeBuy.message)
 const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:message.recentBlockhash,instructions:[...message.instructions,createAssociatedTokenAccountIdempotentInstruction(payer,destination,recipient,mint,program),createTransferCheckedInstruction(source,mint,destination,payer,BigInt(transfer.rawAmount),transfer.decimals,[],program)]}).compileToV0Message())
 try{if(transaction.serialize().length>1232)throw new Error()}catch{throw new Error('This buy and token transfer exceeds the Solana packet size. Reduce immediate buyers or shorten metadata; prepare again.')}
 return transaction
}
export function validateComposedNativeBuy(transaction:VersionedTransaction,nativeBuy:VersionedTransaction,transfer:LaunchBundleTransfer,policy:NativeBuyTransferPolicy):void{
 const expected=composeNativeBuyTransfer(nativeBuy,transfer,policy)
 if(!Buffer.from(transaction.message.serialize()).equals(Buffer.from(expected.message.serialize())))throw new Error('The composed buy and token transfer differs from the reviewed complete instruction sequence.')
}
/** One expectation per account includes all native purchases and routed output. */
export function launchTokenExpectations(mint:string,purchases:readonly {owner:string;rawAmount:string;tokenProgram:string}[],transfers:readonly LaunchBundleTransfer[]):AtomicTokenExpectation[]{
 const expectations=new Map<string,AtomicTokenExpectation>()
 const add=(owner:string,program:string,delta:bigint)=>{const address=getAssociatedTokenAddressSync(new PublicKey(mint),new PublicKey(owner),false,new PublicKey(program)).toBase58(),current=expectations.get(address);expectations.set(address,{address,owner,mint,tokenProgram:program,expectedDeltaRaw:(BigInt(current?.expectedDeltaRaw??'0')+delta).toString()})}
 for(const purchase of purchases)if(BigInt(purchase.rawAmount)>0n)add(purchase.owner,purchase.tokenProgram,BigInt(purchase.rawAmount))
 for(const transfer of transfers){add(transfer.payer,transfer.tokenProgram,-BigInt(transfer.rawAmount));add(transfer.recipient,transfer.tokenProgram,BigInt(transfer.rawAmount))}
 return [...expectations.values()]
}
export function assertLaunchTokenEvidence(simulation:AtomicSimulationResult,expectations:readonly AtomicTokenExpectation[]):void{
 if(!expectations.length)return
 if(!simulation.tokenAccountDeltasRaw||Object.keys(simulation.tokenAccountDeltasRaw).length!==expectations.length||expectations.some(expected=>simulation.tokenAccountDeltasRaw?.[expected.address]!==expected.expectedDeltaRaw))throw new Error('The complete bundle token transfer evidence could not be verified. Prepare again.')
}
