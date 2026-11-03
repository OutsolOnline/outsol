import {describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,PublicKey,SystemProgram} from '@solana/web3.js'
import {AccountLayout,AccountState,MintLayout,TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {normalizeOperationInput} from '../src/lib/walletOperations/model'
import {buildWalletOperationTransaction,inspectWalletOperationIntent,simulateWalletOperation} from '../src/lib/walletOperations/builder'
import {publicWalletOperationIntent,readPendingWalletOperation,savePendingWalletOperation} from '../src/lib/walletOperations/history'
import {percentageRecipients} from '../src/lib/walletOperations/distribution'
import bs58 from 'bs58'

const payer=Keypair.fromSeed(new Uint8Array(32).fill(61)).publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey.toBase58(),source=Keypair.fromSeed(new Uint8Array(32).fill(63)).publicKey.toBase58(),blockhash=Keypair.fromSeed(new Uint8Array(32).fill(64)).publicKey.toBase58()
const intent={kind:'burn' as const,payer,mint,sourceAccount:source,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),decimals:6,burnRaw:'150',priorityLamports:'0'}
const mintData=(supply:bigint)=>{const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return data}
const tokenData=(amount:bigint)=>{const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:new PublicKey(mint),owner:new PublicKey(payer),amount,delegateOption:0,delegate:PublicKey.default,state:AccountState.Initialized,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return data}
const account=(data:Buffer,owner:PublicKey,lamports:number)=>({data:[data.toString('base64'),'base64'],owner:owner.toBase58(),lamports,executable:false})
describe('reviewed supply actions',()=>{
 it('encodes only the exact reviewed burn and preserves that intent in recovery',()=>{
  expect(normalizeOperationInput({kind:'burn',payer,mint,amount:'0.000150',priorityFeeSol:'0'})).toMatchObject({kind:'burn',amount:'0.000150'})
  const tx=buildWalletOperationTransaction(intent,blockhash);expect(()=>inspectWalletOperationIntent(tx,intent)).not.toThrow()
  expect(()=>inspectWalletOperationIntent(buildWalletOperationTransaction({...intent,burnRaw:'151'},blockhash),intent)).toThrow(/review|intent|match/)
  expect(publicWalletOperationIntent({...intent,secretKey:'PRIVATE'} as never)).toEqual(intent)
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  savePendingWalletOperation({...intent,signature:bs58.encode(new Uint8Array(64).fill(42)),blockhash,lastValidBlockHeight:300,submittedAt:'2026-11-03T00:00:00.000Z'},storage)
  expect(readPendingWalletOperation(storage)).toMatchObject({kind:'burn',burnRaw:'150',mint})
 })
 it('verifies both the holder balance and mint supply decrease in the same simulation bank',async()=>{
  const tx=buildWalletOperationTransaction(intent,blockhash),before=[account(Buffer.alloc(0),SystemProgram.programId,1_000_000_000),account(mintData(1_000_000n),TOKEN_PROGRAM_ID,1_461_600),account(tokenData(1000n),TOKEN_PROGRAM_ID,2_039_280)]
  const after=[account(Buffer.alloc(0),SystemProgram.programId,999_995_000),account(mintData(999_850n),TOKEN_PROGRAM_ID,1_461_600),account(tokenData(850n),TOKEN_PROGRAM_ID,2_039_280)]
  let altered=false
  const connection={rpcEndpoint:'http://127.0.0.1:8899',getMultipleAccountsInfo:async()=>[],getFeeForMessage:async()=>({value:5000})} as unknown as Connection
  vi.stubGlobal('fetch',async()=>Response.json({result:{value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:before,postExecutionAccounts:altered?[after[0],account(mintData(999_849n),TOKEN_PROGRAM_ID,1_461_600),after[2]]:after}]}}}))
  try{const preview=await simulateWalletOperation(connection,tx,intent);expect(preview).toMatchObject({sourceBeforeRaw:'1000',sourceAfterRaw:'850',supplyBeforeRaw:'1000000',supplyAfterRaw:'999850',networkFeeLamports:'5000',rentChangeLamports:'0'});altered=true;await expect(simulateWalletOperation(connection,tx,intent)).rejects.toThrow(/supply|burn/)}finally{vi.unstubAllGlobals()}
 })
 it('converts percentage allocations with exact integer floors and never overspends the selected balance',()=>{
  const recipients=[{address:mint,percent:'12.50'},{address:source,percent:'25'}]
  expect(percentageRecipients(1000n,1000n,2,recipients)).toEqual([{address:mint,amount:'1.25'},{address:source,amount:'2.5'}])
  expect(()=>percentageRecipients(1000n,100n,2,recipients)).toThrow(/balance/)
  expect(()=>percentageRecipients(1000n,1000n,2,[{address:mint,percent:'80'},{address:source,percent:'30'}])).toThrow(/100/)
  expect(()=>percentageRecipients(1n,1n,6,[{address:mint,percent:'1'}])).toThrow(/small/)
 })
})
