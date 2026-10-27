import {describe,expect,it} from 'vitest'
import {captureMetadata,createCapturedDraft,type WebCapture} from '../src/lib/webCapture'

const capture=(sourceUrl:string):WebCapture=>({version:1,kind:'selection',name:'My idea',symbol:'',description:'A reviewed public idea',sourceUrl})
describe('X post attribution in launch design',()=>{
 it('starts the editable X link with the exact original public post',()=>{
  const source=capture('https://twitter.com/Interior/status/463440424141459456')
  const metadata=captureMetadata(source)
  expect(metadata.twitter).toBe('https://x.com/Interior/status/463440424141459456')
  expect(createCapturedDraft(source,{...metadata,symbol:'IDEA'}).metadata.twitter).toBe(metadata.twitter)
 })
 it('keeps a user-reviewed replacement or removal when saving the draft',()=>{
  const source=capture('https://x.com/Interior/status/463440424141459456')
  const edited={...captureMetadata(source),symbol:'IDEA',twitter:'https://x.com/outsol_example'}
  expect(createCapturedDraft(source,edited).metadata.twitter).toBe(edited.twitter)
  expect(createCapturedDraft(source,{...edited,twitter:''}).metadata.twitter).toBe('')
 })
 it.each(['https://example.com/Interior/status/123','https://x.com/Interior','https://x.com.evil.example/Interior/status/123'])('does not invent an X link for another source (%s)',url=>{
  expect(captureMetadata(capture(url)).twitter).toBe('')
 })
})
