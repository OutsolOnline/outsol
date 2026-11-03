import {describe,expect,it} from 'vitest'
import {Keypair,PublicKey,SystemProgram} from '@solana/web3.js'
import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {validateSupplyLockSimulation} from '../src/lib/supplyLocks/simulation'
import {LOCK_PROGRAM,lockAddresses,type SupplyLockIntent} from '../src/lib/supplyLocks/model'
import {supplyLockAccounts} from '../src/lib/supplyLocks/native'

function fixture(){
 const payer=Keypair.fromSeed(new Uint8Array(32).fill(131)).publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(132)).publicKey.toBase58(),nonce=12,input={version:1 as const,payer,mint,recipient:payer,amountRaw:'1000000',unlockAt:2000000000,priorityFeeLamports:'0'},intent:SupplyLockIntent={...input,...lockAddresses(input,nonce),nonce,decimals:6,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),feeUnits:5000,creationFeeLamports:'160000000',tokenFeeRaw:'5000',sourceDebitRaw:'1005000',maxDebitLamports:'170000000'},accounts=supplyLockAccounts(intent)
 const metadata=Buffer.alloc(1104)
 metadata.writeBigUInt64LE(1n,0);metadata[8]=2;metadata.writeBigUInt64LE(1999990000n,9);metadata.writeBigUInt64LE(2000000000n,33)
 for(const [name,offset] of Object.entries({sender:49,senderTokens:81,recipient:113,recipientTokens:145,mint:177,escrowTokens:209,streamflowTreasury:241,streamflowTreasuryTokens:273,partner:325,partnerTokens:357}))accounts[name as keyof typeof accounts].toBuffer().copy(metadata,offset)
 metadata.writeBigUInt64LE(5000n,305);metadata.writeBigUInt64LE(5000n,313);metadata.writeFloatLE(.5,321)
 for(const [offset,value] of [[409,2000000000],[417,1000000],[425,1],[433,1],[441,2000000000],[449,1000000],[527,30]])metadata.writeBigUInt64LE(BigInt(value),offset)
 metadata[545]=1;metadata.writeUInt32LE(nonce,546);metadata.writeUInt32LE(160000000,704);accounts.sender.toBuffer().copy(metadata,746)
 const token=(owner:PublicKey,amount:bigint)=>{const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:accounts.mint,owner,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return data}
 const mintData=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:100000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData)
 const account=(owner:PublicKey,data:Buffer,lamports:number)=>({owner:owner.toBase58(),data:[data.toString('base64'),'base64'],lamports,executable:false}),addresses=[accounts.sender,accounts.senderTokens,accounts.metadata,accounts.escrowTokens,accounts.streamflowTreasuryTokens,accounts.partnerTokens,accounts.mint].map(key=>key.toBase58())
 const before=[account(SystemProgram.programId,Buffer.alloc(0),1000000000),account(TOKEN_PROGRAM_ID,token(accounts.sender,10000000n),2039280),null,null,account(TOKEN_PROGRAM_ID,token(accounts.streamflowTreasury,0n),2039280),account(TOKEN_PROGRAM_ID,token(accounts.partner,0n),2039280),account(TOKEN_PROGRAM_ID,mintData,1461600)]
 const after=[account(SystemProgram.programId,Buffer.alloc(0),830000000),account(TOKEN_PROGRAM_ID,token(accounts.sender,8995000n),2039280),account(LOCK_PROGRAM,metadata,167955720),account(TOKEN_PROGRAM_ID,token(accounts.escrowTokens,1005000n),2039280),before[4],before[5],before[6]]
 return{intent,metadata,token,accounts,bank:{addresses,before,after,networkFeeLamports:'5000'},account}
}
describe('exact immutable escrow simulation evidence',()=>{
 it('proves exact principal plus fee custody despite a fee counter already marked withdrawn',()=>{
  const f=fixture(),preview=validateSupplyLockSimulation(f.intent,f.bank)
  expect(preview).toMatchObject({lockedRaw:'1000000',tokenFeeRaw:'5000',sourceBeforeRaw:'10000000',sourceAfterRaw:'8995000',maxDebitLamports:'170000000',rentLamports:'9995000'})
 })
 it.each(['recipient','cancel','pause','nonce','fee','principal','source','supply'])('rejects changed %s evidence before signing or broadcasting',kind=>{
  const f=fixture()
  if(kind==='recipient')Keypair.generate().publicKey.toBuffer().copy(f.metadata,113)
  if(kind==='cancel')f.metadata[457]=1
  if(kind==='pause')f.metadata[539]=1
  if(kind==='nonce')f.metadata.writeUInt32LE(13,546)
  if(kind==='fee')f.metadata.writeBigUInt64LE(5001n,305)
  if(['recipient','cancel','pause','nonce','fee'].includes(kind))f.bank.after[2]=f.account(LOCK_PROGRAM,f.metadata,167955720)
  if(kind==='principal')f.bank.after[3]=f.account(TOKEN_PROGRAM_ID,f.token(f.accounts.escrowTokens,999999n),2039280)
  if(kind==='source')f.bank.after[1]=f.account(TOKEN_PROGRAM_ID,f.token(f.accounts.sender,8994999n),2039280)
  if(kind==='supply'){const data=Buffer.from(f.bank.after[6]!.data[0],'base64');data.writeBigUInt64LE(99999999n,36);f.bank.after[6]=f.account(TOKEN_PROGRAM_ID,data,1461600)}
  expect(()=>validateSupplyLockSimulation(f.intent,f.bank)).toThrow()
 })
})
