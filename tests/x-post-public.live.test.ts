import {describe,expect,it} from 'vitest'
import {writeFileSync} from 'node:fs'
import {createXPostService} from '../src/lib/server/xPosts'
import {postToWebCapture} from '../src/lib/xPosts'
import {createCapturedDraft,parseWebCapture} from '../src/lib/webCapture'

describe.skipIf(process.env.RUN_X_PUBLIC_READONLY!=='1')('official public X post import (read only)',()=>{
 it('reads an actual public post and reaches a reviewed Pump.fun design without account access or signing',async()=>{
  let reads=0
  const guarded:typeof fetch=async(input,init)=>{
   const destination=new URL(String(input))
   if(destination.origin!=='https://publish.x.com'||destination.pathname!=='/oembed'||init?.method!=='GET'||new Headers(init.headers).has('Authorization')||init?.redirect!=='error')throw new Error('Only the fixed unauthenticated public preview read is permitted.')
   reads++
   return fetch(input,init)
  }
  const snapshot=await createXPostService(guarded).readPublicPost('https://x.com/Interior/status/463440424141459456')
  expect(reads).toBe(1);expect(snapshot.post.source).toBe('oembed')
  expect(snapshot.post.id).toBe('463440424141459456');expect(snapshot.post.author.username.toLowerCase()).toBe('interior')
  expect(snapshot.post.text.length).toBeGreaterThan(0);expect(snapshot.post.text).not.toMatch(/<blockquote|<script|<a\s/i)
  const capture=postToWebCapture(snapshot.post)
  expect(parseWebCapture('#import='+encodeURIComponent(JSON.stringify(capture)))).toEqual(capture)
  expect(capture.symbol).toBe('')
  expect(()=>createCapturedDraft(capture,{name:capture.name,symbol:'',description:capture.description})).toThrow()
  const draft=createCapturedDraft(capture,{name:capture.name,symbol:'XQA',description:capture.description})
  expect(draft.config.venue).toBe('pump');expect(draft.config.mode).toBe('standard')
  expect(JSON.stringify(draft)).not.toMatch(/accessToken|refreshToken|privateKey|secretKey|signature/i)
  if(process.env.X_PUBLIC_READONLY_REPORT_FILE)writeFileSync(process.env.X_PUBLIC_READONLY_REPORT_FILE,JSON.stringify({checkedAt:new Date().toISOString(),provider:'official X oEmbed',httpReadSucceeded:true,reads,source:snapshot.post.source,authorAttributed:true,datePreserved:!!snapshot.post.createdAt,textCharacters:snapshot.post.text.length,captureRoundtrip:true,symbolRequiresReview:true,pumpDraftCreated:true,oauthOrPaidApiUsed:false,metadataPublished:false,transactionsSigned:false},null,2))
 },20_000)
})
