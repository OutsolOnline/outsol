import {describe,expect,it} from 'vitest'
import {writeFileSync} from 'node:fs'
import {createPumpFeedService} from '../src/lib/server/pumpFeed'

describe.skipIf(process.env.RUN_PUMP_FEED_READONLY!=='1')('configured Pump discovery provider (read only)',()=>{
 it('reads the real confirmed feed without permitting a spending RPC method',async()=>{
  if(!process.env.RPC_URL||new URL(process.env.RPC_URL).protocol!=='https:')throw new Error('An explicit HTTPS provider is required for this read-only check.')
  const methods:string[]=[],guarded:typeof fetch=async(input,init)=>{
   const call=JSON.parse(String(init?.body))
   if(!['getSignaturesForAddress','getTransaction'].includes(call.method))throw new Error('Only confirmed read-only discovery methods are allowed.')
   methods.push(call.method);const response=await fetch(input,init)
   if(process.env.PUMP_FEED_DEBUG==='1'){const payload=await response.clone().json();console.log(JSON.stringify({method:call.method,http:response.status,bytes:Buffer.byteLength(JSON.stringify(payload)),errorCode:payload.error?.code,resultType:Array.isArray(payload.result)?'array':typeof payload.result}))}
   return response
  }
  const snapshot=await createPumpFeedService(guarded)()
  expect(snapshot.status).toBe('ready');expect(snapshot.coverage).toBe('recent-confirmed-transactions');expect(snapshot.items.length).toBeLessThanOrEqual(30)
  expect(methods.filter(value=>value==='getSignaturesForAddress')).toHaveLength(1)
  expect(methods.filter(value=>value==='getTransaction').length).toBeLessThanOrEqual(12)
  if(process.env.PUMP_FEED_REPORT_FILE)writeFileSync(process.env.PUMP_FEED_REPORT_FILE,JSON.stringify({checkedAt:new Date().toISOString(),status:snapshot.status,coverage:snapshot.coverage,itemCount:snapshot.items.length,readRequests:methods.length,realSolSpent:false,spendingMethodsAllowed:false},null,2))
 },20_000)
})
