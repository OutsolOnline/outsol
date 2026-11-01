import {AddressLookupTableAccount,AddressLookupTableProgram,ComputeBudgetProgram,Connection,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {ASSOCIATED_TOKEN_PROGRAM_ID,ACCOUNT_SIZE,getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_2022_PROGRAM_ID,TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token'
import {bondingCurvePda,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {preparePumpTrade,inspectTradeIntent} from '@/lib/venues/trade'
import {signedTransactionSignature} from '@/lib/transactions/send'
import {fetchBounded,withTimeout} from '@/lib/transactions/http'
import {checkedRelayMint,checkedRelayAccount} from '@/lib/relay/scan'

export interface MarketSaleInput {payer:string;mint:string;amountRaw:string;decimals:number;tokenProgram:string;slippageBps:number;priorityFeeLamports:string}
export interface PreparedMarketSale {input:MarketSaleInput;transaction:VersionedTransaction;message:string;route:'pump'|'jupiter';payer:string;mint:string;amountRaw:string;minimumSolOut:string;estimatedSolOut:string;estimatedNetSolOut:string;networkFeeLamports:string;maxDebitLamports:string;createdAt:number;lastValidBlockHeight:number;tokenAccount:string}
interface Manifest {input:MarketSaleInput;message:string;route:'pump'|'jupiter';minimum:bigint;addresses:string[];source:string;destination:string;setups:Set<string>;rentCeiling:bigint;createdAt:number;maxDebit?:bigint}
const prepared=new WeakMap<PreparedMarketSale,Manifest>()
const JUPITER=new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
const EVENT=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],JUPITER)[0]
// Jupiter official RFQ decoder IDL, revision f3f30ff2af48f63c11f326a486b8b0eb9611714f:
// fill-decoder/idls/aggregator.json, route_v2. Scalar bounds precede the route DAG.
const ROUTE_V2=Buffer.from([187,100,250,204,49,196,175,20])
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const MAX_U64=18446744073709551615n
const address=(value:unknown)=>{if(typeof value!=='string'||new PublicKey(value).toBase58()!==value)throw new Error('A sale address is invalid.');return new PublicKey(value)}
function amount(value:unknown):bigint {if(typeof value!=='string'||!/^(0|[1-9]\d{0,19})$/.test(value)||BigInt(value)>MAX_U64)throw new Error('A sale amount is invalid.');return BigInt(value)}
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The market returned an unreadable sale.');return value as Record<string,unknown>}
export function validateMarketSaleInput(value:unknown):MarketSaleInput {
 const input=record(value),fields=['payer','mint','amountRaw','decimals','tokenProgram','slippageBps','priorityFeeLamports']
 if(Object.keys(input).length!==fields.length||Object.keys(input).some(key=>!fields.includes(key)))throw new Error('Review a complete sale configuration.')
 const payer=address(input.payer),mint=address(input.mint),tokenProgram=address(input.tokenProgram)
 if(!PublicKey.isOnCurve(payer.toBytes())||mint.equals(NATIVE_MINT)||!amount(input.amountRaw)||!Number.isInteger(input.decimals)||Number(input.decimals)<0||Number(input.decimals)>255||!Number.isInteger(input.slippageBps)||Number(input.slippageBps)<0||Number(input.slippageBps)>5000||amount(input.priorityFeeLamports)>10000000n||(!tokenProgram.equals(TOKEN_PROGRAM_ID)&&!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)))throw new Error('Choose a fungible token, a valid wallet and bounded sale settings.')
 return {payer:payer.toBase58(),mint:mint.toBase58(),amountRaw:input.amountRaw as string,decimals:Number(input.decimals),tokenProgram:tokenProgram.toBase58(),slippageBps:Number(input.slippageBps),priorityFeeLamports:input.priorityFeeLamports as string}
}
function instruction(value:unknown):TransactionInstruction {
 const raw=record(value)
 if(typeof raw.data!=='string'||raw.data.length>4000||!Array.isArray(raw.accounts)||raw.accounts.length>256)throw new Error('An unbounded market instruction was refused.')
 const data=Buffer.from(raw.data,'base64')
 if(data.toString('base64')!==raw.data)throw new Error('An instruction encoding is invalid.')
 return new TransactionInstruction({programId:address(raw.programId),data,keys:raw.accounts.map(value=>{const key=record(value);if(typeof key.isSigner!=='boolean'||typeof key.isWritable!=='boolean')throw new Error('Instruction permissions are unreadable.');return {pubkey:address(key.pubkey),isSigner:key.isSigner,isWritable:key.isWritable}})})
}
function same(ix:TransactionInstruction,index:number,expected:PublicKey,writable?:boolean,signer?:boolean){const key=ix.keys[index];if(!key?.pubkey.equals(expected)||(writable!==undefined&&key.isWritable!==writable)||(signer!==undefined&&key.isSigner!==signer))throw new Error('The market instruction changed a reviewed account or recipient.')}
function apiRecipe(value:unknown,input:MarketSaleInput){
 const body=record(value),payer=address(input.payer),mint=address(input.mint),program=address(input.tokenProgram),source=getAssociatedTokenAddressSync(mint,payer,false,program),destination=getAssociatedTokenAddressSync(NATIVE_MINT,payer)
 const quoted=amount(body.outAmount),minimum=(quoted*BigInt(10000-input.slippageBps)+9999n)/10000n
 if(body.inputMint!==input.mint||body.outputMint!==NATIVE_MINT.toBase58()||body.inAmount!==input.amountRaw||body.swapMode!=='ExactIn'||body.slippageBps!==input.slippageBps||amount(body.otherAmountThreshold)!==minimum||minimum<=0n||(body.transactionVersion!==undefined&&body.transactionVersion!==0))throw new Error('The market quote differs from the reviewed sale bounds.')
 if(body.platformFee!=null){const fee=record(body.platformFee);if(amount(fee.amount)!==0n||fee.feeBps!==0)throw new Error('A market platform fee was refused.')}
 if(!Array.isArray(body.routePlan)||!body.routePlan.length||body.routePlan.length>16||!Array.isArray(body.setupInstructions)||body.setupInstructions.length>8||!Array.isArray(body.computeBudgetInstructions)||body.computeBudgetInstructions.length>1||!Array.isArray(body.otherInstructions)||body.otherInstructions.length||body.tipInstruction!=null)throw new Error('An unsupported market route, additional instruction or tip was refused.')
 for(const value of body.routePlan){const row=record(value),info=record(row.swapInfo);address(info.ammKey);address(info.inputMint);address(info.outputMint);amount(info.inAmount);amount(info.outAmount);if(!Number.isInteger(row.bps)||Number(row.bps)<1||Number(row.bps)>10000)throw new Error('The market route allocation is invalid.')}
 for(const raw of body.computeBudgetInstructions){const ix=instruction(raw);if(!ix.programId.equals(ComputeBudgetProgram.programId)||ix.keys.length||ix.data.length!==9||ix.data[0]!==3)throw new Error('An unexpected market compute instruction was refused.')}
 const setupInstructions=body.setupInstructions.map(instruction),setups=new Set<string>()
 for(const ix of setupInstructions){
  if(!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)||ix.data.length!==1||ix.data[0]!==1||ix.keys.length!==6)throw new Error('Only canonical same-owner associated account setup is supported.')
  const setupMint=ix.keys[3].pubkey,setupProgram=ix.keys[5].pubkey
  if(!setupProgram.equals(TOKEN_PROGRAM_ID)&&!setupProgram.equals(TOKEN_2022_PROGRAM_ID))throw new Error('An unsupported setup token program was refused.')
  const ata=getAssociatedTokenAddressSync(setupMint,payer,false,setupProgram)
  same(ix,0,payer,true,true);same(ix,1,ata,true,false);same(ix,2,payer,false,false);same(ix,3,setupMint,false,false);same(ix,4,SystemProgram.programId,false,false);same(ix,5,setupProgram,false,false)
  if(setups.has(ata.toBase58()))throw new Error('Duplicate associated account setup was refused.')
  setups.add(ata.toBase58())
 }
 const swap=instruction(body.swapInstruction),data=swap.data
 if(!swap.programId.equals(JUPITER)||data.length<39||!data.subarray(0,8).equals(ROUTE_V2)||data.readBigUInt64LE(8)!==amount(input.amountRaw)||data.readBigUInt64LE(16)!==quoted||data.readUInt16LE(24)!==input.slippageBps||data.readUInt16LE(26)!==0||data.readUInt16LE(28)!==0||data.readUInt32LE(30)!==body.routePlan.length)throw new Error('The market swap variant, amount, slippage or zero-fee policy could not be verified.')
 same(swap,0,payer,undefined,true);same(swap,1,source,true,false);same(swap,2,destination,true,false);same(swap,3,mint,false,false);same(swap,4,NATIVE_MINT,false,false);same(swap,5,program,false,false);same(swap,6,TOKEN_PROGRAM_ID,false,false);same(swap,7,payer,true,false);same(swap,8,EVENT,false,false);same(swap,9,JUPITER,false,false)
 const cleanup=instruction(body.cleanupInstruction)
 if(!cleanup.programId.equals(TOKEN_PROGRAM_ID)||cleanup.data.length!==1||cleanup.data[0]!==9||cleanup.keys.length!==3)throw new Error('Native SOL cleanup is missing or unsupported.')
 same(cleanup,0,destination,true,false);same(cleanup,1,payer,true,false);same(cleanup,2,payer,false,true)
 const instructions=[...setupInstructions,swap,cleanup]
 if(instructions.some(ix=>ix.keys.some(key=>key.isSigner&&!key.pubkey.equals(payer))))throw new Error('A foreign market signer was refused.')
 return {instructions,setups,source:source.toBase58(),destination:destination.toBase58(),quoted,minimum,lookup:body.addressesByLookupTableAddress}
}
async function lookupTables(connection:Connection,value:unknown):Promise<AddressLookupTableAccount[]> {
 if(value==null)return []
 const entries=Object.entries(record(value));if(entries.length>8)throw new Error('The market route uses too many lookup tables.')
 return Promise.all(entries.map(async([key,claimed])=>{
  const pubkey=address(key)
  if(!Array.isArray(claimed)||claimed.length>256||claimed.some(value=>typeof value!=='string'))throw new Error('The lookup table address list is invalid.')
  const info=await withTimeout(connection.getAccountInfo(pubkey,'confirmed'))
  if(!info?.owner.equals(AddressLookupTableProgram.programId)||info.executable)throw new Error('A market lookup table has an unexpected owner.')
  let state:ReturnType<typeof AddressLookupTableAccount.deserialize>
  try{state=AddressLookupTableAccount.deserialize(info.data)}catch{throw new Error('A market lookup table could not be decoded.')}
  if(state.deactivationSlot!==MAX_U64||state.addresses.length!==claimed.length||state.addresses.some((address,index)=>address.toBase58()!==claimed[index]))throw new Error('The market lookup table contents changed or are not active.')
  return new AddressLookupTableAccount({key:pubkey,state})
 }))
}
function writableAddresses(tx:VersionedTransaction,tables:AddressLookupTableAccount[]):string[]{const keys=tx.message.getAccountKeys({addressLookupTableAccounts:tables}),result:string[]=[];for(let index=0;index<keys.length;index++)if(tx.message.isAccountWritable(index))result.push(keys.get(index)!.toBase58());if(result.length>64)throw new Error('This route has too many writable accounts to inspect safely.');return result}
interface SimAccount {owner?:unknown;lamports?:unknown;data?:unknown;executable?:unknown}
function simAccount(value:unknown){if(value==null)return null;const raw=record(value) as SimAccount;if(typeof raw.lamports!=='number'||!Number.isSafeInteger(raw.lamports)||raw.lamports<0||!Array.isArray(raw.data)||raw.data.length!==2||raw.data[1]!=='base64'||typeof raw.data[0]!=='string')throw new Error('The same-bank sale account data is incomplete.');const data=Buffer.from(raw.data[0],'base64');if(data.toString('base64')!==raw.data[0])throw new Error('A simulated account encoding is invalid.');const owner=address(raw.owner);if(!data.length&&raw.lamports===0&&owner.equals(SystemProgram.programId)&&!raw.executable)return null;return {owner,lamports:raw.lamports,data,executable:raw.executable===true,rentEpoch:0}}
function tokenOwned(value:ReturnType<typeof simAccount>,owner:PublicKey,addressKey:PublicKey){if(!value||(!value.owner.equals(TOKEN_PROGRAM_ID)&&!value.owner.equals(TOKEN_2022_PROGRAM_ID))||value.data.length<ACCOUNT_SIZE||(value.owner.equals(TOKEN_2022_PROGRAM_ID)&&value.data.length>ACCOUNT_SIZE&&value.data[ACCOUNT_SIZE]===1))return null;const decoded=unpackAccount(addressKey,value,value.owner);return decoded.owner.equals(owner)?decoded:null}
function maskedAmount(value:Buffer){const result=Buffer.from(value);result.fill(0,64,72);return result}
async function simulate(connection:Connection,manifest:Manifest,transaction:VersionedTransaction,signed:boolean,guard:()=>void){
 guard();const accounts={encoding:'base64',addresses:manifest.addresses}
 const [raw,fee]=await Promise.all([fetchBounded(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:[Buffer.from(transaction.serialize()).toString('base64')]},{transactionEncoding:'base64',skipSigVerify:!signed,replaceRecentBlockhash:false,preExecutionAccountsConfigs:[accounts],postExecutionAccountsConfigs:[accounts]}]})},response=>response.json()),withTimeout(connection.getFeeForMessage(transaction.message,'confirmed'))]);guard()
 const value=raw?.result?.value,rows=value?.transactionResults
 if(raw?.error||value?.summary!=='succeeded'||!Array.isArray(rows)||rows.length!==1||rows[0]?.err!==null||!Array.isArray(rows[0].preExecutionAccounts)||!Array.isArray(rows[0].postExecutionAccounts)||rows[0].preExecutionAccounts.length!==manifest.addresses.length||rows[0].postExecutionAccounts.length!==manifest.addresses.length||typeof fee.value!=='number'||!Number.isSafeInteger(fee.value)||fee.value<1)throw new Error('The complete same-bank sale simulation failed. Nothing was submitted.')
 const before=rows[0].preExecutionAccounts.map(simAccount),after=rows[0].postExecutionAccounts.map(simAccount),payer=address(manifest.input.payer),sourceIndex=manifest.addresses.indexOf(manifest.source),payerIndex=manifest.addresses.indexOf(manifest.input.payer),payerBefore=before[payerIndex],payerAfter=after[payerIndex]
 if(!payerBefore||!payerAfter||!payerBefore.owner.equals(SystemProgram.programId)||!payerAfter.owner.equals(SystemProgram.programId)||payerBefore.data.length||payerAfter.data.length||payerBefore.executable||payerAfter.executable)throw new Error('The signing wallet state could not be verified.')
 if(sourceIndex<0)throw new Error('The sale input account is missing.')
 let rentDelta=0n
 for(let index=0;index<manifest.addresses.length;index++){
  const key=new PublicKey(manifest.addresses[index]),pre=before[index],post=after[index],old=tokenOwned(pre,payer,key),current=tokenOwned(post,payer,key)
  if(index===sourceIndex){
   if(!old||!current||!pre||!post||old.mint.toBase58()!==manifest.input.mint||!pre.owner.equals(address(manifest.input.tokenProgram))||!pre.owner.equals(post.owner)||old.amount-current.amount!==amount(manifest.input.amountRaw)||!maskedAmount(pre.data).equals(maskedAmount(post.data))||pre.lamports!==post.lamports)throw new Error('The exact sale amount or input token authority changed.')
  }else if(key.toBase58()===manifest.destination){
   if((old&&old.amount!==0n)||current||(post&&(post.data.length||post.lamports)))throw new Error('Native SOL output cleanup or the existing wrapped SOL balance changed.')
   if(old&&pre)rentDelta-=BigInt(pre.lamports)
  }else if(old){
   if(!current||!pre||!post||!pre.owner.equals(post.owner)||!pre.data.equals(post.data)||pre.lamports!==post.lamports)throw new Error('An unrelated owned token account changed during the sale.')
  }else if(current){
   if(pre||!post||!manifest.setups.has(key.toBase58())||current.amount!==0n||current.delegate||current.closeAuthority)throw new Error('The sale created an unexpected token holding or authority.')
   rentDelta+=BigInt(post.lamports)
  }
 }
 const networkFee=BigInt(fee.value),change=BigInt(payerAfter.lamports)-BigInt(payerBefore.lamports),debit=change<0n?-change:0n
 if(networkFee>amount(manifest.input.priorityFeeLamports)+100000n||change+networkFee+rentDelta<manifest.minimum||rentDelta>manifest.rentCeiling||debit>networkFee+manifest.rentCeiling||(manifest.maxDebit!==undefined&&(networkFee+manifest.rentCeiling>manifest.maxDebit||debit>manifest.maxDebit)))throw new Error('The sale proceeds or network/account-rent cost exceeds the reviewed bounds.')
 return {walletBeforeLamports:String(payerBefore.lamports),netDebitLamports:debit.toString(),networkFeeLamports:networkFee.toString(),netSolOut:change.toString()}
}
/** Read-only native construction or fixed-provider instructions; no keys or broadcasts. */
export async function prepareMarketSale(connection:Connection,value:MarketSaleInput,reviewedMinimumSolOut?:string):Promise<PreparedMarketSale>{
 const floor=reviewedMinimumSolOut===undefined?0n:amount(reviewedMinimumSolOut)
 if(reviewedMinimumSolOut!==undefined&&floor===0n)throw new Error('The reviewed minimum must be positive.')
 const input=validateMarketSaleInput(value),payer=address(input.payer),mint=address(input.mint),program=address(input.tokenProgram),source=getAssociatedTokenAddressSync(mint,payer,false,program),destination=getAssociatedTokenAddressSync(NATIVE_MINT,payer)
 if(await withTimeout(connection.getGenesisHash())!==MAINNET)throw new Error('Market sales support Solana mainnet only.')
 const [mintInfo,sourceInfo,curveInfo]=await withTimeout(connection.getMultipleAccountsInfo([mint,source,bondingCurvePda(mint)],'confirmed'))
 if(!mintInfo?.owner.equals(program)||!sourceInfo?.owner.equals(program))throw new Error('The token mint or canonical wallet account is missing or changed.')
 const mintState=checkedRelayMint(mint,mintInfo,program,true),tokens=checkedRelayAccount(source,sourceInfo,program,mint,payer,true)
 if(mintState.decimals!==input.decimals||!tokens.owner.equals(payer)||!tokens.mint.equals(mint)||tokens.isFrozen||!tokens.isInitialized||tokens.isNative||tokens.amount<amount(input.amountRaw))throw new Error('The wallet token balance, mint, or token state changed. Scan again.')
 let transaction:VersionedTransaction,lastValidBlockHeight:number,route:'pump'|'jupiter',minimum:bigint,quoted:bigint,setups=new Set<string>(),rentCeiling:bigint,tables:AddressLookupTableAccount[]=[]
 if(curveInfo?.owner.equals(PUMP_PROGRAM_ID)&&!PUMP_SDK.decodeBondingCurve(curveInfo).complete){
  const native=await preparePumpTrade(connection,{action:'sell',mint:input.mint,payer:input.payer,buySol:'0',sellPercent:100,slippage:input.slippageBps/100,priorityFeeSol:Number(amount(input.priorityFeeLamports))/1e9})
  if(native.maxSellRaw!==input.amountRaw)throw new Error('The native sale balance changed. Scan and review again.')
  transaction=native.transaction;route='pump';minimum=BigInt(native.minimumSolOut);quoted=BigInt(native.solChangeLamports)+BigInt(native.networkFeeLamports);rentCeiling=10000000n
  if(floor>minimum){
   // A preceding sale in this queue can move the curve. Keep the original
   // approval enforced on-chain, then prove the stronger packet in one bank.
   const message=TransactionMessage.decompile(transaction.message),sells=message.instructions.filter(ix=>ix.programId.equals(PUMP_PROGRAM_ID)&&ix.data.subarray(0,8).equals(Buffer.from([51,230,133,164,1,127,131,173])))
   if(sells.length!==1||sells[0].data.length!==24||sells[0].data.readBigUInt64LE(16)!==minimum)throw new Error('The exact native sale minimum cannot be retained. Review a fresh sale.')
   sells[0].data=Buffer.from(sells[0].data);sells[0].data.writeBigUInt64LE(floor,16)
   transaction=new VersionedTransaction(new TransactionMessage({payerKey:message.payerKey,recentBlockhash:message.recentBlockhash,instructions:message.instructions}).compileToV0Message());minimum=floor
   if(inspectTradeIntent(transaction,{action:'sell',mint:input.mint,payer:input.payer,buySol:'0',sellPercent:100,slippage:input.slippageBps/100,priorityFeeSol:Number(amount(input.priorityFeeLamports))/1e9},amount(input.amountRaw)).minimumSolOut!==minimum.toString())throw new Error('The reviewed native sale minimum changed.')
  }
  lastValidBlockHeight=(await withTimeout(connection.getLatestBlockhash('confirmed'))).lastValidBlockHeight
 }else{
  const raw=await fetchBounded('/api/sales/build',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},async response=>{const text=await response.text();if(text.length>500000)throw new Error('The market build response is too large.');const value=JSON.parse(text);if(value.error)throw new Error(String(value.error).slice(0,200));return value})
  const recipe=apiRecipe(raw,input);tables=await lookupTables(connection,recipe.lookup);setups=recipe.setups;minimum=recipe.minimum;quoted=recipe.quoted;route='jupiter'
  if(minimum<floor)throw new Error('The market route cannot retain the reviewed minimum. Review a fresh sale.')
  const [hash,rent]=await Promise.all([withTimeout(connection.getLatestBlockhash('confirmed')),withTimeout(connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE,'confirmed'))])
  if(!Number.isSafeInteger(hash.lastValidBlockHeight)||hash.lastValidBlockHeight<1||!Number.isSafeInteger(rent)||rent<1)throw new Error('Current transaction expiry or account rent is unavailable.')
  lastValidBlockHeight=hash.lastValidBlockHeight;rentCeiling=BigInt(rent)*BigInt(setups.size)
  const units=1400000,price=amount(input.priorityFeeLamports)*1000000n/BigInt(units)
  transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:hash.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:price}),...recipe.instructions]}).compileToV0Message(tables))
 }
 if(transaction.serialize().length>1232||transaction.message.header.numRequiredSignatures!==1||!transaction.message.staticAccountKeys[0].equals(payer))throw new Error('The sale packet exceeds wallet or signer limits.')
 const message=Buffer.from(transaction.message.serialize()).toString('base64'),createdAt=Date.now(),manifest:Manifest={input:{...input},message,route,minimum,addresses:writableAddresses(transaction,tables),source:source.toBase58(),destination:destination.toBase58(),setups,rentCeiling,createdAt}
 const preview=await simulate(connection,manifest,transaction,false,()=>{}),fee=BigInt(preview.networkFeeLamports),maxDebit=fee+rentCeiling
 manifest.maxDebit=maxDebit
 const plan:PreparedMarketSale=Object.freeze({input:Object.freeze({...input}),transaction:VersionedTransaction.deserialize(transaction.serialize()),message,route,payer:input.payer,mint:input.mint,amountRaw:input.amountRaw,minimumSolOut:minimum.toString(),estimatedSolOut:quoted.toString(),estimatedNetSolOut:preview.netSolOut,networkFeeLamports:preview.networkFeeLamports,maxDebitLamports:maxDebit.toString(),createdAt,lastValidBlockHeight,tokenAccount:source.toBase58()})
 prepared.set(plan,manifest);return plan
}
export function assertMarketSale(plan:PreparedMarketSale,transaction:VersionedTransaction):void {
 const manifest=prepared.get(plan)
 if(!manifest||Buffer.from(transaction.message.serialize()).toString('base64')!==manifest.message||Date.now()-manifest.createdAt>60000||transaction.message.header.numRequiredSignatures!==1||transaction.message.staticAccountKeys[0].toBase58()!==manifest.input.payer)throw new Error('The approved sale message changed or expired. Prepare a fresh review.')
 if(manifest.route==='pump')inspectTradeIntent(transaction,{action:'sell',mint:manifest.input.mint,payer:manifest.input.payer,buySol:'0',sellPercent:100,slippage:manifest.input.slippageBps/100,priorityFeeSol:Number(amount(manifest.input.priorityFeeLamports))/1e9},amount(manifest.input.amountRaw))
}
export async function simulateSignedMarketSale(connection:Connection,plan:PreparedMarketSale,signed:VersionedTransaction,guard:()=>void):Promise<{walletBeforeLamports:string;netDebitLamports:string;networkFeeLamports:string}>{
 guard();assertMarketSale(plan,signed);signedTransactionSignature(signed)
 const result=await simulate(connection,prepared.get(plan)!,signed,true,guard)
 guard();assertMarketSale(plan,signed);return {walletBeforeLamports:result.walletBeforeLamports,netDebitLamports:result.netDebitLamports,networkFeeLamports:result.networkFeeLamports}
}
