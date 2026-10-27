import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {isAllowedRequestOrigin} from '../src/lib/server/requestOrigin'

const request=(origin:string,site='same-origin')=>new Request('https://vanity-production-2bbb.up.railway.app/api/rpc',{headers:{Origin:origin,'Sec-Fetch-Site':site}})
beforeEach(()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('PUBLIC_APP_URL','https://vanity-production-2bbb.up.railway.app');vi.stubEnv('APP_ORIGIN','');vi.stubEnv('APP_ALLOWED_ORIGINS','')})
afterEach(()=>vi.unstubAllEnvs())

describe('explicit deployment origin aliases',()=>{
 it('permits a configured custom domain and preserves the existing deployment domain',()=>{
  vi.stubEnv('APP_ALLOWED_ORIGINS','https://outsol.online')
  expect(isAllowedRequestOrigin(request('https://outsol.online'))).toBe(true)
  expect(isAllowedRequestOrigin(request('https://vanity-production-2bbb.up.railway.app'))).toBe(true)
 })
 it('denies arbitrary origins, lookalike domains, subdomains and cross-site callers',()=>{
  vi.stubEnv('APP_ALLOWED_ORIGINS','https://outsol.online')
  for(const origin of ['https://outsol.online.evil.example','https://evil.example','https://other.outsol.online','http://outsol.online'])expect(isAllowedRequestOrigin(request(origin))).toBe(false)
  expect(isAllowedRequestOrigin(request('https://outsol.online','cross-site'))).toBe(false)
 })
 it.each(['https://outsol.online/path','https://outsol.online/?secret=1','https://outsol.online/#fragment','https://user:password@outsol.online','http://outsol.online','https://*.outsol.online','*','https://outsol.online,,https://another.example'])('fails closed for invalid alias configuration: %s',value=>{
  vi.stubEnv('APP_ALLOWED_ORIGINS',value)
  expect(isAllowedRequestOrigin(request('https://vanity-production-2bbb.up.railway.app'))).toBe(false)
 })
 it('bounds the alias list and ignores forwarded hosts',()=>{
  vi.stubEnv('APP_ALLOWED_ORIGINS',Array.from({length:9},(_,index)=>`https://site${index}.example`).join(','))
  expect(isAllowedRequestOrigin(request('https://vanity-production-2bbb.up.railway.app'))).toBe(false)
  vi.stubEnv('APP_ALLOWED_ORIGINS','https://outsol.online')
  const spoofed=request('https://evil.example');spoofed.headers.set('x-forwarded-host','evil.example')
  expect(isAllowedRequestOrigin(spoofed)).toBe(false)
 })
})
