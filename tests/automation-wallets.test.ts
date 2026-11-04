import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {Keypair} from '@solana/web3.js'
import {parseAutomationPlan} from '../src/lib/automationWallets/model'
import {AutomationStore} from '../src/lib/server/automationWallets/store'

const dirs:string[]=[]
const stores:AutomationStore[]=[]
afterEach(()=>{for(const s of stores.splice(0))try{s.close()}catch{};for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
const now=1_800_000_000_000
const plan=()=>({version:1,mode:'dca',mint:Keypair.generate().publicKey.toBase58(),action:'buy',buySol:'0.01',sellAmountRaw:'0',intervalSeconds:60,startAt:now+1000,expiresAt:now+600_000,maxTrades:2,maxDebitPerTradeSol:'0.025',maxTotalDebitSol:'0.05',minReserveSol:'0.005',slippage:5,priorityFeeSol:0.0001})
function store(){const dir=mkdtempSync(join(tmpdir(),'launchpier-auto-'));dirs.push(dir);const s=new AutomationStore(join(dir,'wallets.sqlite'),randomBytes(32));stores.push(s);return {store:s,dir}}
function backed(s:AutomationStore){const a=s.createWallet(now);s.backup(a.capability,true);return a}
describe('dedicated automation wallet ownership and budgets',()=>{
 it('rejects excessive or mutable policy authority',()=>{
  expect(()=>parseAutomationPlan({...plan(),destination:Keypair.generate().publicKey.toBase58()},now)).toThrow()
  expect(()=>parseAutomationPlan({...plan(),maxTotalDebitSol:'1.000000001'},now)).toThrow()
  expect(()=>parseAutomationPlan({...plan(),slippage:11},now)).toThrow()
  expect(()=>parseAutomationPlan({...plan(),expiresAt:now+86_400_001},now)).toThrow()
  expect(()=>parseAutomationPlan({...plan(),maxDebitPerTradeSol:'0.01'},now)).toThrow()
 })
 it('encrypts new separate keys and persists only a hash of the owner capability',()=>{
  const {store:s,dir}=store(),created=s.createWallet(now)
  const key=s.backup(created.capability,true)
  expect(Keypair.fromSecretKey(Uint8Array.from(key)).publicKey.toBase58()).toBe(created.wallet.address)
  expect(()=>s.backup(created.capability,false)).toThrow()
  expect(()=>s.read(randomBytes(32).toString('base64url'))).toThrow()
  s.close()
  const bytes=readFileSync(join(dir,'wallets.sqlite'))
  expect(bytes.includes(created.capability)).toBe(false)
  expect(bytes.includes(Buffer.from(key))).toBe(false)
 })
 it('requires the exact reviewed hash, prevents duplicate arm and enforces owner isolation',()=>{
  const {store:s}=store(),a=backed(s),b=backed(s),p=parseAutomationPlan(plan(),now),review=s.review(a.capability,p,now)
  expect(()=>s.arm(a.capability,'0'.repeat(64),now)).toThrow()
  expect(()=>s.arm(b.capability,review.hash,now)).toThrow()
  s.arm(a.capability,review.hash,now)
  expect(()=>s.arm(a.capability,review.hash,now)).toThrow()
  expect(s.read(b.capability).policy).toBeNull();s.close()
 })
 it('claims once, persists a unique original signature before submission and never leases fresh work while pending',()=>{
  const {store:s}=store(),a=backed(s),p=parseAutomationPlan(plan(),now),r=s.review(a.capability,p,now);s.arm(a.capability,r.hash,now)
  const lease=s.claim(now+1000)!;expect(lease).toBeTruthy();expect(s.claim(now+1001)).toBeNull()
  s.recordPending(lease,'original-signature','encoded-packet','10005000',now+1002)
  expect(s.read(a.capability).history[0]).toMatchObject({signature:'original-signature',status:'pending',reservedDebitLamports:'25000000'})
  expect(s.claim(now+500_000)).toBeNull()
  expect(()=>s.recordPending(lease,'second-signature','other','10005000',now+1003)).toThrow()
  s.close()
 })
 it('recovers a pre-submit crash without resubmitting pending, and counts failed transaction fees against the budget',()=>{
  const {store:s}=store(),a=backed(s),p=parseAutomationPlan(plan(),now),r=s.review(a.capability,p,now);s.arm(a.capability,r.hash,now)
  const lease=s.claim(now+1000)!;s.recordPending(lease,'saved-signature','packet','10005000',now+1001)
  expect(s.pending()[0].signature).toBe('saved-signature')
  s.resolvePending('saved-signature','failed',now+2000)
  expect(s.read(a.capability).policy).toMatchObject({status:'blocked',attempts:1,reservedDebitLamports:'25000000'})
  expect(s.claim(now+200_000)).toBeNull();s.close()
 })
 it('cancellation and expiry fence held leases before any original signature can be stored',()=>{
  for(const cancel of [true,false]){
   const {store:s}=store(),a=backed(s),p=parseAutomationPlan(plan(),now),r=s.review(a.capability,p,now);s.arm(a.capability,r.hash,now)
   const lease=s.claim(now+1000)!;if(cancel)s.cancel(a.capability,now+1001)
   expect(()=>s.recordPending(lease,'original','packet','10005000',cancel?now+1002:p.expiresAt)).toThrow()
   expect(s.pending()).toHaveLength(0);s.close()
  }
 })
 it('a restart can reclaim only an expired preparation lease, never a recorded attempt',()=>{
  const {store:s}=store(),a=backed(s),p=parseAutomationPlan(plan(),now),r=s.review(a.capability,p,now);s.arm(a.capability,r.hash,now)
  const first=s.claim(now+1000)!,second=s.claim(now+181_001)!
  expect(second.token).not.toBe(first.token)
  expect(()=>s.recordPending(first,'stale','packet','1',now+181_002)).toThrow()
  s.recordPending(second,'current','packet','1',now+181_002)
  expect(s.claim(now+400_000)).toBeNull();s.close()
 })
})
