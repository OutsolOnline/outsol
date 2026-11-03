import type {TokenBalanceChange} from '../market/types'
import {canonicalAddress,canonicalSignature} from '../market/validation'
export const ACCOUNTING_LEDGER_KEY='outsol-confirmed-accounting-observations-v1'
export interface AccountingObservation {checkedAt:string;change:TokenBalanceChange}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const unsigned=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n
const signed=(value:unknown):value is string=>typeof value==='string'&&/^-?(0|[1-9]\d{0,29})$/.test(value)
const time=(value:unknown)=>{if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw new Error('Invalid accounting observation date.');return new Date(value).toISOString()}
function change(input:TokenBalanceChange):TokenBalanceChange{
 if(!input||!canonicalAddress(input.mint)||!canonicalAddress(input.wallet)||!canonicalSignature(input.signature)||!Number.isSafeInteger(input.slot)||input.slot<0||!Number.isSafeInteger(input.timestamp)||input.timestamp<0||!Number.isInteger(input.decimals)||input.decimals<0||input.decimals>18||!['buy','sell','transfer','mixed'].includes(input.kind)||![input.tokenBeforeRaw,input.tokenAfterRaw,input.networkFeeLamports].every(unsigned)||![input.tokenDeltaRaw,input.wrappedSolDeltaLamports].every(signed)||input.nativeDeltaLamports!==null&&!signed(input.nativeDeltaLamports)||input.accountReserveDeltaLamports!==null&&!signed(input.accountReserveDeltaLamports)||input.tradeCashflowLamports!==null&&!signed(input.tradeCashflowLamports)||typeof input.basisEligible!=='boolean')throw new Error('The public accounting observation is invalid.')
 if(BigInt(input.tokenAfterRaw)-BigInt(input.tokenBeforeRaw)!==BigInt(input.tokenDeltaRaw))throw new Error('The observed token balance change is inconsistent.')
 if(input.basisEligible&&(input.tradeCashflowLamports===null||input.kind==='transfer'||input.kind==='mixed'||input.kind==='buy'&&(BigInt(input.tokenDeltaRaw)<=0n||BigInt(input.tradeCashflowLamports)>=0n)||input.kind==='sell'&&(BigInt(input.tokenDeltaRaw)>=0n||BigInt(input.tradeCashflowLamports)<=0n)))throw new Error('Acquisition basis must come from an isolated, reconciled trade.')
 if(!input.basisEligible&&input.tradeCashflowLamports!==null)throw new Error('Unverified acquisition basis must remain unknown.')
 if(input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>500))throw new Error('The accounting explanation is invalid.')
 return {mint:input.mint,wallet:input.wallet,signature:input.signature,slot:input.slot,timestamp:input.timestamp,decimals:input.decimals,kind:input.kind,tokenBeforeRaw:input.tokenBeforeRaw,tokenAfterRaw:input.tokenAfterRaw,tokenDeltaRaw:input.tokenDeltaRaw,nativeDeltaLamports:input.nativeDeltaLamports,wrappedSolDeltaLamports:input.wrappedSolDeltaLamports,networkFeeLamports:input.networkFeeLamports,accountReserveDeltaLamports:input.accountReserveDeltaLamports,tradeCashflowLamports:input.tradeCashflowLamports,basisEligible:input.basisEligible,...(input.reason?{reason:input.reason}:{})}
}
const identity=(row:TokenBalanceChange)=>`${row.mint}:${row.signature}:${row.wallet}`
export function readAccountingLedger(storage:Storage=localStorage):AccountingObservation[]{
 try{const raw=storage.getItem(ACCOUNTING_LEDGER_KEY);if(raw===null)return [];if(raw.length>2_000_000)throw new Error();const value=JSON.parse(raw);if(value?.version!==1||!Array.isArray(value.observations)||value.observations.length>2000)throw new Error();const rows:AccountingObservation[]=value.observations.map((row:AccountingObservation)=>({checkedAt:time(row.checkedAt),change:change(row.change)}));if(new Set(rows.map(row=>identity(row.change))).size!==rows.length)throw new Error();return rows}catch{throw new Error('Saved accounting observations cannot be read. Preserve browser data before changing this ledger.')}
}
/** Caller coordinates writes with the public ledger Web Lock. These are saved
 * historical observations; they do not prove a current wallet balance. */
export function appendAccountingEvidence(mint:string,input:TokenBalanceChange[],checkedAt:string,storage:Storage=localStorage):AccountingObservation[]{
 if(!canonicalAddress(mint)||!Array.isArray(input)||input.length>4096)throw new Error('Invalid confirmed receipt evidence.')
 const date=time(checkedAt),incoming=input.map(change)
 if(incoming.some(row=>row.mint!==mint))throw new Error('Receipt evidence belongs to a different mint.')
 const before=storage.getItem(ACCOUNTING_LEDGER_KEY),existing=readAccountingLedger(storage),merged=new Map(existing.map(row=>[identity(row.change),row]))
 for(const row of incoming){const key=identity(row),previous=merged.get(key);if(previous&&JSON.stringify(previous.change)!==JSON.stringify(row))throw new Error('Confirmed receipt evidence conflicts with a saved observation. Preserve the original ledger and inspect the signature.');merged.set(key,{checkedAt:previous&&Date.parse(previous.checkedAt)>Date.parse(date)?previous.checkedAt:date,change:row})}
 const rows=[...merged.values()].sort((a,b)=>a.change.slot-b.change.slot||a.change.signature.localeCompare(b.change.signature)||a.change.wallet.localeCompare(b.change.wallet)),raw=JSON.stringify({version:1,observations:rows})
 if(rows.length>2000||raw.length>2_000_000)throw new Error('The accounting ledger is full. Export evidence before adding more observations.')
 if(storage.getItem(ACCOUNTING_LEDGER_KEY)!==before)throw new Error('Accounting evidence changed in another tab. Refresh before saving more observations.')
 storage.setItem(ACCOUNTING_LEDGER_KEY,raw);if(storage.getItem(ACCOUNTING_LEDGER_KEY)!==raw)throw new Error('Accounting observations could not be saved. Check browser storage.')
 return rows
}
export async function storeAccountingEvidence(mint:string,rows:TokenBalanceChange[],checkedAt:string):Promise<AccountingObservation[]>{
 if(!navigator.locks)throw new Error('Use a current browser with secure cross-tab storage coordination.')
 return navigator.locks.request('outsol-accounting-ledger-write',{ifAvailable:true},lock=>{if(!lock)throw new Error('Another tab is updating accounting observations. Try again shortly.');return appendAccountingEvidence(mint,rows,checkedAt)})
}
