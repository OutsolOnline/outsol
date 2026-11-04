import {afterEach,describe,expect,it,vi} from 'vitest'
import {createAutomationHandlers} from '../src/lib/server/automationWallets/handlers'
const origin='http://localhost:3000'
afterEach(()=>vi.unstubAllEnvs())
function request(body:unknown,options:{origin?:string;capability?:string}={}){return new Request(`${origin}/api/automation-wallets`,{method:'POST',headers:{origin:options.origin??origin,'content-type':'application/json',...(options.capability?{authorization:`Bearer ${options.capability}`}:{})},body:JSON.stringify(body)})}
describe('automation ownership request boundary',()=>{
 it('requires a private capability in a header for owned actions and rejects cross-origin or unknown key material',async()=>{
  vi.stubEnv('NODE_ENV','test');const status=vi.fn(async()=>({wallet:{address:'private'}})),handlers=createAutomationHandlers({service:()=>({status}) as never,readiness:()=>({enabled:true})})
  expect((await handlers.POST(request({action:'status'}))).status).toBe(404)
  expect((await handlers.POST(request({action:'status'},{origin:'https://attacker.invalid',capability:'a'.repeat(43)}))).status).toBe(403)
  expect((await handlers.POST(request({action:'create',consent:true,secretKey:[1,2,3]}))).status).toBe(400)
  expect(status).not.toHaveBeenCalled()
 })
 it('does not treat the shared access password as ownership and never caches private responses',async()=>{
  vi.stubEnv('NODE_ENV','test');const status=vi.fn(async(capability:string)=>({capabilityReceived:capability})),handlers=createAutomationHandlers({service:()=>({status}) as never})
  const response=await handlers.POST(request({action:'status'},{capability:'a'.repeat(43)}))
  expect(response.status).toBe(200);expect(status).toHaveBeenCalledWith('a'.repeat(43));expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toContain('Authorization')
 })
 it('limits generated server wallets and requires explicit custody consent',async()=>{
  vi.stubEnv('NODE_ENV','test');let created=0;const handlers=createAutomationHandlers({service:()=>({create:()=>{created++;return {wallet:{}}}}) as never})
  expect((await handlers.POST(request({action:'create',consent:false}))).status).toBe(400)
  expect((await handlers.POST(request({action:'create',consent:true}))).status).toBe(200)
  expect((await handlers.POST(request({action:'create',consent:true}))).status).toBe(200)
  expect((await handlers.POST(request({action:'create',consent:true}))).status).toBe(429);expect(created).toBe(2)
 })
 it('requires an actual Origin header and bounds bodies even without content-length',async()=>{
  vi.stubEnv('NODE_ENV','test');const handlers=createAutomationHandlers({service:()=>({}) as never})
  const noOrigin=new Request(`${origin}/api/automation-wallets`,{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"create"}'})
  expect((await handlers.POST(noOrigin)).status).toBe(403)
  expect((await handlers.POST(request({action:'create',padding:'x'.repeat(9000)}))).status).toBe(413)
 })
})
