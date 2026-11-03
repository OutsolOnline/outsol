import {Connection,PublicKey} from '@solana/web3.js'
import {getAssociatedTokenAddressSync} from '@solana/spl-token'
import {withTimeout} from '../transactions/http'
import {formatUnits,MAX_U64,parseExactUnits,publicAddress,type WalletRecipientInput} from './model'
import {checkedMint,checkedTokenAccount,prepareWalletOperation,type PreparedWalletOperation} from './builder'
export interface PercentageRecipient {address:string;percent:string}
/** Round down each recipient independently. The remainder stays in the sender. */
export function percentageRecipients(basisRaw:bigint,balanceRaw:bigint,decimals:number,recipients:PercentageRecipient[]):WalletRecipientInput[]{
 if(basisRaw<0n||basisRaw>MAX_U64||balanceRaw<0n||balanceRaw>MAX_U64||!Number.isInteger(decimals)||decimals<0||decimals>255||!Array.isArray(recipients)||!recipients.length||recipients.length>8)throw new Error('Choose a valid token basis and one to eight recipients.')
 const shares=recipients.map(row=>({address:publicAddress(row.address,true),bps:parseExactUnits(row.percent,2)}))
 if(shares.reduce((sum,row)=>sum+row.bps,0n)>10000n)throw new Error('Combined percentages must not exceed 100%.')
 if(new Set(shares.map(row=>row.address)).size!==shares.length)throw new Error('Each recipient must have a distinct address.')
 const allocations=shares.map(row=>({address:row.address,raw:basisRaw*row.bps/10000n}))
 if(allocations.some(row=>row.raw===0n))throw new Error('A percentage is too small for this token balance. Increase it or remove the recipient.')
 if(allocations.reduce((sum,row)=>sum+row.raw,0n)>balanceRaw)throw new Error('These supply percentages exceed the selected source account balance.')
 return allocations.map(row=>({address:row.address,amount:formatUnits(row.raw,decimals)}))
}
export async function preparePercentageDistribution(connection:Connection,input:{payer:string;mint:string;sourceAccount?:string;priorityFeeSol:string;basis:'balance'|'supply';recipients:PercentageRecipient[]}):Promise<PreparedWalletOperation>{
 const payer=new PublicKey(publicAddress(input.payer,true)),mint=new PublicKey(publicAddress(input.mint))
 if(input.basis!=='balance'&&input.basis!=='supply')throw new Error('Choose holder balance or total supply as the percentage basis.')
 const {state,program}=checkedMint(mint,await withTimeout(connection.getAccountInfo(mint,'confirmed')))
 const source=input.sourceAccount?new PublicKey(publicAddress(input.sourceAccount)):getAssociatedTokenAddressSync(mint,payer,false,program)
 const account=checkedTokenAccount(source,await withTimeout(connection.getAccountInfo(source,'confirmed')),program,mint,payer)
 const recipients=percentageRecipients(input.basis==='supply'?state.supply:account.amount,account.amount,state.decimals,input.recipients)
 return prepareWalletOperation(connection,{kind:'token',payer:payer.toBase58(),mint:mint.toBase58(),sourceAccount:source.toBase58(),priorityFeeSol:input.priorityFeeSol,recipients})
}
