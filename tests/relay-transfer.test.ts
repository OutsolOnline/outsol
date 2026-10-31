import {afterEach,describe,expect,it,vi} from 'vitest'
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,type AccountInfo} from '@solana/web3.js'
import {AccountLayout,AccountState,ExtensionType,MintLayout,NATIVE_MINT,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,getMintLen,getAccountLen,TRANSFER_FEE_CONFIG_SIZE,TRANSFER_FEE_AMOUNT_SIZE} from '@solana/spl-token'
import bs58 from 'bs58'
import {scanRelayWallet} from '../src/lib/relay/scan'
import {prepareRelayTransfer} from '../src/lib/relay/prepare'
import {executeRelayTransfer,executeConfirmedBuyRelay} from '../src/lib/relay/execute'
import {assertNoPendingRelayTransfer,readRelayReceipts,reconcileRelayTransfers,RELAY_RECEIPTS_KEY} from '../src/lib/relay/history'
import {readPendingWalletOperation} from '../src/lib/walletOperations/history'
import {PENDING_KEY} from '../src/lib/launchHistory'
import {TRADE_PENDING_KEY} from '../src/lib/venues/tradeHistory'
import {GROUP_OPERATION_PENDING_KEY} from '../src/lib/walletGroups/history'
import {BUNDLE_PENDING_KEY} from '../src/lib/bundler/pending'

