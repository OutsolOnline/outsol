import {describe,expect,it} from 'vitest'
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {buildFreshNativeBuy} from '../src/lib/pumpfun/api'
import {consumerLaunchPlan} from './helpers/consumerLaunchPlan'
import {validatePumpTransaction} from '../src/lib/transactions/validatePumpTransaction'
import * as transfers from '../src/lib/launchBundle/transfers'
async function fixture(){
 const payer=Keypair.generate(),mint=Keypair.generate(),recipient=Keypair.generate().publicKey,blockhash=Keypair.generate().publicKey.toBase58(),metadata={name:'Transfer',symbol:'TR',uri:'ipfs://transfer'}
 const built=await consumerLaunchPlan({userPublicKey:payer.publicKey.toBase58(),mintKeypair:mint,metadata:{...metadata,description:''},metadataUri:metadata.uri},blockhash)
 const next=await buildFreshNativeBuy({context:built.nativeContext!,mint:mint.publicKey,payer:payer.publicKey,metadata,maxBuyLamports:10_000_000n,blockhash,priorityFee:0.0001})
 return {payer,mint,recipient,tx:next.transaction,policy:{action:'buy' as const,payer:payer.publicKey.toBase58(),mint:mint.publicKey.toBase58(),maxSolLamports:10_000_000n,maxPriorityFeeLamports:100_000n,expectedBuyCreator:payer.publicKey,protocolFeeRecipients:built.launchPlan!.protocolFeeRecipients},intent:{walletId:'buyer',payer:payer.publicKey.toBase58(),recipient:recipient.toBase58(),mint:mint.publicKey.toBase58(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),rawAmount:next.context.tokenAmount.toString(),decimals:6}}
}
const rebuild=(tx:VersionedTransaction,change:(instructions:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>void)=>{const msg=TransactionMessage.decompile(tx.message);change(msg.instructions);return new VersionedTransaction(new TransactionMessage({payerKey:msg.payerKey,recentBlockhash:msg.recentBlockhash,instructions:msg.instructions}).compileToV0Message())}
describe('narrow native buy and transfer policy',()=>{
 it('appends exact transferChecked after idempotent recipient ATA creation and preserves ordinary buy strictness',async()=>{
  const h=await fixture(),tx=transfers.composeNativeBuyTransfer(h.tx,h.intent,h.policy),ixs=TransactionMessage.decompile(tx.message).instructions
  expect(ixs.at(-2)!.data).toEqual(Buffer.from([1]));expect(ixs.at(-2)!.keys[2].pubkey.toBase58()).toBe(h.recipient.toBase58())
  const transfer=ixs.at(-1)!;expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);expect(transfer.data[0]).toBe(12);expect(transfer.data.readBigUInt64LE(1).toString()).toBe(h.intent.rawAmount);expect(transfer.data[9]).toBe(6)
  expect(transfer.keys.map(item=>item.pubkey.toBase58())).toEqual([getAssociatedTokenAddressSync(h.mint.publicKey,h.payer.publicKey,false,TOKEN_2022_PROGRAM_ID).toBase58(),h.mint.publicKey.toBase58(),getAssociatedTokenAddressSync(h.mint.publicKey,h.recipient,false,TOKEN_2022_PROGRAM_ID).toBase58(),h.payer.publicKey.toBase58()])
  expect(()=>transfers.validateComposedNativeBuy(tx,h.tx,h.intent,h.policy)).not.toThrow()
  expect(()=>validatePumpTransaction(tx,h.policy)).toThrow(/ATA owner|program/i)
 })
 it('rejects altered recipients, raw output, token programs and extra instruction capabilities',async()=>{
  const h=await fixture(),tx=transfers.composeNativeBuyTransfer(h.tx,h.intent,h.policy)
  for(const intent of [{...h.intent,recipient:Keypair.generate().publicKey.toBase58()},{...h.intent,rawAmount:'1'},{...h.intent,tokenProgram:TOKEN_PROGRAM_ID.toBase58()}])expect(()=>transfers.validateComposedNativeBuy(tx,h.tx,intent,h.policy)).toThrow()
  for(const change of [(ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs.at(-1)!.data.writeBigUInt64LE(1n,1)},(ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs.at(-1)!.programId=TOKEN_PROGRAM_ID},(ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs.push(SystemProgram.transfer({fromPubkey:h.payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}))}])expect(()=>transfers.validateComposedNativeBuy(rebuild(tx,change),h.tx,h.intent,h.policy)).toThrow()
  expect(()=>transfers.composeNativeBuyTransfer(h.tx,{...h.intent,rawAmount:'1'},h.policy)).toThrow(/output|amount/i)
  expect(()=>transfers.composeNativeBuyTransfer(h.tx,{...h.intent,recipient:h.intent.payer},h.policy)).toThrow()
 })
 it('rejects extra native ATA instructions, protocol recipients, flags and partial fills before approving composition',async()=>{
  const h=await fixture()
  for(const change of [
   (ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs.splice(2,0,ixs[2])},
   (ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs[3].keys[0].isWritable=true},
   (ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs[3].keys[1].pubkey=Keypair.generate().publicKey},
   (ixs:ReturnType<typeof TransactionMessage.decompile>['instructions'])=>{ixs[3].data[25]=1},
  ])expect(()=>transfers.composeNativeBuyTransfer(rebuild(h.tx,change),h.intent,h.policy)).toThrow()
 })
})
