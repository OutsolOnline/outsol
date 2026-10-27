import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {getAssociatedTokenAddressSync,unpackAccount,unpackMint,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token'
import {bondingCurvePda,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk'
import {buildNativeBuyTransaction,buildSellTransaction} from '@/lib/pumpfun/api'
import {validatePumpTransaction} from '@/lib/transactions/validatePumpTransaction'
import {fetchBounded,withTimeout} from '@/lib/transactions/http'

export interface TradeInput{action:'buy'|'sell';mint:string;payer:string;buySol:string;sellPercent:number;slippage:number;priorityFeeSol:number}
export interface TokenPosition{mint:string;payer:string;decimals:number;tokenRaw:string;solLamports:string;tokenProgram:string;ata:string;status:'active'|'graduated'|'unsupported'}
export interface PreparedTrade{transaction:VersionedTransaction;input:TradeInput;position:TokenPosition;maxBuyLamports:string;maxSellRaw:string;tokenAmountRaw:string;minimumSolOut:string;tokenChangeRaw:string;solChangeLamports:string;networkFeeLamports:string;createdAt:number;message:string}
export function formatRawBalance(raw:string,decimals:number,fractionDigits=6):string{
  const value=BigInt(raw),negative=value<0n,absolute=(negative?-value:value).toString().padStart(decimals+1,'0')
  const integer=decimals?absolute.slice(0,-decimals):absolute,fraction=decimals?absolute.slice(-decimals).slice(0,fractionDigits).replace(/0+$/,''):''
  return `${negative?'-':''}${BigInt(integer).toLocaleString('en-US')}${fraction?`.${fraction}`:''}`
}
export function validateTradeInput(input:TradeInput):{maxBuyLamports:bigint;priorityLamports:bigint}{
  new PublicKey(input.payer);new PublicKey(input.mint)
  if(input.action!=='buy'&&input.action!=='sell')throw new Error('Choose buy or sell')
  if(!Number.isFinite(input.slippage)||input.slippage<0||input.slippage>50)throw new Error('Slippage must be 0–50%')
  if(!Number.isFinite(input.priorityFeeSol)||input.priorityFeeSol<0||input.priorityFeeSol>0.01)throw new Error('Priority fee budget must be 0–0.01 SOL')
  if(!Number.isInteger(input.sellPercent)||input.sellPercent<1||input.sellPercent>100)throw new Error('Sell percentage must be a whole number from 1 to 100')
  let maxBuyLamports=0n
  if(input.action==='buy'){
    if(!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(input.buySol))throw new Error('Enter a decimal SOL amount with at most 9 places')
    const [whole,fraction='']=input.buySol.split('.')
    maxBuyLamports=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'))
    if(maxBuyLamports<=0n||maxBuyLamports>1_000_000_000_000n)throw new Error('Buy amount must be above 0 and no more than 1,000 SOL')
  }
  return {maxBuyLamports,priorityLamports:BigInt(Math.round(input.priorityFeeSol*1e9))}
}

export async function readTokenPosition(connection:Connection,mintAddress:string,payerAddress:string):Promise<TokenPosition>{
  const mint=new PublicKey(mintAddress),payer=new PublicKey(payerAddress),curveAddress=bondingCurvePda(mint)
  const [genesis,mintInfo,curveInfo,balance]=await Promise.all([withTimeout(connection.getGenesisHash()),withTimeout(connection.getAccountInfo(mint,'confirmed')),withTimeout(connection.getAccountInfo(curveAddress,'confirmed')),withTimeout(connection.getBalance(payer,'confirmed'))])
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Token management supports Solana mainnet')
  if(!mintInfo||(!mintInfo.owner.equals(TOKEN_PROGRAM_ID)&&!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)))throw new Error('This address is not a supported Solana token mint')
  const mintState=unpackMint(mint,mintInfo,mintInfo.owner),ata=getAssociatedTokenAddressSync(mint,payer,false,mintInfo.owner)
  const tokenInfo=await withTimeout(connection.getAccountInfo(ata,'confirmed'))
  const tokenRaw=tokenInfo?unpackAccount(ata,tokenInfo,mintInfo.owner).amount.toString():'0'
  let status:TokenPosition['status']='unsupported'
  if(curveInfo?.owner.equals(PUMP_PROGRAM_ID)){
    const curve=PUMP_SDK.decodeBondingCurve(curveInfo)
    if(curve.complete)status='graduated'
    else if(curve.quoteMint.equals(PublicKey.default)||curve.quoteMint.equals(NATIVE_MINT))status='active'
  }
  return {mint:mint.toBase58(),payer:payer.toBase58(),decimals:mintState.decimals,tokenRaw,solLamports:String(balance),tokenProgram:mintInfo.owner.toBase58(),ata:ata.toBase58(),status}
}

export function inspectTradeIntent(tx:VersionedTransaction,input:TradeInput,maxSellRaw:bigint){
  const limits=validateTradeInput(input)
  validatePumpTransaction(tx,{action:input.action,payer:input.payer,mint:input.mint,maxSolLamports:limits.maxBuyLamports,maxPriorityFeeLamports:limits.priorityLamports})
  const discriminator=input.action==='buy'?[102,6,61,18,1,218,235,234]:[51,230,133,164,1,127,131,173]
  const ix=tx.message.compiledInstructions.find(ix=>tx.message.staticAccountKeys[ix.programIdIndex]?.equals(PUMP_PROGRAM_ID)&&Buffer.from(ix.data).subarray(0,8).equals(Buffer.from(discriminator)))
  if(!ix)throw new Error('Native trade instruction is missing')
  const data=Buffer.from(ix.data),tokenAmount=data.readBigUInt64LE(8)
  if(tokenAmount<=0n)throw new Error('Trade token amount must be positive')
  if(input.action==='sell'&&tokenAmount!==maxSellRaw)throw new Error('The sell amount changed; prepare a fresh preview')
  return {tokenAmountRaw:tokenAmount.toString(),minimumSolOut:input.action==='sell'?data.readBigUInt64LE(16).toString():'0'}
}

export async function simulateTradePreview(connection:Connection,transaction:VersionedTransaction,position:TokenPosition,limits:{action:'buy'|'sell';maxBuyLamports:bigint;maxSellRaw:bigint;minimumSolOut:bigint}){
  const accounts={encoding:'base64',addresses:[position.payer,position.ata]}
  const [simulation,fee]=await Promise.all([
    fetchBounded(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:[Buffer.from(transaction.serialize()).toString('base64')]},{transactionEncoding:'base64',skipSigVerify:true,replaceRecentBlockhash:true,preExecutionAccountsConfigs:[accounts],postExecutionAccountsConfigs:[accounts]}]})},response=>response.json()),
    withTimeout(connection.getFeeForMessage(transaction.message,'confirmed')),
  ])
  if(simulation.error)throw new Error('The RPC could not provide a complete same-bank trade preview')
  const value=simulation.result?.value,results=value?.transactionResults
  if(value?.summary!=='succeeded'||!Array.isArray(results)||results.length!==1||results[0].err!==null)throw new Error('Trade simulation failed; no transaction was submitted')
  const beforePayer=results[0].preExecutionAccounts?.[0],beforeToken=results[0].preExecutionAccounts?.[1]
  const afterPayer=results[0].postExecutionAccounts?.[0],afterToken=results[0].postExecutionAccounts?.[1]
  if(!beforePayer||!afterPayer||!afterToken||fee.value===null)throw new Error('The RPC could not verify both sides of the trade preview')
  const readAmount=(account:{data?:unknown;lamports?:number;owner?:string}|null|undefined)=>{
    if(!account)return 0n
    if(!Array.isArray(account.data)||account.data[1]!=='base64'||typeof account.data[0]!=='string')throw new Error('A simulated token balance is unreadable')
    const bytes=Buffer.from(account.data[0],'base64')
    // Jito may represent a missing pre-state ATA as an empty System account.
    if(bytes.length===0&&account.lamports===0&&account.owner===PublicKey.default.toBase58())return 0n
    if(bytes.length<72)throw new Error('A simulated token balance is incomplete')
    return bytes.readBigUInt64LE(64)
  }
  const beforeRaw=readAmount(beforeToken),tokenChange=readAmount(afterToken)-beforeRaw
  const solChange=BigInt(afterPayer.lamports)-BigInt(beforePayer.lamports)
  if(limits.action==='buy'&&(tokenChange<=0n||solChange>=0n||-solChange>limits.maxBuyLamports+BigInt(fee.value)+10_000_000n))throw new Error('The purchase does not match the approved SOL and account-rent ceiling')
  if(limits.action==='sell'&&(beforeRaw!==BigInt(position.tokenRaw)||tokenChange!==-limits.maxSellRaw||solChange+BigInt(fee.value)<limits.minimumSolOut))throw new Error('The sale balance changed or minimum output could not be verified; prepare again')
  return {tokenChangeRaw:tokenChange.toString(),solChangeLamports:solChange.toString(),networkFeeLamports:String(fee.value)}
}

