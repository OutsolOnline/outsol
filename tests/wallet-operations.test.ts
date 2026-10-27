import { describe, expect, it } from 'vitest'
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { AccountLayout, AccountState, ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccountLen, getMintLen, type RawAccount } from '@solana/spl-token'
import { parseExactUnits, normalizeOperationInput } from '../src/lib/walletOperations/model'
import { saveWalletGroup, readWalletGroups, removeWalletGroup } from '../src/lib/walletOperations/groups'
import { savePendingWalletOperation, readPendingWalletOperation, assertNoPendingWalletOperation, readWalletOperationHistory } from '../src/lib/walletOperations/history'
import { reconcileWalletOperationRecord } from '../src/lib/walletOperations/recovery'
import { buildWalletOperationTransaction, inspectWalletOperationIntent, checkedMint, checkedTokenAccount } from '../src/lib/walletOperations/builder'
import { submitReviewedWalletOperation } from '../src/lib/walletOperations/submission'
import bs58 from 'bs58'

const payer = Keypair.generate().publicKey.toBase58(), receiver = Keypair.generate().publicKey.toBase58(), blockhash = Keypair.generate().publicKey.toBase58()
function memory() { const data = new Map<string,string>(); return { data, getItem: (key:string)=>data.get(key)??null, setItem:(key:string,value:string)=>{data.set(key,value)}, removeItem:(key:string)=>{data.delete(key)} } }
const intent = () => ({ kind: 'sol' as const, payer, priorityLamports: '10000', recipients: [{ address: receiver, rawAmount: '123456789' }] })
const record = () => ({ ...intent(), signature: bs58.encode(new Uint8Array(64).fill(1)), blockhash, lastValidBlockHeight: 100, submittedAt: '2026-10-27T10:00:00.000Z' })

