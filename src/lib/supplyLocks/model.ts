import {PublicKey} from '@solana/web3.js'
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {creatorAddress,creatorAmount,exactObject,type CreatorLocks,type CreatorStorage} from '../creatorOperations/model'
import {LOCK_WITHDRAWOR,lockAddresses} from './addresses'
export {LOCK_PROGRAM,LOCK_ORACLE,LOCK_ORACLE_PROGRAM,lockAddresses} from './addresses'

export type SupplyLockStorage=CreatorStorage
export type SupplyLockLocks=CreatorLocks
export interface SupplyLockInput {version:1;mint:string;payer:string;recipient:string;amountRaw:string;unlockAt:number;priorityFeeLamports:string}
export interface SupplyLockIntent extends SupplyLockInput {tokenProgram:string;decimals:number;nonce:number;metadata:string;escrow:string;feeUnits:number;creationFeeLamports:string;tokenFeeRaw:string;sourceDebitRaw:string;maxDebitLamports:string}
export interface SupplyLockPosition {mint:string;payer:string;tokenProgram:string;decimals:number;supplyRaw:string;balanceRaw:string;chainTime:number;slot:number;feeUnits:number;creationFeeLamports:string;oracleData:string}
export interface SupplyLockPreview {payerBeforeLamports:string;payerAfterLamports:string;networkFeeLamports:string;rentLamports:string;creationFeeLamports:string;maxDebitLamports:string;sourceBeforeRaw:string;sourceAfterRaw:string;lockedRaw:string;tokenFeeRaw:string}
export function normalizeSupplyLockInput(value:unknown):SupplyLockInput{
 const row=exactObject(value,['version','mint','payer','recipient','amountRaw','unlockAt','priorityFeeLamports'])
 if(row.version!==1||typeof row.unlockAt!=='number'||!Number.isSafeInteger(row.unlockAt)||row.unlockAt<1)throw new Error('Choose a valid lock date.')
 const input:SupplyLockInput={version:1,mint:creatorAddress(row.mint),payer:creatorAddress(row.payer,true),recipient:creatorAddress(row.recipient,true),amountRaw:creatorAmount(row.amountRaw),unlockAt:row.unlockAt,priorityFeeLamports:creatorAmount(row.priorityFeeLamports)}
 if(input.amountRaw==='0'||input.mint===NATIVE_MINT.toBase58()||BigInt(input.priorityFeeLamports)>10000000n)throw new Error('Choose a positive fungible token amount and a priority fee up to 0.01 SOL.')
 return input
}
/** The pinned SDK uses four decimal places of percentage precision. No floating amount arithmetic. */
export function supplyLockFees(amountRaw:string,feeUnits:number):{tokenFeeRaw:string;sourceDebitRaw:string}{
 const amount=BigInt(creatorAmount(amountRaw));if(!Number.isInteger(feeUnits)||feeUnits<0||feeUnits>1000000)throw new Error('The live Streamflow token fee is invalid.')
 const fee=amount*BigInt(feeUnits)/1000000n,total=amount+fee;creatorAmount(total.toString())
 return{tokenFeeRaw:fee.toString(),sourceDebitRaw:total.toString()}
}
/** Owner verification happens before this parser. Never use SDK fallback fee constants. */
export function readSupplyLockFees(data:Buffer):{creationFeeLamports:string;feeUnits:number}{
 if(data.length<4)throw new Error('The live Streamflow fee oracle is missing.')
 const count=data.readUInt32LE(0);if(count<1||count>Math.floor((data.length-4)/60))throw new Error('The live Streamflow fee oracle is incomplete.')
 const rows:{creationFeeLamports:string;feeUnits:number}[]=[]
 for(let index=0;index<count;index++){
  const offset=4+index*60;if(!new PublicKey(data.subarray(offset,offset+32)).equals(LOCK_WITHDRAWOR))continue
  const percent=data.readFloatLE(offset+44);if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error('The live Streamflow fee percentage is invalid.')
  rows.push({creationFeeLamports:String(data.readUInt32LE(offset+32)),feeUnits:Math.round(Number(percent.toFixed(4))*10000)})
 }
 if(rows.length!==1)throw new Error('The live Streamflow lock fees could not be established uniquely.')
 return rows[0]
}
export function parseSupplyLockIntent(value:unknown):SupplyLockIntent{
 const row=exactObject(value,['version','mint','payer','recipient','amountRaw','unlockAt','priorityFeeLamports','tokenProgram','decimals','nonce','metadata','escrow','feeUnits','creationFeeLamports','tokenFeeRaw','sourceDebitRaw','maxDebitLamports'])
 const input=normalizeSupplyLockInput(Object.fromEntries(['version','mint','payer','recipient','amountRaw','unlockAt','priorityFeeLamports'].map(key=>[key,row[key]])))
 if(typeof row.nonce!=='number'||typeof row.feeUnits!=='number'||typeof row.decimals!=='number'||!Number.isInteger(row.decimals)||row.decimals<0||row.decimals>9||![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(String(row.tokenProgram)))throw new Error('Invalid public token lock intent.')
 const addresses=lockAddresses(input,row.nonce),fees=supplyLockFees(input.amountRaw,row.feeUnits)
 if(row.metadata!==addresses.metadata||row.escrow!==addresses.escrow||row.tokenFeeRaw!==fees.tokenFeeRaw||row.sourceDebitRaw!==fees.sourceDebitRaw)throw new Error('The public lock identity or fee amounts changed.')
 return{...input,...addresses,...fees,tokenProgram:String(row.tokenProgram),decimals:row.decimals,nonce:row.nonce,feeUnits:row.feeUnits,creationFeeLamports:creatorAmount(row.creationFeeLamports),maxDebitLamports:creatorAmount(row.maxDebitLamports)}
}
