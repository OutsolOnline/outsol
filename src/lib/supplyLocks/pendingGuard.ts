interface SupplyLockReadStorage {getItem(key:string):string|null}
/** Keep the shared spending boundary independent of the Streamflow SDK.
 * The lock workspace's strict parser and signature recovery are authoritative. */
export function assertNoUnresolvedSupplyLock(storage?:SupplyLockReadStorage):void{
 if(!storage&&typeof window==='undefined')return
 const disk=storage??localStorage
 let row:unknown
 try{
  const raw=disk.getItem('outsol-supply-lock-pending-v1');if(raw===null)return
  if(raw.length>10000)throw new Error();row=JSON.parse(raw)
  if(!row||typeof row!=='object'||Array.isArray(row)||!('version'in row)||row.version!==1||!('intent'in row)||!row.intent||typeof row.intent!=='object'||Array.isArray(row.intent)||!('signature'in row)||typeof row.signature!=='string'||!('lastValidBlockHeight'in row)||typeof row.lastValidBlockHeight!=='number'||!Number.isSafeInteger(row.lastValidBlockHeight)||row.lastValidBlockHeight<1)throw new Error()
 }catch{throw new Error('Supply lock recovery cannot be read. Preserve browser data and check the original signature before spending.')}
 throw new Error('A supply lock is pending confirmation. Check its original signature in the token workspace before spending.')
}