describe('wallet operation limits and intent', () => {
  it('parses exact units without rounding large token amounts or accepting exponent notation', () => {
    expect(parseExactUnits('18446744073709.551615', 6)).toBe(18446744073709551615n)
    expect(parseExactUnits('0.000000001', 9)).toBe(1n)
    for (const value of ['1e3','-1','NaN','1.0000000001',' 1','01','1.']) expect(()=>parseExactUnits(value,9)).toThrow()
    expect(()=>parseExactUnits('18446744073709.551616',6)).toThrow()
  })
  it('rejects duplicate, self, invalid and excess recipients before requesting chain data', () => {
    const input = { kind:'sol' as const,payer,priorityFeeSol:'0',recipients:[{address:receiver,amount:'1'}] }
    expect(normalizeOperationInput(input)).toMatchObject(input)
    for (const recipients of [[{address:payer,amount:'1'}],[{address:'bad',amount:'1'}],[...input.recipients,...input.recipients],Array.from({length:9},()=>input.recipients[0])]) expect(()=>normalizeOperationInput({...input,recipients})).toThrow()
    expect(()=>normalizeOperationInput({...input,priorityFeeSol:'0.010000001'})).toThrow()
    expect(normalizeOperationInput({...input,kind:'token',mint:Keypair.generate().publicKey.toBase58(),recipients:[{address:receiver,amount:'1.234567'}]})).toMatchObject({kind:'token'})
  })
  it('rejects unsupported mint extensions and rejects nonempty, frozen, native or differently controlled account cleanup', () => {
    const mint=Keypair.generate().publicKey,address=Keypair.generate().publicKey,owner=new PublicKey(payer),zero=PublicKey.default
    const mintData=Buffer.alloc(getMintLen([ExtensionType.TransferFeeConfig]))
    MintLayout.encode({mintAuthorityOption:0,mintAuthority:zero,supply:1000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:zero},mintData)
    mintData[165]=1;mintData.writeUInt16LE(ExtensionType.TransferFeeConfig,166);mintData.writeUInt16LE(mintData.length-170,168)
    expect(()=>checkedMint(mint,{data:mintData,owner:TOKEN_2022_PROGRAM_ID,executable:false,lamports:1000000})).toThrow(/unsupported.*extensions/i)
    const accountInfo=(changes:Partial<RawAccount>={},extension?:ExtensionType)=>{
      const data=Buffer.alloc(extension===undefined?165:getAccountLen([extension]))
      AccountLayout.encode({mint,owner,amount:0n,delegateOption:0,delegate:zero,state:AccountState.Initialized,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:zero,...changes},data)
      if(extension!==undefined){data[165]=2;data.writeUInt16LE(extension,166);data.writeUInt16LE(data.length-170,168)}
      return {data,owner:extension===undefined?TOKEN_PROGRAM_ID:TOKEN_2022_PROGRAM_ID,executable:false,lamports:2039280}
    }
    expect(()=>checkedTokenAccount(address,accountInfo(),TOKEN_PROGRAM_ID,mint,owner,true)).not.toThrow()
    for(const changes of [{amount:1n},{state:AccountState.Frozen},{state:AccountState.Uninitialized},{isNativeOption:1 as const},{owner:Keypair.generate().publicKey},{closeAuthorityOption:1 as const,closeAuthority:Keypair.generate().publicKey}])expect(()=>checkedTokenAccount(address,accountInfo(changes),TOKEN_PROGRAM_ID,mint,owner,true)).toThrow()
    expect(()=>checkedTokenAccount(address,accountInfo({},ExtensionType.ImmutableOwner),TOKEN_2022_PROGRAM_ID,mint,owner,true)).not.toThrow()
    expect(()=>checkedTokenAccount(address,accountInfo({},ExtensionType.MemoTransfer),TOKEN_2022_PROGRAM_ID,mint,owner,true)).toThrow(/extensions/i)
  })
  it('rejects a busy shared lock, missing review and changed payer before invoking a signer',async()=>{
    const plan={intent:intent(),transaction:buildWalletOperationTransaction(intent(),blockhash),message:'',preview:{} as any,createdAt:Date.now(),lastValidBlockHeight:100}
    const options={approved:true,readSigner:()=>payer,signTransaction:async()=>{throw new Error('Signer must not be invoked')},assertAvailable:()=>{},storage:memory()}
    await expect(submitReviewedWalletOperation({} as any,plan,{...options,approved:false})).rejects.toThrow(/review/i)
    await expect(submitReviewedWalletOperation({} as any,plan,{...options,locks:{request:async(_name,_options,callback)=>callback(null)}})).rejects.toThrow(/another tab/i)
    await expect(submitReviewedWalletOperation({} as any,plan,{...options,readSigner:()=>receiver,locks:{request:async(_name,_options,callback)=>callback({})}})).rejects.toThrow(/changed|locked|disconnected/i)
  })
  it('permits exactly the reviewed native transfers and rejects changed amounts or extra capability', () => {
    const approved = intent(), tx = buildWalletOperationTransaction(approved, blockhash)
    expect(()=>inspectWalletOperationIntent(tx,approved)).not.toThrow()
    const changed = buildWalletOperationTransaction({...approved,recipients:[{address:receiver,rawAmount:'123456790'}]},blockhash)
    expect(()=>inspectWalletOperationIntent(changed,approved)).toThrow(/review|intent|match/i)
    const added = new VersionedTransaction(new TransactionMessage({payerKey:Keypair.generate().publicKey,recentBlockhash:blockhash,instructions:[SystemProgram.transfer({fromPubkey:Keypair.generate().publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message())
    expect(()=>inspectWalletOperationIntent(added,approved)).toThrow()
  })
})

describe('public wallet groups and recovery', () => {
  it('stores named groups using only public addresses and preserves damaged storage', () => {
    const storage=memory()
    const group=saveWalletGroup({name:'Team',addresses:[receiver],privateKey:'never-store'} as any,storage)
    expect(readWalletGroups(storage)).toEqual([group])
    expect([...storage.data.values()].join('')).not.toMatch(/private|never-store/)
    expect(()=>saveWalletGroup({name:'Duplicate',addresses:[receiver,receiver]},storage)).toThrow()
    removeWalletGroup(group.id,storage); expect(readWalletGroups(storage)).toEqual([])
    storage.setItem('vanity-wallet-groups-v1','broken')
    expect(()=>saveWalletGroup({name:'Keep',addresses:[receiver]},storage)).toThrow()
    expect(storage.getItem('vanity-wallet-groups-v1')).toBe('broken')
  })
  it('persists a bounded public pending record before broadcast and blocks duplicate spending', () => {
    const storage=memory()
    savePendingWalletOperation({...record(),secretKey:'never',transaction:'signed-bytes'} as any,storage)
    expect(readPendingWalletOperation(storage)).toEqual(record())
    expect([...storage.data.values()].join('')).not.toMatch(/secretKey|never|signed-bytes|transaction/)
    expect(()=>assertNoPendingWalletOperation(storage)).toThrow(/pending|confirmation/i)
    expect(()=>savePendingWalletOperation(record(),storage)).toThrow()
  })
  it('records a confirmed signature without resending and safely retains an unknown signature', async () => {
    const storage=memory(); savePendingWalletOperation(record(),storage)
    const absent={context:{slot:20},value:[null]}
    const unknown={getSignatureStatuses:async()=>absent,isBlockhashValid:async()=>({value:true}),getBlockHeight:async()=>101} as any
    expect((await reconcileWalletOperationRecord(unknown,{storage})).status).toBe('unknown')
    expect(readPendingWalletOperation(storage)).not.toBeNull()
    const confirmed={getSignatureStatuses:async()=>({context:{slot:20},value:[{confirmationStatus:'confirmed',err:null}]})} as any
    expect((await reconcileWalletOperationRecord(confirmed,{storage})).status).toBe('confirmed')
    expect(readPendingWalletOperation(storage)).toBeNull()
    expect(readWalletOperationHistory(storage)[0].status).toBe('confirmed')
  })
  it('releases an absent signature only after finalized expiry and a second history lookup',async()=>{
    const storage=memory();savePendingWalletOperation(record(),storage);let reads=0
    const connection={getSignatureStatuses:async()=>{reads++;return {context:{slot:50},value:[null]}},isBlockhashValid:async(_hash:string,options:any)=>{expect(options.commitment).toBe('finalized');return {value:false}},getBlockHeight:async(commitment:string)=>{expect(commitment).toBe('finalized');return 101},getTransaction:async()=>null} as any
    const result=await reconcileWalletOperationRecord(connection,{storage})
    expect(result.status).toBe('failed');expect(reads).toBe(2);expect(readPendingWalletOperation(storage)).toBeNull();expect(readWalletOperationHistory(storage)[0].error).toMatch(/expired/i)
  })
  it('keeps processed or unindexed-but-finalized evidence instead of treating it as an expired failure',async()=>{
    const storage=memory();savePendingWalletOperation(record(),storage)
    const processed={getSignatureStatuses:async()=>({context:{slot:50},value:[{confirmationStatus:'processed',err:null}]})} as any
    expect((await reconcileWalletOperationRecord(processed,{storage})).status).toBe('unknown')
    const archival={getSignatureStatuses:async()=>({context:{slot:50},value:[null]}),isBlockhashValid:async()=>({value:false}),getBlockHeight:async()=>101,getTransaction:async()=>({meta:{err:null}})} as any
    expect((await reconcileWalletOperationRecord(archival,{storage})).status).toBe('confirmed')
  })
  it('preserves pending data when receipt storage fails and never overwrites unreadable pending records',async()=>{
    const storage=memory();savePendingWalletOperation(record(),storage)
    const denied={...storage,setItem:()=>{throw new Error('Storage quota exceeded')}}
    const connection={getSignatureStatuses:async()=>({context:{slot:50},value:[{confirmationStatus:'finalized',err:null}]})} as any
    await expect(reconcileWalletOperationRecord(connection,{storage:denied})).rejects.toThrow(/quota/)
    expect(readPendingWalletOperation(storage)?.signature).toBe(record().signature)
    storage.setItem('vanity-wallet-operation-pending-v1','broken')
    expect(()=>assertNoPendingWalletOperation(storage)).toThrow(/cannot be read/i)
    expect(()=>savePendingWalletOperation(record(),storage)).toThrow()
    expect(storage.getItem('vanity-wallet-operation-pending-v1')).toBe('broken')
  })
})