function memory(){const data=new Map<string,string>();return{data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}}
const locks={request:async<T>(_name:string,_options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>)=>callback({})}
function fixture(){
 const payer=Keypair.generate(),destination=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,sourceAccount=Keypair.generate().publicKey
 const amount=9_007_199_254_740_993n,transfer=777n,rent=2_039_280,fee=5000,destinationAta=getAssociatedTokenAddressSync(mint,destination)
 const account=(owner:PublicKey,raw:bigint,tokenMint=mint)=>{const data=Buffer.alloc(165);AccountLayout.encode({mint:tokenMint,owner,amount:raw,delegateOption:0,delegate:PublicKey.default,state:AccountState.Initialized,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return{data,owner:TOKEN_PROGRAM_ID,lamports:rent,executable:false}}
 const mintData=Buffer.alloc(82);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:amount,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData)
 const system=(lamports:number)=>({data:Buffer.alloc(0),owner:SystemProgram.programId,lamports,executable:false})
 const infos=new Map<string,AccountInfo<Buffer>>([[payer.publicKey.toBase58(),system(1_000_000_000)],[sourceAccount.toBase58(),account(payer.publicKey,amount)],[mint.toBase58(),{data:mintData,owner:TOKEN_PROGRAM_ID,lamports:1_461_600,executable:false}]])
 let sent=0,signed=0,finalized=true,failed=false,lastSentAmount=0n,assertBeforeSend=()=>{}
 const connection={rpcEndpoint:'https://outsol.test/api/rpc',getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getAccountInfo:async(key:PublicKey)=>infos.get(key.toBase58())??null,getMultipleAccountsInfo:async(keys:PublicKey[])=>keys.map(key=>infos.get(key.toBase58())??null),getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),getFeeForMessage:async()=>({context:{slot:1},value:fee}),getBalance:async()=>1_000_000_000,getTokenAccountsByOwner:async(_key:PublicKey,filter:{programId:PublicKey})=>({context:{slot:1},value:filter.programId.equals(TOKEN_PROGRAM_ID)?[{pubkey:sourceAccount,account:infos.get(sourceAccount.toBase58())!}]:[]}),isBlockhashValid:async()=>({context:{slot:1},value:true}),getSignatureStatuses:async()=>({context:{slot:1},value:[finalized?{confirmationStatus:'finalized',err:failed?{InstructionError:[0,'Custom']}:null}:null]}),getBlockHeight:async()=>101,getTransaction:async()=>null,sendRawTransaction:async(bytes:Uint8Array)=>{assertBeforeSend();sent++;const tx=VersionedTransaction.deserialize(bytes),ix=tx.message.compiledInstructions.find(ix=>tx.message.staticAccountKeys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID))!;lastSentAmount=Buffer.from(ix.data).readBigUInt64LE(1);expect(tx.message.compiledInstructions.some(ix=>tx.message.staticAccountKeys[ix.programIdIndex].equals(SystemProgram.programId))).toBe(false);return bs58.encode(tx.signatures[0])}} as unknown as Connection
 const toRpc=(value:AccountInfo<Buffer>|null)=>value?{...value,owner:value.owner.toBase58(),data:[value.data.toString('base64'),'base64']}:null
 vi.stubGlobal('fetch',async(_resource:unknown,init:RequestInit)=>{
  const request=JSON.parse(String(init.body)),tx=VersionedTransaction.deserialize(Buffer.from(request.params[0].encodedTransactions[0],'base64'))
  const ix=tx.message.compiledInstructions.find(ix=>tx.message.staticAccountKeys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID))!
  const moved=Buffer.from(ix.data).readBigUInt64LE(1),actualSource=tx.message.staticAccountKeys[ix.accountKeyIndexes[0]].toBase58(),addresses:string[]=request.params[1].preExecutionAccountsConfigs[0].addresses
  const pre=addresses.map(address=>infos.get(address)??null)
  const post=addresses.map(address=>address===payer.publicKey.toBase58()?system(1_000_000_000-fee-rent):address===actualSource?account(payer.publicKey,amount-moved):address===destinationAta.toBase58()?account(destination,moved):infos.get(address)??null)
  return Response.json({result:{context:{slot:1},value:{summary:'succeeded',transactionResults:[{err:null,preExecutionAccounts:pre.map(toRpc),postExecutionAccounts:post.map(toRpc)}]}}})
 })
 const storage=memory(),input={source:payer.publicKey.toBase58(),destination:destination.toBase58(),mint:mint.toBase58(),sourceAccount:sourceAccount.toBase58(),tokenProgram:TOKEN_PROGRAM_ID.toBase58(),amountRaw:transfer.toString(),decimals:6}
 const options={approved:true,storage,locks,readSigner:()=>payer.publicKey.toBase58(),sign:async(tx:VersionedTransaction)=>{signed++;tx.sign([payer]);return tx},assertAvailable:()=>{},timeoutMs:2,pollIntervalMs:1}
 return{payer,destination,mint,sourceAccount,destinationAta,amount,transfer,rent,fee,account,infos,connection,storage,input,options,get sent(){return sent},get lastSentAmount(){return lastSentAmount},get signed(){return signed},set finalized(value:boolean){finalized=value},set failed(value:boolean){failed=value},set assertBeforeSend(value:()=>void){assertBeforeSend=value}}
}
afterEach(()=>vi.unstubAllGlobals())
function installOtherPending(h:ReturnType<typeof fixture>,kind:'trade'|'launch'|'group'|'bundle'){
 const signature=bs58.encode(new Uint8Array(64).fill(2)),blockhash=Keypair.generate().publicKey.toBase58(),date=new Date().toISOString()
 if(kind==='trade')h.storage.setItem(TRADE_PENDING_KEY,JSON.stringify({action:'buy',mint:h.input.mint,payer:h.input.source,signature,blockhash,submittedAt:date,maxBuyLamports:'100000',maxSellRaw:'0'}))
 if(kind==='launch')h.storage.setItem(PENDING_KEY,JSON.stringify({mode:'standard',venue:'pump',mint:h.input.mint,payer:h.input.source,signatures:[signature],blockhash,submittedAt:date}))
 if(kind==='bundle')h.storage.setItem(BUNDLE_PENDING_KEY,JSON.stringify({version:1,receipt:{success:false,status:'unknown',mintAddress:h.input.mint,createSignature:signature,submittedSignatures:[signature]}}))
 if(kind==='group')h.storage.setItem(GROUP_OPERATION_PENDING_KEY,JSON.stringify({version:1,id:crypto.randomUUID(),kind:'fund',groupName:'Uncertain group',status:'unknown',createdAt:date,updatedAt:date,skipped:[],summary:{walletCount:1,transactionCount:1,platformFeeLamports:'0',totalTransferLamports:'1',totalNetworkFeeLamports:'5000',reserveLamports:'0'},packets:[{index:0,intent:{kind:'sol',payer:h.input.source,priorityLamports:'0',recipients:[{address:h.input.destination,rawAmount:'1'}]},payerBeforeLamports:'1000000000',payerAfterLamports:'999994999',networkFeeLamports:'5000',status:'unknown',signature,blockhash,lastValidBlockHeight:100,submittedAt:date}]}))
}

