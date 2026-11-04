import {createHash,randomBytes,timingSafeEqual} from 'node:crypto'
import {chmodSync,existsSync,lstatSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {BackgroundJobRateLimitError,emptyCoverage,LEASE_MS,parseJobInput,validCapability,validatePage} from './model'
import type {Coverage,HistoryJobInput,HistoryReceipt,JobLease,JobState,JobSummary,SignatureEntry} from './model'

type Row={id:string;capability_hash:string;request:string;state:JobState;created_at:number;updated_at:number;expires_at:number;page:string;page_index:number;before_sig:string|null;scanned:number;coverage:string;rpc_exhausted:number;decimals:number|null;lease_token:string|null;lease_until:number;attempts:number;next_run:number;error:string|null}
const RETENTION_MS=7*24*60*60*1000,MAX_RUN_MS=60*60*1000,MAX_ACTIVE=10,MAX_RETAINED=100,MAX_EMPTY_CANCELLED=100,CANCELLATION_GRACE_MS=600_000
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
const authorized=(row:Row|undefined,key:string)=>!!row&&validCapability(key)&&timingSafeEqual(Buffer.from(row.capability_hash,'hex'),Buffer.from(digest(key),'hex'))

/** Fixed-file SQLite queue. Only hashes of independently generated job access keys
 * are persisted. A job access key cannot sign, decrypt or access a wallet. */
export class BackgroundJobStore{
 private db:DatabaseSync
 constructor(path:string,private now:()=>number=Date.now){
  const dir=dirname(path);mkdirSync(dir,{recursive:true,mode:0o700})
  if(lstatSync(dir).isSymbolicLink()||(existsSync(path)&&lstatSync(path).isSymbolicLink()))throw new Error('Background storage must not use symbolic links.')
  this.db=new DatabaseSync(path);chmodSync(path,0o600)
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,capability_hash TEXT NOT NULL,request TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,page TEXT NOT NULL DEFAULT '[]',page_index INTEGER NOT NULL DEFAULT 0,before_sig TEXT,scanned INTEGER NOT NULL DEFAULT 0,coverage TEXT NOT NULL,rpc_exhausted INTEGER NOT NULL DEFAULT 0,decimals INTEGER,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_run INTEGER NOT NULL DEFAULT 0,error TEXT);
   CREATE TABLE IF NOT EXISTS receipts(job_id TEXT NOT NULL,signature TEXT NOT NULL,payload TEXT NOT NULL,ordinal INTEGER NOT NULL,PRIMARY KEY(job_id,signature),FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,next_run,created_at);
   CREATE TABLE IF NOT EXISTS rpc_budget(id INTEGER PRIMARY KEY CHECK(id=1),window_start INTEGER NOT NULL,used INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS creation_budget(scope TEXT PRIMARY KEY,window_start INTEGER NOT NULL,used INTEGER NOT NULL);
   PRAGMA foreign_keys=ON;`)
 }
 close(){this.db.close()}
 private atomic<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value}catch(error){this.db.exec('ROLLBACK');throw error}}
 private row(id:string){return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Row|undefined}
 private summary(row:Row):JobSummary{const input=JSON.parse(row.request) as HistoryJobInput;return{id:row.id,kind:'token-history',mint:input.mint,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at,maxTransactions:input.maxTransactions,scanned:row.scanned,coverage:JSON.parse(row.coverage) as Coverage,rpcAddressExhausted:row.rpc_exhausted===1,fullTokenHistory:false,error:row.error}}
 private active(lease:Pick<JobLease,'id'|'leaseToken'>):Row|null{const row=this.row(lease.id);return row?.state==='running'&&row.lease_token===lease.leaseToken&&row.lease_until>this.now()?row:null}
 private extend(row:Row){this.db.prepare('UPDATE jobs SET updated_at=?,lease_until=? WHERE id=?').run(this.now(),this.now()+LEASE_MS,row.id)}
 create(value:unknown,key:string,client='unknown'):JobSummary{
  const input=parseJobInput(value);if(!validCapability(key))throw new Error('A 256-bit job access key is required.')
  const request=JSON.stringify(input),id=digest(`${key}\0${input.idempotencyKey}`).slice(0,40)
  return this.atomic(()=>{
   // Empty cancellations keep a short recovery/idempotency grace, not a scarce
   // seven-day receipt slot. This also expires tombstones from older deployments.
   this.db.prepare("DELETE FROM jobs WHERE state='cancelled' AND scanned=0 AND updated_at<=?").run(this.now()-CANCELLATION_GRACE_MS)
   const previous=this.row(id);if(previous){if(previous.request!==request)throw new Error('This request identifier was already used with different settings.');return this.summary(previous)}
   this.db.prepare("DELETE FROM jobs WHERE expires_at<? AND state IN ('succeeded','cancelled','failed')").run(this.now())
   const retained=this.db.prepare("SELECT count(*) AS count FROM jobs WHERE NOT(state='cancelled' AND scanned=0)").get() as {count:number},active=this.db.prepare("SELECT count(*) AS count FROM jobs WHERE state IN ('queued','running')").get() as {count:number},total=this.db.prepare('SELECT count(*) AS count FROM jobs').get() as {count:number}
   // Reserve inside the same SQLite transaction as allocation, so independent
   // workers and restarts share the anonymous budget. Never persist client IPs.
   const now=this.now(),budgets=[{scope:'global',window:3_600_000,limit:10},{scope:`client:${digest(client.slice(0,64))}`,window:600_000,limit:3}]
   const reservations=budgets.map(budget=>{const row=this.db.prepare('SELECT window_start,used FROM creation_budget WHERE scope=?').get(budget.scope) as {window_start:number;used:number}|undefined;const current=row&&row.window_start+budget.window>now?row:{window_start:now,used:0};if(current.used>=budget.limit)throw new BackgroundJobRateLimitError(Math.max(1,Math.ceil((current.window_start+budget.window-now)/1000)));return{...budget,...current}})
   if(retained.count>=MAX_RETAINED||active.count>=MAX_ACTIVE||total.count>=MAX_RETAINED+MAX_EMPTY_CANCELLED)throw new Error('The background queue is full. Try again later.')
   this.db.prepare('DELETE FROM creation_budget WHERE window_start<=?').run(now-3_600_000)
   for(const budget of reservations)this.db.prepare('INSERT INTO creation_budget(scope,window_start,used) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET window_start=excluded.window_start,used=excluded.used').run(budget.scope,budget.window_start,budget.used+1)
   this.db.prepare("INSERT INTO jobs(id,capability_hash,request,state,created_at,updated_at,expires_at,coverage) VALUES(?,?,?,'queued',?,?,?,?)").run(id,digest(key),request,this.now(),this.now(),this.now()+RETENTION_MS,JSON.stringify(emptyCoverage()))
   return this.summary(this.row(id)!)
  })
 }
 read(id:string,key:string):JobSummary|null{const row=this.row(id);return authorized(row,key)&&row!.expires_at>this.now()?this.summary(row!):null}
 receipts(id:string,key:string,offset=0,limit=25):HistoryReceipt[]|null{
  if(!this.read(id,key))return null
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>25)throw new Error('Invalid result page.')
  return(this.db.prepare('SELECT payload FROM receipts WHERE job_id=? ORDER BY ordinal LIMIT ? OFFSET ?').all(id,limit,offset) as {payload:string}[]).map(row=>JSON.parse(row.payload) as HistoryReceipt)
 }
 cancel(id:string,key:string):JobSummary|null{return this.atomic(()=>{const row=this.row(id);if(!authorized(row,key)||row!.expires_at<=this.now())return null;if(row!.state==='queued'||row!.state==='running')this.db.prepare("UPDATE jobs SET state='cancelled',updated_at=?,expires_at=?,lease_token=NULL,lease_until=0,error=NULL WHERE id=?").run(this.now(),row!.scanned===0?Math.min(row!.expires_at,this.now()+CANCELLATION_GRACE_MS):row!.expires_at,id);return this.summary(this.row(id)!)})}
 claim(worker:string):JobLease|null{
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(worker))throw new Error('Invalid worker identity.')
  return this.atomic(()=>{
   this.db.prepare("UPDATE jobs SET state='failed',error='The one-hour indexing window expired. Create a new bounded index to continue.',updated_at=?,lease_token=NULL,lease_until=0 WHERE state IN ('queued','running') AND created_at<=?").run(this.now(),this.now()-MAX_RUN_MS)
   const row=this.db.prepare("SELECT * FROM jobs WHERE (state='queued' AND next_run<=?) OR (state='running' AND lease_until<=?) ORDER BY created_at LIMIT 1").get(this.now(),this.now()) as Row|undefined
   if(!row)return null
   const token=randomBytes(24).toString('base64url');this.db.prepare("UPDATE jobs SET state='running',lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(token,this.now()+LEASE_MS,this.now(),row.id)
   return this.current({id:row.id,leaseToken:token})
  })
 }
 current(lease:Pick<JobLease,'id'|'leaseToken'>):JobLease|null{const row=this.active(lease);return row?{...this.summary(row),leaseToken:lease.leaseToken,page:JSON.parse(row.page) as SignatureEntry[],pageIndex:row.page_index,before:row.before_sig,decimals:row.decimals}:null}
 heartbeat(lease:JobLease):boolean{return this.atomic(()=>{const row=this.active(lease);if(!row)return false;this.extend(row);return true})}
 reserveRpcRead():boolean{return this.atomic(()=>{const budget=this.db.prepare('SELECT window_start,used FROM rpc_budget WHERE id=1').get() as {window_start:number;used:number}|undefined;if(!budget||this.now()-budget.window_start>=600_000){this.db.prepare('INSERT INTO rpc_budget(id,window_start,used) VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET window_start=excluded.window_start,used=1').run(this.now());return true}if(budget.used>=600)return false;this.db.prepare('UPDATE rpc_budget SET used=used+1 WHERE id=1').run();return true})}
 defer(lease:JobLease,delayMs=0):boolean{return this.atomic(()=>{const row=this.active(lease);if(!row)return false;this.db.prepare("UPDATE jobs SET state='queued',next_run=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").run(this.now()+Math.min(600_000,Math.max(0,delayMs)),this.now(),row.id);return true})}
 saveMint(lease:JobLease,decimals:number):boolean{
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw new Error('Unsupported token decimals.')
  return this.atomic(()=>{const row=this.active(lease);if(!row)return false;if(row.decimals!==null&&row.decimals!==decimals)throw new Error('Mint details changed.');this.db.prepare('UPDATE jobs SET decimals=? WHERE id=?').run(decimals,row.id);this.extend(row);return true})
 }
 savePage(lease:JobLease,page:SignatureEntry[]):boolean{return this.atomic(()=>{
  const row=this.active(lease);if(!row)return false
  const input=JSON.parse(row.request) as HistoryJobInput;validatePage(page,input.maxTransactions-row.scanned)
  if(JSON.parse(row.page).length)throw new Error('The previous signature page is unfinished.')
  if(page.some(entry=>entry.signature===row.before_sig||this.db.prepare('SELECT 1 FROM receipts WHERE job_id=? AND signature=?').get(row.id,entry.signature)))throw new Error('The RPC history cursor did not advance.')
  if(!page.length){this.db.prepare("UPDATE jobs SET state='succeeded',rpc_exhausted=1,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").run(this.now(),row.id);return true}
  this.db.prepare('UPDATE jobs SET page=?,page_index=0 WHERE id=?').run(JSON.stringify(page),row.id);this.extend(row);return true
 })}
 record(lease:JobLease,receipt:HistoryReceipt):boolean{return this.atomic(()=>{
  const row=this.active(lease);if(!row)return false
  const page=JSON.parse(row.page) as SignatureEntry[],expected=page[row.page_index]
  if(!expected||expected.signature!==receipt.signature)return false
  if(receipt.slot!==expected.slot||receipt.blockTime!==expected.blockTime||!['confirmed','failed','missing','unsupported','invalid'].includes(receipt.status)||!Array.isArray(receipt.trades)||!Array.isArray(receipt.balanceChanges)||receipt.trades.length>16||receipt.balanceChanges.length>32)throw new Error('Invalid history receipt.')
  const payload=JSON.stringify(receipt);if(Buffer.byteLength(payload)>64_000)throw new Error('History receipt is too large.')
  const result=this.db.prepare('INSERT OR IGNORE INTO receipts(job_id,signature,payload,ordinal) VALUES(?,?,?,?)').run(row.id,receipt.signature,payload,row.scanned);if(result.changes!==1)return false
  const coverage=JSON.parse(row.coverage) as Coverage;if(receipt.status==='confirmed')coverage.read++;else coverage[receipt.status]++
  const scanned=row.scanned+1,input=JSON.parse(row.request) as HistoryJobInput,finished=scanned>=input.maxTransactions,pageDone=row.page_index+1>=page.length
  this.db.prepare('UPDATE jobs SET scanned=?,coverage=?,page_index=?,page=?,before_sig=?,state=?,lease_token=?,lease_until=?,updated_at=?,error=NULL,attempts=0 WHERE id=?').run(scanned,JSON.stringify(coverage),pageDone?0:row.page_index+1,pageDone?'[]':row.page,pageDone?page.at(-1)!.signature:row.before_sig,finished?'succeeded':'running',finished?null:row.lease_token,finished?0:this.now()+LEASE_MS,this.now(),row.id)
  return true
 })}
 retry(lease:JobLease):boolean{return this.atomic(()=>{const row=this.active(lease);if(!row)return false;const attempts=row.attempts+1,failed=attempts>=5;this.db.prepare('UPDATE jobs SET state=?,error=?,attempts=?,next_run=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?').run(failed?'failed':'queued',failed?'The RPC could not complete this index after five attempts. Saved receipts remain available.':'The RPC is unavailable. This index will retry automatically.',attempts,this.now()+Math.min(attempts*30_000,120_000),this.now(),row.id);return true})}
 fail(lease:JobLease,message:'invalid-mint'|'unsupported-mint'):boolean{return this.atomic(()=>{const row=this.active(lease);if(!row)return false;this.db.prepare("UPDATE jobs SET state='failed',error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").run(message==='invalid-mint'?'This address is not a supported Solana token mint.':'This token uses an unsupported token program or mint format.',this.now(),row.id);return true})}
}
