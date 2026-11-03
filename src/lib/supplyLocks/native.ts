import {ComputeBudgetProgram,Connection,PublicKey,SystemProgram,SYSVAR_RENT_PUBKEY,TransactionMessage,VersionedTransaction,type TransactionInstruction} from '@solana/web3.js'
import {ASSOCIATED_TOKEN_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token'
import {buildLockParams,createStreamV2Instruction,SolanaStreamClient,ICluster,STREAMFLOW_TREASURY_PUBLIC_KEY,WITHDRAWOR_PUBLIC_KEY,type StreamClientOptionsWithConnection} from '@streamflow/stream'
export {decodeStream as decodeSupplyLockContract} from '@streamflow/stream'
import BN from 'bn.js'
import {LOCK_ORACLE,LOCK_PROGRAM,parseSupplyLockIntent,type SupplyLockIntent} from './model'

/** SDK13.4.0 feeds a Buffer to its u32 nonce encoder, producing zero. The
 * pinned create_v2 schema is150 bytes: nonce u32 at136, then10 zero padding.
 * Correct only that scalar; refuse a schema change rather than guessing. */
function exactNonce(instruction:TransactionInstruction,nonce:number):TransactionInstruction{
 if(!instruction.programId.equals(LOCK_PROGRAM)||!instruction.data.subarray(0,8).equals(Buffer.from([214,144,76,236,95,139,49,180]))||instruction.data.length!==150||instruction.data.subarray(140).some(Boolean)||instruction.data.readUInt32LE(136)!==0&&instruction.data.readUInt32LE(136)!==nonce)throw new Error('The pinned Streamflow create_v2 encoding changed. Nothing was signed.')
 instruction.data=Buffer.from(instruction.data);instruction.data.writeUInt32LE(nonce,136);return instruction
}

export function supplyLockAccounts(value:SupplyLockIntent){
 const intent=parseSupplyLockIntent(value),payer=new PublicKey(intent.payer),mint=new PublicKey(intent.mint),program=new PublicKey(intent.tokenProgram),recipient=new PublicKey(intent.recipient),ata=(owner:PublicKey)=>getAssociatedTokenAddressSync(mint,owner,true,program)
 return{sender:payer,senderTokens:ata(payer),recipient,metadata:new PublicKey(intent.metadata),escrowTokens:new PublicKey(intent.escrow),recipientTokens:ata(recipient),streamflowTreasury:STREAMFLOW_TREASURY_PUBLIC_KEY,streamflowTreasuryTokens:ata(STREAMFLOW_TREASURY_PUBLIC_KEY),partner:WITHDRAWOR_PUBLIC_KEY,partnerTokens:ata(WITHDRAWOR_PUBLIC_KEY),mint,feeOracle:LOCK_ORACLE,rent:SYSVAR_RENT_PUBKEY,timelockProgram:LOCK_PROGRAM,tokenProgram:program,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,withdrawor:WITHDRAWOR_PUBLIC_KEY,systemProgram:SystemProgram.programId}
}
async function canonicalInstructions(intent:SupplyLockIntent):Promise<TransactionInstruction[]>{
 const accounts=supplyLockAccounts(intent),params=buildLockParams({recipient:intent.recipient,tokenId:intent.mint,amount:new BN(intent.amountRaw),unlockDate:intent.unlockAt,name:'OutSol token supply lock',transferableByRecipient:false,partner:WITHDRAWOR_PUBLIC_KEY.toBase58(),tokenProgramId:intent.tokenProgram})
 const create=exactNonce(await createStreamV2Instruction({start:new BN(params.start),depositedAmount:params.amount,period:new BN(1),amountPerPeriod:new BN(1),cliff:new BN(params.cliff),cliffAmount:params.cliffAmount,cancelableBySender:false,cancelableByRecipient:false,automaticWithdrawal:false,transferableBySender:false,transferableByRecipient:false,canTopup:false,canPause:false,canUpdateRate:false,name:params.name,withdrawFrequency:new BN(1),nonce:intent.nonce},LOCK_PROGRAM,accounts),intent.nonce)
 return[ComputeBudgetProgram.setComputeUnitLimit({units:1000000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:BigInt(intent.priorityFeeLamports)}),createAssociatedTokenAccountIdempotentInstruction(accounts.sender,accounts.partnerTokens,accounts.partner,accounts.mint,accounts.tokenProgram),create]
}
/** SDK preparation receives only a public sender and a PDA nonce. SDK create/execute/sign methods are never used. */
export async function buildSupplyLockTransaction(connection:Connection,value:SupplyLockIntent,blockhash:string):Promise<VersionedTransaction>{
 // The SDK carries a duplicate web3 dependency with private type identity.
 // Pass the same Connection object to preserve OutSol's guarded transport.
 const intent=parseSupplyLockIntent(value),client=new SolanaStreamClient({connection:connection as unknown as StreamClientOptionsWithConnection['connection'],cluster:ICluster.Mainnet}),params={...buildLockParams({recipient:intent.recipient,tokenId:intent.mint,amount:new BN(intent.amountRaw),unlockDate:intent.unlockAt,name:'OutSol token supply lock',transferableByRecipient:false,partner:WITHDRAWOR_PUBLIC_KEY.toBase58(),tokenProgramId:intent.tokenProgram}),nonce:intent.nonce,canPause:false,canUpdateRate:false}
 const prepared=await client.prepareCreateInstructions(params,{sender:{publicKey:new PublicKey(intent.payer)},isNative:false,computePrice:0,computeLimit:1000000})
 if(prepared.metadata||prepared.metadataPubKey.toBase58()!==intent.metadata||prepared.ixs.filter(ix=>!ix.programId.equals(ComputeBudgetProgram.programId)).length!==1)throw new Error('The SDK returned an unexpected lock signer or instruction.')
 const expected=await canonicalInstructions(intent),rawCreate=prepared.ixs.find(ix=>ix.programId.equals(LOCK_PROGRAM)),create=rawCreate?exactNonce(rawCreate,intent.nonce):undefined
 if(!create||JSON.stringify({data:create.data.toString('hex'),keys:create.keys.map(key=>[key.pubkey.toBase58(),key.isSigner,key.isWritable])})!==JSON.stringify({data:expected.at(-1)!.data.toString('hex'),keys:expected.at(-1)!.keys.map(key=>[key.pubkey.toBase58(),key.isSigner,key.isWritable])}))throw new Error('The SDK lock schedule, flags or accounts differ from the exact reviewed intent.')
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(intent.payer),recentBlockhash:blockhash,instructions:expected}).compileToV0Message())
 if(tx.serialize().length>1232)throw new Error('This lock exceeds the Solana packet limit. Nothing was signed.')
 return tx
}
export async function assertSupplyLockTransaction(transaction:VersionedTransaction,value:SupplyLockIntent):Promise<void>{
 const intent=parseSupplyLockIntent(value),expected=new TransactionMessage({payerKey:new PublicKey(intent.payer),recentBlockhash:transaction.message.recentBlockhash,instructions:await canonicalInstructions(intent)}).compileToV0Message()
 if(transaction.message.header.numRequiredSignatures!==1||!Buffer.from(transaction.message.serialize()).equals(Buffer.from(expected.serialize())))throw new Error('The transaction differs from the exact immutable token lock. Nothing was submitted.')
}
