import {createCipheriv,createDecipheriv,createHash,generateKeyPairSync,randomBytes,timingSafeEqual} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {chmodSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {PublicKey,type VersionedTransaction} from '@solana/web3.js'
import {AutomationError,CAPABILITY_PATTERN,solLamports,type AutomationPlan,type AutomationPolicy,type AutomationWalletView,type AutomationHistory} from '../../automationWallets/model'

type Row=Record<string,string|number|null>
export interface AutomationLease {walletId:string;address:string;policyId:string;token:string;plan:AutomationPlan}
export interface PendingAttempt {walletId:string;policyId:string;signature:string;createdAt:number}
const LEASE_MS=180_000
export class AutomationStore {
 private readonly db:DatabaseSync
 constructor(path:string,private readonly encryptionKey:Buffer,private readonly walletLimit=100){
  if(encryptionKey.length!==32)throw new Error('Automation encryption key must be 32 bytes')
  mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path)
  chmodSync(path,0o600);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')
  this.db.exec(`CREATE TABLE IF NOT EXISTS wallets(id TEXT PRIMARY KEY,address TEXT NOT NULL UNIQUE,owner_hash TEXT NOT NULL UNIQUE,ciphertext TEXT NOT NULL,created_at INTEGER NOT NULL,backup_ack INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS policies(id TEXT PRIMARY KEY,wallet_id TEXT NOT NULL REFERENCES wallets(id),hash TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,reserved TEXT NOT NULL DEFAULT '0',next_run INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER,message TEXT NOT NULL DEFAULT '');
   CREATE UNIQUE INDEX IF NOT EXISTS one_live_policy ON policies(wallet_id) WHERE status IN ('review','armed');
   CREATE TABLE IF NOT EXISTS attempts(signature TEXT PRIMARY KEY,wallet_id TEXT NOT NULL REFERENCES wallets(id),policy_id TEXT NOT NULL REFERENCES policies(id),packet TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER,reserved TEXT NOT NULL,simulated_debit TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS one_pending_wallet ON attempts(wallet_id) WHERE status='pending';`)
 }
 close(){this.db.close()}
 private atomic<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value}catch(error){this.db.exec('ROLLBACK');throw error}}
 private owner(capability:string):Row {
  if(!CAPABILITY_PATTERN.test(capability)||Buffer.from(capability,'base64url').toString('base64url')!==capability)throw new AutomationError(404,'Restore the private automation recovery receipt.')
  const hash=createHash('sha256').update(capability).digest('hex'),row=this.db.prepare('SELECT * FROM wallets WHERE owner_hash=?').get(hash) as Row|undefined
  if(!row||!timingSafeEqual(Buffer.from(String(row.owner_hash),'hex'),Buffer.from(hash,'hex')))throw new AutomationError(404,'Restore the private automation recovery receipt.')
  return row
 }
 private encrypt(secret:Uint8Array,aad:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.encryptionKey,iv);cipher.setAAD(Buffer.from(aad));const bytes=Buffer.concat([cipher.update(secret),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64')}
 private decrypted<T>(row:Row,consume:(secret:Buffer)=>T):T {const data=Buffer.from(String(row.ciphertext),'base64'),decipher=createDecipheriv('aes-256-gcm',this.encryptionKey,data.subarray(0,12));decipher.setAAD(Buffer.from(`${row.id}:${row.address}`));decipher.setAuthTag(data.subarray(12,28));const first=decipher.update(data.subarray(28));let tail:Buffer|undefined,secret:Buffer|undefined;try{tail=decipher.final();secret=Buffer.concat([first,tail]);if(secret.length!==64||new PublicKey(secret.subarray(32)).toBase58()!==row.address)throw new Error('Key identity mismatch');return consume(secret)}finally{first.fill(0);tail?.fill(0);secret?.fill(0)}}
 createWallet(now=Date.now()):{wallet:AutomationWalletView;capability:string}{return this.atomic(()=>{
  const count=this.db.prepare('SELECT COUNT(*) AS n FROM wallets').get() as Row
  if(Number(count.n)>=this.walletLimit)throw new AutomationError(429,'The server wallet limit has been reached.')
  const pair=generateKeyPairSync('ed25519'),privateDer=pair.privateKey.export({type:'pkcs8',format:'der'}),publicDer=pair.publicKey.export({type:'spki',format:'der'}),secret=Buffer.concat([privateDer.subarray(-32),publicDer.subarray(-32)]),id=randomBytes(16).toString('hex'),address=new PublicKey(publicDer.subarray(-32)).toBase58(),capability=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(capability).digest('hex')
  try{this.db.prepare('INSERT INTO wallets(id,address,owner_hash,ciphertext,created_at) VALUES(?,?,?,?,?)').run(id,address,hash,this.encrypt(secret,`${id}:${address}`),now)}finally{secret.fill(0);privateDer.fill(0)}
  return {wallet:this.read(capability),capability}
 })}
 read(capability:string):AutomationWalletView {const row=this.owner(capability),p=this.db.prepare('SELECT * FROM policies WHERE wallet_id=? ORDER BY rowid DESC LIMIT 1').get(row.id) as Row|undefined
  const history=(this.db.prepare('SELECT signature,status,created_at,resolved_at,reserved,simulated_debit,policy_id FROM attempts WHERE wallet_id=? ORDER BY created_at DESC LIMIT 100').all(row.id) as Row[]).map(a=>({signature:String(a.signature),status:a.status as AutomationHistory['status'],createdAt:Number(a.created_at),resolvedAt:a.resolved_at===null?null:Number(a.resolved_at),reservedDebitLamports:String(a.reserved),simulatedDebitLamports:String(a.simulated_debit),policyId:String(a.policy_id)}))
  return {id:String(row.id),address:String(row.address),createdAt:Number(row.created_at),backupAcknowledged:row.backup_ack===1,policy:p?this.policy(p):null,history}
 }
 private policy(p:Row):AutomationPolicy{return {id:String(p.id),hash:String(p.hash),plan:JSON.parse(String(p.plan)),status:p.status as AutomationPolicy['status'],attempts:Number(p.attempts),reservedDebitLamports:String(p.reserved),nextRunAt:Number(p.next_run),message:String(p.message)}}
 backup(capability:string,consent:boolean):number[]{if(consent!==true)throw new AutomationError(400,'Explicitly consent before downloading the dedicated wallet private key.');return this.atomic(()=>{const row=this.owner(capability);return this.decrypted(row,secret=>{this.db.prepare('UPDATE wallets SET backup_ack=1 WHERE id=?').run(row.id);return Array.from(secret)})})}
 review(capability:string,plan:AutomationPlan,now=Date.now()):{hash:string;policy:AutomationPolicy}{return this.atomic(()=>{
  const row=this.owner(capability)
  if(Number((this.db.prepare('SELECT COUNT(*) AS n FROM policies').get() as Row).n)>=10_000)throw new AutomationError(429,'The server automation history limit has been reached.')
  if(row.backup_ack!==1)throw new AutomationError(409,'Download and keep the dedicated wallet keypair backup before reviewing a plan.')
  if(this.db.prepare("SELECT 1 FROM policies WHERE wallet_id=? AND status='armed'").get(row.id)||this.db.prepare("SELECT 1 FROM attempts WHERE wallet_id=? AND status='pending'").get(row.id))throw new AutomationError(409,'Cancel the current plan and resolve any original pending signature first.')
  this.db.prepare("UPDATE policies SET status='cancelled' WHERE wallet_id=? AND status='review'").run(row.id)
  const id=randomBytes(16).toString('hex'),canonical=JSON.stringify(plan),hash=createHash('sha256').update(`${row.id}:${id}:${canonical}`).digest('hex')
  this.db.prepare("INSERT INTO policies(id,wallet_id,hash,plan,status,next_run) VALUES(?,?,?,?,'review',?)").run(id,row.id,hash,canonical,plan.startAt)
  return {hash,policy:this.read(capability).policy!}
 })}
 arm(capability:string,hash:string,now=Date.now()):AutomationWalletView{return this.atomic(()=>{const row=this.owner(capability),p=this.db.prepare("SELECT * FROM policies WHERE wallet_id=? AND status='review'").get(row.id) as Row|undefined
  if(!p||typeof hash!=='string'||hash!==p.hash)throw new AutomationError(409,'Review the exact plan again before arming it.')
  const plan=JSON.parse(String(p.plan)) as AutomationPlan
  if(now>=plan.startAt||now>=plan.expiresAt)throw new AutomationError(409,'The reviewed start time passed. Review a fresh schedule.')
  if(this.db.prepare("SELECT 1 FROM attempts WHERE wallet_id=? AND status='pending'").get(row.id))throw new AutomationError(409,'An original pending signature must be resolved first.')
  this.db.prepare("UPDATE policies SET status='armed',message='Explicitly approved; waiting for the scheduled time.' WHERE id=? AND status='review'").run(p.id);return this.read(capability)
 })}
 cancel(capability:string,now=Date.now()):AutomationWalletView {return this.atomic(()=>{const row=this.owner(capability);this.db.prepare("UPDATE policies SET status='cancelled',lease_token=NULL,lease_until=NULL,message='Cancelled. Any recorded original signature may still land; it will only be checked, never resubmitted.' WHERE wallet_id=? AND status IN ('armed','review')").run(row.id);return this.read(capability)})}
 claim(now=Date.now()):AutomationLease|null {return this.atomic(()=>{
  this.db.prepare("UPDATE policies SET status='expired',lease_token=NULL,lease_until=NULL,message='The approved schedule expired. Original pending signatures remain read only.' WHERE status='armed' AND json_extract(plan,'$.expiresAt')<=?").run(now)
  for(const p of this.db.prepare("SELECT p.*,w.address FROM policies p JOIN wallets w ON w.id=p.wallet_id WHERE p.status='armed' AND p.next_run<=? AND (p.lease_until IS NULL OR p.lease_until<=?) AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.wallet_id=p.wallet_id AND a.status='pending') ORDER BY p.next_run LIMIT 100").all(now,now) as Row[]){
   const plan=JSON.parse(String(p.plan)) as AutomationPlan
   if(now>=plan.expiresAt){this.db.prepare("UPDATE policies SET status='expired',message='The approved schedule expired.' WHERE id=?").run(p.id);continue}
   if(Number(p.attempts)>=plan.maxTrades||BigInt(String(p.reserved))+solLamports(plan.maxDebitPerTradeSol)>solLamports(plan.maxTotalDebitSol)){this.db.prepare("UPDATE policies SET status='completed',message='The approved trade count or debit budget is complete.' WHERE id=?").run(p.id);continue}
   const token=randomBytes(16).toString('hex');this.db.prepare('UPDATE policies SET lease_token=?,lease_until=? WHERE id=?').run(token,now+LEASE_MS,p.id)
   return {walletId:String(p.wallet_id),address:String(p.address),policyId:String(p.id),token,plan}
  }return null
 })}
 guard(lease:AutomationLease,now=Date.now()):void {const p=this.db.prepare('SELECT * FROM policies WHERE id=? AND wallet_id=?').get(lease.policyId,lease.walletId) as Row|undefined
  if(!p||p.status!=='armed'||p.lease_token!==lease.token||Number(p.lease_until)<=now||now>=lease.plan.expiresAt||this.db.prepare("SELECT 1 FROM attempts WHERE wallet_id=? AND status='pending'").get(lease.walletId))throw new AutomationError(409,'The schedule was cancelled, expired, leased elsewhere, or already has a pending signature.')
 }
 /** Keep the actual decrypted backing buffer synchronous and erase it before any RPC await. */
 sign(lease:AutomationLease,transaction:VersionedTransaction,now=Date.now()):void {this.guard(lease,now);const row=this.db.prepare('SELECT * FROM wallets WHERE id=?').get(lease.walletId) as Row;this.decrypted(row,secret=>transaction.sign([{publicKey:new PublicKey(String(row.address)),secretKey:secret}]))}
 recordPending(lease:AutomationLease,signature:string,packet:string,simulatedDebit:string,now=Date.now()):void {this.atomic(()=>{
  this.guard(lease,now);const p=this.db.prepare('SELECT * FROM policies WHERE id=?').get(lease.policyId) as Row,per=solLamports(lease.plan.maxDebitPerTradeSol),reserved=BigInt(String(p.reserved))+per
  if(!/^[0-9]+$/.test(simulatedDebit)||BigInt(simulatedDebit)>per||reserved>solLamports(lease.plan.maxTotalDebitSol)||Number(p.attempts)>=lease.plan.maxTrades)throw new AutomationError(409,'The approved total debit or trade count is exhausted.')
  this.db.prepare("INSERT INTO attempts(signature,wallet_id,policy_id,packet,status,created_at,reserved,simulated_debit) VALUES(?,?,?,?,'pending',?,?,?)").run(signature,lease.walletId,lease.policyId,packet,now,per.toString(),simulatedDebit)
  this.db.prepare("UPDATE policies SET attempts=attempts+1,reserved=?,lease_token=NULL,lease_until=NULL,message='Original signature recorded. No replacement transaction will be submitted.' WHERE id=?").run(reserved.toString(),lease.policyId)
 })}
 pending():PendingAttempt[]{return (this.db.prepare("SELECT wallet_id,policy_id,signature,created_at FROM attempts WHERE status='pending' ORDER BY created_at LIMIT 100").all() as Row[]).map(p=>({walletId:String(p.wallet_id),policyId:String(p.policy_id),signature:String(p.signature),createdAt:Number(p.created_at)}))}
 resolvePending(signature:string,outcome:'confirmed'|'failed',now=Date.now()):void {this.atomic(()=>{const a=this.db.prepare("SELECT * FROM attempts WHERE signature=? AND status='pending'").get(signature) as Row|undefined;if(!a)return
  this.db.prepare('UPDATE attempts SET status=?,resolved_at=?,packet=\'\' WHERE signature=?').run(outcome,now,signature)
  const p=this.db.prepare('SELECT * FROM policies WHERE id=?').get(a.policy_id) as Row,plan=JSON.parse(String(p.plan)) as AutomationPlan
  if(p.status!=='armed')return
  const status=outcome==='failed'?'blocked':now>=plan.expiresAt?'expired':Number(p.attempts)>=plan.maxTrades?'completed':'armed'
  this.db.prepare('UPDATE policies SET status=?,next_run=?,message=? WHERE id=?').run(status,now+plan.intervalSeconds*1000,outcome==='failed'?'An on-chain failure stopped this plan. The full attempt ceiling stays counted, including fees.':status==='completed'?'All approved scheduled trades confirmed.':'Original transaction confirmed. Waiting for the next interval.',p.id)
 })}
 block(lease:AutomationLease,message:string):void {this.db.prepare("UPDATE policies SET status='blocked',lease_token=NULL,lease_until=NULL,message=? WHERE id=? AND status='armed' AND lease_token=?").run(message,lease.policyId,lease.token)}
}