describe('Relay public scan and exact reviewed transfers',()=>{
 it.each(['trade','launch','group','bundle'] as const)('refuses an unresolved %s that appeared while the Relay review was open',async kind=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input);installOtherPending(h,kind)
  await expect(executeRelayTransfer(h.connection,prepared,h.options)).rejects.toThrow(/pending|confirmation|recovery/i)
  expect(h.sent).toBe(0);expect(h.signed).toBe(0)
 })
 it.each(['trade','launch','group','bundle'] as const)('rechecks an unresolved %s introduced during a preparation RPC await',async kind=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  h.connection.isBlockhashValid=async()=>{installOtherPending(h,kind);return{context:{slot:1},value:true}}
  await expect(executeRelayTransfer(h.connection,prepared,h.options)).rejects.toThrow(/pending|confirmation|recovery/i)
  expect(h.sent).toBe(0);expect(h.signed).toBe(0)
 })
 it.each(['trade','launch','group','bundle'] as const)('rechecks an unresolved %s introduced while the wallet signs',async kind=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  await expect(executeRelayTransfer(h.connection,prepared,{...h.options,sign:async transaction=>{const signed=await h.options.sign(transaction);installOtherPending(h,kind);return signed}})).rejects.toThrow(/pending|confirmation|recovery/i)
  expect(h.sent).toBe(0);expect(h.signed).toBe(1)
 })
 it('reads exact non-associated holdings without rounding and retains SOL exclusions visibly',async()=>{
  const h=fixture(),wrapped=Keypair.generate().publicKey
  const old=h.connection.getTokenAccountsByOwner.bind(h.connection)
  h.connection.getTokenAccountsByOwner=async(...args)=>{const value=await old(...args);return{...value,value:'programId' in args[1]&&args[1].programId.equals(TOKEN_PROGRAM_ID)?[...value.value,{pubkey:wrapped,account:h.account(h.payer.publicKey,1n,NATIVE_MINT)}]:value.value}}
  const result=await scanRelayWallet(h.connection,h.input.source)
  expect(result.assets).toHaveLength(2);expect(result.assets[0]).toMatchObject({account:h.input.sourceAccount,amountRaw:h.amount.toString(),eligible:true})
  expect(result.assets[1]).toMatchObject({eligible:false});expect(result.assets[1].reason).toMatch(/SOL/)
 })
 it('rejects a different network and program-owned wallet before presenting an eligible inventory',async()=>{
  const h=fixture();h.connection.getGenesisHash=async()=>Keypair.generate().publicKey.toBase58()
  await expect(scanRelayWallet(h.connection,h.input.source)).rejects.toThrow(/mainnet|network/i)
 })
 it('prepares the exact partial token amount, fee/rent ceiling and retained SOL without exposing signing bytes',async()=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  expect(prepared.input.amountRaw).toBe('777')
  expect(prepared.preview).toMatchObject({networkFeeLamports:'5000',destinationRentLamports:String(h.rent),maxDebitLamports:String(h.rent+h.fee),sourceAfterLamports:String(1_000_000_000-h.rent-h.fee),sourceTokenBeforeRaw:h.amount.toString(),sourceTokenAfterRaw:(h.amount-h.transfer).toString(),destinationAfterRaw:'777'})
  expect(JSON.stringify(prepared)).not.toMatch(/secretKey|transaction|encodedTransactions|signedBytes/)
 })
 it('blocks zero, excessive amounts, self destinations and changed decimals before signing',async()=>{
  const h=fixture()
  for(const input of [{...h.input,amountRaw:'0'},{...h.input,amountRaw:(h.amount+1n).toString()},{...h.input,destination:h.input.source},{...h.input,decimals:9}])await expect(prepareRelayTransfer(h.connection,input)).rejects.toThrow()
  expect(h.signed).toBe(0);expect(h.sent).toBe(0)
 })
 it('rejects malformed or unsupported Token-2022 extension data rather than trusting the listed type',async()=>{
  const h=fixture(),data=Buffer.alloc(getMintLen([ExtensionType.MetadataPointer]));MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:h.amount,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data)
  data[165]=1;data.writeUInt16LE(ExtensionType.MetadataPointer,166);data.writeUInt16LE(63,168)
  h.infos.set(h.mint.toBase58(),{data,owner:TOKEN_2022_PROGRAM_ID,lamports:1000000,executable:false})
  h.infos.set(h.sourceAccount.toBase58(),{...h.infos.get(h.sourceAccount.toBase58())!,owner:TOKEN_2022_PROGRAM_ID})
  await expect(prepareRelayTransfer(h.connection,{...h.input,tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58()})).rejects.toThrow(/extension|program/i)
 })
 it('saves the original public signature before its one broadcast and produces a finalized receipt',async()=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  h.assertBeforeSend=()=>{expect(readRelayReceipts(h.storage)[0].status).toBe('submitted');expect(readPendingWalletOperation(h.storage)?.signature).toBe(readRelayReceipts(h.storage)[0].signature)}
  const result=await executeRelayTransfer(h.connection,prepared,h.options)
  expect(result.status).toBe('confirmed');expect(h.sent).toBe(1);expect(h.signed).toBe(1);expect(readRelayReceipts(h.storage)[0].signature).toBe(result.signature);expect(readPendingWalletOperation(h.storage)).toBeNull()
  expect(()=>assertNoPendingRelayTransfer(h.storage)).not.toThrow()
  expect([...h.storage.data.values()].join('')).not.toMatch(/secretKey|encodedTransactions|rpcEndpoint|signedBytes/)
 })
 it('rejects copied or altered public previews and wallet-modified messages',async()=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  await expect(executeRelayTransfer(h.connection,structuredClone(prepared),h.options)).rejects.toThrow(/preview|prepared/i)
  prepared.input.amountRaw='778'
  await expect(executeRelayTransfer(h.connection,prepared,h.options)).rejects.toThrow(/changed|review/i)
  const fresh=await prepareRelayTransfer(h.connection,h.input)
  await expect(executeRelayTransfer(h.connection,fresh,{...h.options,sign:async()=>new VersionedTransaction(new TransactionMessage({payerKey:h.payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:h.payer.publicKey,toPubkey:h.destination,lamports:1})]}).compileToV0Message())})).rejects.toThrow(/changed|review/i)
  expect(h.sent).toBe(0)
 })
 it('rejects a forged signature, changed signer or stale source balance before broadcast',async()=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  await expect(executeRelayTransfer(h.connection,prepared,{...h.options,sign:async tx=>{tx.signatures[0].fill(1);return tx}})).rejects.toThrow(/signature/i)
  await expect(executeRelayTransfer(h.connection,prepared,{...h.options,readSigner:()=>h.destination.toBase58()})).rejects.toThrow(/wallet|signer/i)
  h.infos.set(h.sourceAccount.toBase58(),h.account(h.payer.publicKey,h.amount+1n))
  await expect(executeRelayTransfer(h.connection,prepared,h.options)).rejects.toThrow(/balance|changed/i)
  expect(h.sent).toBe(0)
 })
 it('stops before any broadcast when receipt persistence or the shared lock fails',async()=>{
  const h=fixture(),prepared=await prepareRelayTransfer(h.connection,h.input)
  await expect(executeRelayTransfer(h.connection,prepared,{...h.options,storage:{...h.storage,setItem:()=>{throw new Error('storage denied')}}})).rejects.toThrow(/storage|receipt|denied/i)
  await expect(executeRelayTransfer(h.connection,prepared,{...h.options,locks:{request:async(_n,_o,cb)=>cb(null)}})).rejects.toThrow(/another|busy/i)
  expect(h.sent).toBe(0)
 })
 it('preserves an unknown original signature after expiry and absent history without resending',async()=>{
  const h=fixture();h.finalized=false
  const result=await executeRelayTransfer(h.connection,await prepareRelayTransfer(h.connection,h.input),h.options)
  expect(result.status).toBe('unknown');expect(()=>assertNoPendingRelayTransfer(h.storage)).toThrow(/pending|confirmation/i)
  h.connection.isBlockhashValid=async()=>({context:{slot:1},value:false})
  const recovered=await reconcileRelayTransfers(h.connection,{storage:h.storage,locks})
  expect(recovered[0].status).toBe('unknown');expect(h.sent).toBe(1)
  h.finalized=true;expect((await reconcileRelayTransfers(h.connection,{storage:h.storage,locks}))[0].status).toBe('confirmed');expect(h.sent).toBe(1)
 })
 it('automatic post-buy Relay transfers only the purchased amount and enforces its complete SOL ceiling',async()=>{
  const h=fixture();h.infos.set(getAssociatedTokenAddressSync(h.mint,h.payer.publicKey).toBase58(),h.infos.get(h.sourceAccount.toBase58())!)
  // The source is the canonical buy account, while pre-existing balance remains.
  const automatic={source:h.input.source,destination:h.input.destination,mint:h.input.mint,amountRaw:h.input.amountRaw,maxDebitLamports:'1',readSigner:h.options.readSigner,sign:h.options.sign,guard:()=>{},storage:h.storage,timeoutMs:2,pollIntervalMs:1}
  await expect(executeConfirmedBuyRelay(h.connection,automatic)).rejects.toThrow(/ceiling|budget|cost/i)
  expect(h.sent).toBe(0)
  const result=await executeConfirmedBuyRelay(h.connection,{...automatic,maxDebitLamports:String(h.rent+h.fee)})
  expect(result.status).toBe('confirmed');expect(h.lastSentAmount).toBe(h.transfer);expect(h.lastSentAmount).not.toBe(h.amount)
 })
 it('fails closed on corrupt receipt storage',()=>{
  const h=fixture();h.storage.setItem(RELAY_RECEIPTS_KEY,'broken');expect(()=>readRelayReceipts(h.storage)).toThrow(/storage|receipt|recovery/i)
 })
 it('distinguishes a verified transfer-fee market candidate from a Relay-eligible transfer',async()=>{
  const h=fixture(),mintData=Buffer.alloc(getMintLen([ExtensionType.TransferFeeConfig])),accountData=Buffer.alloc(getAccountLen([ExtensionType.TransferFeeAmount]))
  h.infos.get(h.mint.toBase58())!.data.copy(mintData);mintData[165]=1;mintData.writeUInt16LE(ExtensionType.TransferFeeConfig,166);mintData.writeUInt16LE(TRANSFER_FEE_CONFIG_SIZE,168)
  h.infos.get(h.sourceAccount.toBase58())!.data.copy(accountData);accountData[165]=2;accountData.writeUInt16LE(ExtensionType.TransferFeeAmount,166);accountData.writeUInt16LE(TRANSFER_FEE_AMOUNT_SIZE,168)
  h.infos.set(h.mint.toBase58(),{data:mintData,owner:TOKEN_2022_PROGRAM_ID,executable:false,lamports:1000000})
  const account={data:accountData,owner:TOKEN_2022_PROGRAM_ID,executable:false,lamports:2039280};h.infos.set(h.sourceAccount.toBase58(),account)
  h.connection.getTokenAccountsByOwner=async(_owner,filter)=>({context:{slot:1},value:'programId' in filter&&filter.programId.equals(TOKEN_2022_PROGRAM_ID)?[{pubkey:h.sourceAccount,account}]:[]})
  const scan=await scanRelayWallet(h.connection,h.input.source)
  expect(scan.assets[0]).toMatchObject({eligible:false,saleEligible:true,decimals:6,amountRaw:h.amount.toString()})
  await expect(prepareRelayTransfer(h.connection,{...h.input,tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58()})).rejects.toThrow(/extension/)
  accountData.writeUInt16LE(TRANSFER_FEE_AMOUNT_SIZE-1,168)
  expect((await scanRelayWallet(h.connection,h.input.source)).assets[0].saleEligible).not.toBe(true)
  accountData.writeUInt16LE(TRANSFER_FEE_AMOUNT_SIZE,168);accountData.writeUInt16LE(ExtensionType.MemoTransfer,166)
  expect((await scanRelayWallet(h.connection,h.input.source)).assets[0].saleEligible).not.toBe(true)
 })
 it('cancellation or a lock during final receipt notification cannot broadcast and resolves the unsent record',async()=>{
  const h=fixture(),abort=new AbortController()
  await expect(executeRelayTransfer(h.connection,await prepareRelayTransfer(h.connection,h.input),{...h.options,signal:abort.signal,onChange:()=>abort.abort()})).rejects.toThrow(/cancel/i)
  expect(h.sent).toBe(0);expect(readRelayReceipts(h.storage)[0].status).toBe('failed');expect(readPendingWalletOperation(h.storage)).toBeNull()
 })
 it('finalized errors preserve the original signature as a failed receipt',async()=>{
  const h=fixture();h.failed=true
  const result=await executeRelayTransfer(h.connection,await prepareRelayTransfer(h.connection,h.input),h.options)
  expect(result.status).toBe('failed');expect(result.signature).toBe(readRelayReceipts(h.storage)[0].signature);expect(h.sent).toBe(1);expect(readPendingWalletOperation(h.storage)).toBeNull()
 })
})