/** Read-only construction and unsigned simulation. No wallet keys or sends. */
export async function preparePumpTrade(connection:Connection,input:TradeInput):Promise<PreparedTrade>{
  const limits=validateTradeInput(input),position=await readTokenPosition(connection,input.mint,input.payer)
  if(position.status!=='active')throw new Error(position.status==='graduated'?'This token graduated. Use its canonical trading venue below.':'Native trading here supports active SOL Pump.fun curves. Use the token’s launch venue below.')
  const maxSellRaw=input.action==='sell'?BigInt(position.tokenRaw)*BigInt(input.sellPercent)/100n:0n
  if(input.action==='sell'&&maxSellRaw===0n)throw new Error('No associated token balance is available to sell')
  let transaction:VersionedTransaction
  if(input.action==='buy')transaction=await buildNativeBuyTransaction({connection,userPublicKey:input.payer,mintAddress:input.mint,maxBuyAmountSol:Number(limits.maxBuyLamports)/1e9,slippage:input.slippage,priorityFee:input.priorityFeeSol})
  else{
    const built=await buildSellTransaction({connection,userPublicKey:input.payer,mintAddress:input.mint,sellPercent:input.sellPercent,slippage:input.slippage,priorityFee:input.priorityFeeSol})
    if(!built.success||!built.transaction)throw new Error(built.error||'Native sell construction failed')
    transaction=built.transaction
  }
  const intent=inspectTradeIntent(transaction,input,maxSellRaw)
  const preview=await simulateTradePreview(connection,transaction,position,{...limits,action:input.action,maxSellRaw,minimumSolOut:BigInt(intent.minimumSolOut)})
  return {transaction,input:{...input},position,maxBuyLamports:limits.maxBuyLamports.toString(),maxSellRaw:maxSellRaw.toString(),...intent,...preview,createdAt:Date.now(),message:Buffer.from(transaction.message.serialize()).toString('base64')}
}
