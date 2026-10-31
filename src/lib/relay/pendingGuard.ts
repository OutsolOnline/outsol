interface RecoveryStorage {getItem(key:string):string|null}
/** Dependency-free guard for all existing wallet submission paths. Relay's
 * stricter finalized recovery remains authoritative after shared recovery. */
export function assertNoUnresolvedRelay(storage?:RecoveryStorage):void{
 if(!storage&&typeof window==='undefined')return
 const disk=storage??localStorage
 let rows:unknown
 try{
  const raw=disk.getItem('outsol-relay-receipts-v1')
  if(raw===null)return
  if(raw.length>400000)throw new Error()
  rows=JSON.parse(raw)
  if(!Array.isArray(rows)||rows.length>200||rows.some(row=>!row||typeof row!=='object'||!['submitted','unknown','confirmed','failed'].includes(row.status)))throw new Error()
 }catch{throw new Error('Relay recovery cannot be read. Preserve browser data and check original signatures before spending.')}
 if((rows as {status:string}[]).some(row=>row.status==='submitted'||row.status==='unknown'))throw new Error('A Relay transfer remains unconfirmed. Check its original signature in Relay wallets before spending.')
}
