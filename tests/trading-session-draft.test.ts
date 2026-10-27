import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {DEFAULT_SESSION_FORM,SESSION_DRAFT_KEY,clearSessionDraft,readSessionDraft,restoreSessionDraft,saveSessionDraft,sessionConfigFromForm,sessionFormIssues,sessionModeUrl} from '../src/lib/tradingSessions/draft'

const mint=Keypair.generate().publicKey.toBase58()
const payer=Keypair.generate().publicKey.toBase58()
function memory(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
const draft=()=>({form:{...DEFAULT_SESSION_FORM,mint},walletId:'wallet-one'})

describe('public session configuration draft',()=>{
 it('round trips incomplete public settings without persisting approval, keys or execution state',()=>{
  const storage=memory()
  saveSessionDraft({...draft(),approved:true,running:true,privateKey:'private',signedPacket:'packet',form:{...draft().form,buySol:'',durationSeconds:'1.',secretKey:'secret'}} as never,storage)
  expect(readSessionDraft(storage)).toEqual({version:1,form:{...draft().form,buySol:'',durationSeconds:'1.'},walletId:'wallet-one'})
  expect(storage.getItem(SESSION_DRAFT_KEY)).not.toMatch(/approved|running|private|signedPacket|packet|secret/)
 })
 it('restores a saved mode unless a valid mode was explicitly requested',()=>{
  const saved={version:1 as const,...draft(),form:{...draft().form,mode:'new-launch' as const,keyword:'orbit'}}
  expect(restoreSessionDraft(saved).form.mode).toBe('new-launch')
  expect(restoreSessionDraft(saved,'cap').form.mode).toBe('cap')
  expect(restoreSessionDraft(saved,'dca').form.mode).toBe('dca')
  expect(restoreSessionDraft(saved,'unknown').form.mode).toBe('new-launch')
  expect(restoreSessionDraft(null,'new-launch')).toEqual({form:{...DEFAULT_SESSION_FORM,mode:'new-launch'},walletId:''})
  expect(restoreSessionDraft(saved)).not.toHaveProperty('approved')
 })
 it('replaces the old mode query so a mode-card choice survives refresh while other URL state remains',()=>{
  const href=sessionModeUrl('https://outsol.app/automations?mode=cap&from=discover#session-approval','dca')
  expect(href).toBe('/automations?mode=dca&from=discover#session-approval')
  const selectedMode=new URL(href,'https://outsol.app').searchParams.get('mode')
  expect(restoreSessionDraft({version:1,...draft(),form:{...draft().form,mode:'cap'}},selectedMode).form.mode).toBe('dca')
  expect(sessionModeUrl('https://outsol.app/automations?mode=cap&mode=dca','new-launch')).toBe('/automations?mode=new-launch')
 })
 it.each(['not-json',JSON.stringify({version:2,...draft()}),JSON.stringify({version:1,...draft(),form:{...draft().form,mode:'forever'}}),'x'.repeat(8001)])('preserves unreadable existing data until the user resets it',raw=>{
  const storage=memory();storage.setItem(SESSION_DRAFT_KEY,raw)
  expect(()=>readSessionDraft(storage)).toThrow(/saved.*setup|draft/i)
  expect(()=>saveSessionDraft(draft(),storage)).toThrow(/saved.*setup|draft/i)
  expect(storage.getItem(SESSION_DRAFT_KEY)).toBe(raw)
 })
 it('projects stored records through the public allowlist and bounds every field',()=>{
  const storage=memory();storage.setItem(SESSION_DRAFT_KEY,JSON.stringify({version:1,...draft(),approved:true,form:{...draft().form,privateKey:'secret'}}))
  expect(readSessionDraft(storage)).toEqual({version:1,...draft()})
  for(const patch of [{keyword:'x'.repeat(81)},{mint:'x'.repeat(45)},{buySol:'x'.repeat(25)},{slippage:5},{action:'transfer'}]){
   expect(()=>saveSessionDraft({...draft(),form:{...draft().form,...patch}} as never,storage)).toThrow()
  }
 })
 it('reports unavailable and unverified storage writes, and resets only this public draft',()=>{
  const storage=memory();saveSessionDraft(draft(),storage);storage.setItem('vanity-trade-pending','original-signature')
  clearSessionDraft(storage)
  expect(readSessionDraft(storage)).toBeNull()
  expect(storage.getItem('vanity-trade-pending')).toBe('original-signature')
  expect(()=>saveSessionDraft(draft(),{getItem:()=>null,setItem:()=>{},removeItem:()=>{}})).toThrow(/save|storage/i)
  expect(()=>readSessionDraft({getItem:()=>{throw new Error('Denied')},setItem:()=>{},removeItem:()=>{}})).toThrow(/saved.*setup|storage/i)
  expect(()=>clearSessionDraft({getItem:()=>'{still saved}',setItem:()=>{},removeItem:()=>{}})).toThrow(/reset|storage/i)
 })
})

describe('session form feedback before approval',()=>{
 it('requires the real 20-second launch-watch floor while scheduled and cap sessions keep five seconds',()=>{
  const launch={...draft().form,mode:'new-launch' as const,keyword:'orbit',intervalSeconds:'5'}
  expect(sessionFormIssues(launch)).toMatchObject({intervalSeconds:expect.stringMatching(/20.*300/)})
  expect(()=>sessionConfigFromForm(launch,'wallet-one',payer)).toThrow(/20.*300/)
  expect(sessionFormIssues({...launch,intervalSeconds:'20'})).not.toHaveProperty('intervalSeconds')
  expect(sessionConfigFromForm({...launch,intervalSeconds:'20'},'wallet-one',payer).intervalMs).toBe(20000)
  expect(sessionFormIssues({...launch,mode:'dca'})).not.toHaveProperty('intervalSeconds')
  expect(sessionFormIssues({...launch,mode:'cap'})).not.toHaveProperty('intervalSeconds')
 })
 it('returns actionable field issues before a wallet or approval is available',()=>{
  expect(sessionFormIssues({...DEFAULT_SESSION_FORM})).toMatchObject({mint:expect.stringMatching(/mint/i)})
  expect(sessionFormIssues({...draft().form,buySol:'1e-3',maxTrades:'1.5',intervalSeconds:'4',durationSeconds:'301',slippage:'',priorityFeeSol:''})).toMatchObject({buySol:expect.stringMatching(/decimal|SOL/i),maxTrades:expect.any(String),intervalSeconds:expect.any(String),durationSeconds:expect.any(String),slippage:expect.any(String),priorityFeeSol:expect.any(String)})
  expect(sessionFormIssues({...draft().form,buySol:'0.2',maxDebitSol:'0.1'})).toHaveProperty('maxDebitSol')
  expect(sessionFormIssues(draft().form)).toEqual({})
 })
 it('validates active launch and cap rules, including exact integer seconds and SOL precision',()=>{
  expect(sessionFormIssues({...draft().form,mode:'new-launch',keyword:'ab'})).toHaveProperty('keyword')
  expect(sessionFormIssues({...draft().form,mode:'new-launch',creator:'invalid',keyword:'orbit'})).toHaveProperty('creator')
  expect(sessionFormIssues({...draft().form,mode:'cap',capSol:'0'})).toHaveProperty('capSol')
  expect(sessionFormIssues({...draft().form,intervalSeconds:'5.5',durationSeconds:'1e2',maxDebitSol:'0.1234567891'})).toMatchObject({intervalSeconds:expect.any(String),durationSeconds:expect.any(String),maxDebitSol:expect.any(String)})
  expect(sessionFormIssues({...draft().form,mode:'new-launch',keyword:' orbit ',mint:''})).toEqual({})
 })
 it('builds the same bounded approval config while ignoring inactive inputs',()=>{
  const config=sessionConfigFromForm({...draft().form,mode:'cap',action:'sell',buySol:'',sellPercent:'50',maxTrades:''},'wallet-one',payer)
  expect(config).toMatchObject({version:1,mode:'cap',walletId:'wallet-one',payer,action:'sell',sellPercent:50,maxTrades:1,intervalMs:20000,durationMs:180000,maxDebitSol:'0.1',capSol:'100'})
  expect(sessionFormIssues({...draft().form,mode:'cap',action:'sell',buySol:'',sellPercent:'50',maxTrades:''})).toEqual({})
  expect(sessionConfigFromForm({...draft().form,mode:'new-launch',action:'sell',sellPercent:'',keyword:'orbit'},'wallet-one',payer)).toMatchObject({action:'buy',sellPercent:25,keyword:'orbit'})
  expect(()=>sessionConfigFromForm({...draft().form,slippage:''},'wallet-one',payer)).toThrow(/slippage/i)
 })
})
