import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {validateSessionConfig,solLamports,sessionModeFromQuery} from '../src/lib/tradingSessions/config'
import {readSessionHistory,saveSessionJournal,SESSION_HISTORY_KEY} from '../src/lib/tradingSessions/history'

const base={version:1 as const,mode:'dca' as const,walletId:'library-wallet',payer:Keypair.generate().publicKey.toBase58(),action:'buy' as const,mint:Keypair.generate().publicKey.toBase58(),buySol:'0.01',sellPercent:25,maxTrades:2,intervalMs:5000,durationMs:60000,maxDebitSol:'0.05',slippage:5,priorityFeeSol:0.0001}
function memory(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
describe('bounded session approval',()=>{
 it('accepts only known initial modes from the discovery link',()=>{
  expect(sessionModeFromQuery('new-launch')).toBe('new-launch');expect(sessionModeFromQuery('cap')).toBe('cap')
  expect(sessionModeFromQuery('anything')).toBe('dca');expect(sessionModeFromQuery(['new-launch','cap'])).toBe('dca')
 })
 it('keeps SOL amounts exact and bounds every repeated execution setting',()=>{
  expect(solLamports('0.123456789')).toBe(123456789n)
  expect(validateSessionConfig(base)).toEqual(base)
  for(const patch of [{maxTrades:11},{intervalMs:4999},{durationMs:300001},{maxDebitSol:'0'},{buySol:'1e-3'},{slippage:51},{priorityFeeSol:0.01001},{sellPercent:101},{payer:'bad'},{walletId:''}])expect(()=>validateSessionConfig({...base,...patch})).toThrow()
 })
 it('requires scoped launch detection filters and a single SOL market-cap trigger',()=>{
  expect(()=>validateSessionConfig({...base,mode:'new-launch',mint:undefined,keyword:'a'})).toThrow(/filter|keyword/i)
  expect(()=>validateSessionConfig({...base,mode:'new-launch',mint:undefined,keyword:'orbit',action:'sell'})).toThrow(/buy/i)
  expect(validateSessionConfig({...base,mode:'new-launch',mint:undefined,keyword:' orbit '})).toMatchObject({keyword:'orbit'})
  expect(()=>validateSessionConfig({...base,mode:'cap',capSol:'10',capDirection:'at-or-above'})).toThrow(/single|one|1/)
  expect(validateSessionConfig({...base,mode:'cap',maxTrades:1,capSol:'10.000000001',capDirection:'at-or-above'})).toMatchObject({capSol:'10.000000001'})
 })
 it('persists only public config and progress and restores an interrupted run as stopped',()=>{
  const storage=memory()
  saveSessionJournal({version:1,id:'session-one',config:base,status:'running',phase:'monitoring',armedAt:1000,updatedAt:1000,reservedDebitLamports:'0',rows:[],secretKey:'private',signedPacket:'packet'} as never,storage)
  expect(storage.getItem(SESSION_HISTORY_KEY)).not.toMatch(/secretKey|private|signedPacket|packet/)
  expect(readSessionHistory(storage)[0]).toMatchObject({status:'stopped',phase:'idle'})
 })
})
