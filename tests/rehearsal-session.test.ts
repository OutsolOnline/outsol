import {describe,expect,it} from 'vitest'
import {restoreRehearsalSession} from '../src/lib/rehearsalSession'
const input={name:'Demo',symbol:'DEMO',metadataUri:'https://example.com/test.json',initialBuySol:'0',priorityFeeSol:'0',jitoTipSol:'0.00001'}
const job={id:'a'.repeat(48),status:'running',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}
describe('public rehearsal session recovery',()=>{
 it('restores a bounded job without copying arbitrary data',()=>{const value=restoreRehearsalSession(JSON.stringify({input:{...input,secretKey:'PRIVATE'},job,placeholder:true}));expect(value.job.id).toBe(job.id);expect(JSON.stringify(value)).not.toContain('PRIVATE')})
 it.each([{...job,id:'../other'},{...job,status:'succeeded',result:{totalCostLamports:'NaN'}},{...job,createdAt:'invalid'}])('rejects corrupt records before the report renders',job=>{expect(()=>restoreRehearsalSession(JSON.stringify({input,job}))).toThrow()})
})
