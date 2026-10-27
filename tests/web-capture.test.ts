import {describe,expect,it,vi} from 'vitest'
import {parseWebCapture,createCapturedDraft,fetchCaptureImage,readCaptureReview,writeCaptureReview,clearCaptureReview,verifyCaptureReviewDraft} from '../src/lib/webCapture'
import {DEFAULT_LAUNCH_CONFIG} from '../src/lib/launchConfig'
import {validateArtwork} from '../src/lib/artworkLibrary'

const payload={version:1,kind:'selection',name:'Orbital idea',symbol:'ORBIT',description:'A public selection',sourceUrl:'https://example.com/story?tracking=1#comment',imageUrl:'https://images.example.com/art.png?tracking=1'}
const fragment=(value:unknown)=>`#import=${encodeURIComponent(JSON.stringify(value))}`
describe('untrusted extension draft handoff',()=>{
 it('returns bounded plain suggestions and strips URL query and hash',()=>{
  expect(parseWebCapture(fragment(payload))).toEqual({...payload,sourceUrl:'https://example.com/story',imageUrl:'https://images.example.com/art.png'})
 })
 it.each(['https://user:password@example.com','https://127.0.0.1/a','https://2130706433/a','https://10.1.2.3/a','https://localhost/a','https://metadata.google.internal/a','javascript:alert(1)','file:///private','https://[::1]/a'])('rejects non-public capture origins: %s',sourceUrl=>{
  expect(()=>parseWebCapture(fragment({...payload,sourceUrl}))).toThrow()
 })
 it.each(['https://device.home/a','https://device.lan/a','https://example.onion/a','https://*.example.com/a','https://192.0.2.1/a','https://198.51.100.1/a','https://203.0.113.1/a'])('rejects reserved capture addresses consistently: %s',sourceUrl=>{
  expect(()=>parseWebCapture(fragment({...payload,sourceUrl}))).toThrow()
 })
 it('rejects malformed/oversized payloads, key material and HTML-sized names',()=>{
  for(const value of [{...payload,secretKey:'do-not-accept'},{...payload,name:'a'.repeat(33)},{...payload,symbol:'<script>'},{...payload,description:'a'.repeat(1001)},{...payload,kind:'sign'},{...payload,version:2}])expect(()=>parseWebCapture(fragment(value))).toThrow()
  expect(()=>parseWebCapture('#import=%zz')).toThrow()
  expect(()=>parseWebCapture('#import='+'a'.repeat(25000))).toThrow()
  expect(parseWebCapture('')).toBeNull()
 })
 it('creates a separate Pump draft with no private or image-URL state',()=>{
  const capture=parseWebCapture(fragment(payload))!
  const draft=createCapturedDraft(capture,{name:'Reviewed',symbol:'REV',description:'Reviewed description',website:'',twitter:'',telegram:''},'a'.repeat(64))
  expect(draft.config).toEqual(DEFAULT_LAUNCH_CONFIG)
  expect(draft.artworkId).toBe('a'.repeat(64))
  expect(draft.metadata.name).toBe('Reviewed')
  expect(JSON.stringify(draft)).not.toMatch(/secretKey|sourceUrl|imageUrl|tracking=1/)
 })
 it('requires valid reviewed token fields before a draft or artwork is saved',()=>{
  const capture=parseWebCapture(fragment(payload))!
  const metadata={name:'Reviewed',symbol:'REV',description:'Reviewed description',website:'',twitter:'',telegram:''}
  for(const change of [{name:'😀'.repeat(9)},{name:'Bad\nname'},{symbol:'REV!'},{description:'Bad\u0000text'},{website:'javascript:alert(1)'}])expect(()=>createCapturedDraft(capture,{...metadata,...change})).toThrow()
  expect(createCapturedDraft(capture,{...metadata,name:'  Reviewed  ',symbol:'rev'}).metadata).toMatchObject({name:'Reviewed',symbol:'REV'})
 })
})

describe('per-tab capture recovery',()=>{
 const storage=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
 it('preserves editable public suggestions and local references without image bytes',()=>{
  const target=storage(),capture=parseWebCapture(fragment(payload))!
  const review={capture,metadata:{name:'😀'.repeat(9),symbol:'REV',description:'Edited before refresh',website:'',twitter:'',telegram:''},artworkId:'a'.repeat(64),savedId:'12345678-1234-1234-1234-123456789012'}
  writeCaptureReview(review,target)
  expect(readCaptureReview(target)).toEqual(review)
  clearCaptureReview(target)
  expect(readCaptureReview(target)).toBeNull()
 })
 it('rejects corrupt recovery and reports blocked browser storage without dropping current edits',()=>{
  const target=storage()
  target.setItem('outsol-capture-review-v1',JSON.stringify({capture:payload,metadata:{name:'x'.repeat(100000)}}))
  expect(()=>readCaptureReview(target)).toThrow(/saved capture|recovery/i)
  const blocked={getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('blocked')},removeItem:()=>{throw new Error('blocked')}}
  expect(()=>writeCaptureReview({capture:parseWebCapture(fragment(payload))!,metadata:{name:'Name',symbol:'NAME',description:''}},blocked)).toThrow(/refresh|recovery/i)
 })
 it('preserves draft and artwork recovery references when the draft library cannot be read',()=>{
  const target=storage(),review={capture:parseWebCapture(fragment(payload))!,metadata:{name:'Reviewed',symbol:'REV',description:'Restored edits',website:'',twitter:'',telegram:''},artworkId:'a'.repeat(64),savedId:'12345678-1234-1234-1234-123456789012'}
  const restored=verifyCaptureReviewDraft(review,()=>{throw new Error('Draft storage unavailable')})
  expect(restored.review).toEqual(review)
  expect(restored.savedDraftStatus).toBe('unverified')
  expect(restored.warning).toMatch(/could not be verified|preserved/i)
  writeCaptureReview(restored.review,target)
  expect(readCaptureReview(target)).toEqual(review)
 })
 it('clears only a confirmed missing draft reference and keeps independent artwork recovery',()=>{
  const review={capture:parseWebCapture(fragment(payload))!,metadata:{name:'Reviewed',symbol:'REV',description:''},artworkId:'a'.repeat(64),savedId:'12345678-1234-1234-1234-123456789012'}
  const missing=verifyCaptureReviewDraft(review,()=>[])
  expect(missing.savedDraftStatus).toBe('missing')
  expect(missing.review.savedId).toBeUndefined()
  expect(missing.review.artworkId).toBe(review.artworkId)
  const saved=verifyCaptureReviewDraft(review,()=>[{id:review.savedId}])
  expect(saved.savedDraftStatus).toBe('saved')
  expect(saved.review.savedId).toBe(review.savedId)
 })
})
describe('explicit browser image import',()=>{
 it('validates selected artwork before preview without saving it',async()=>{
  await expect(validateArtwork(new Blob(['<svg/>'],{type:'image/png'}))).rejects.toThrow(/format|valid/)
  await expect(validateArtwork(new Blob([],{type:'image/png'}))).rejects.toThrow(/empty/)
  await expect(validateArtwork(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}))).resolves.toBeUndefined()
 })
 it('fetches without credentials and refuses SVG or oversized image responses',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}))
  await expect(fetchCaptureImage('https://images.example.com/art.svg',undefined,fetcher)).rejects.toThrow(/PNG|JPEG|WebP|GIF/)
  expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'})
  const tooLarge=vi.fn<typeof fetch>(async()=>new Response('',{headers:{'Content-Type':'image/png','Content-Length':String(6*1024*1024)}}))
  await expect(fetchCaptureImage('https://images.example.com/art.png',undefined,tooLarge)).rejects.toThrow(/5 MB/)
 })
 it('accepts a bounded raster response and never requests a private URL',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png'}}))
  const image=await fetchCaptureImage('https://images.example.com/art.png',undefined,fetcher)
  expect(image.type).toBe('image/png');expect(image.size).toBe(8)
  await expect(fetchCaptureImage('https://192.168.1.1/image.png',undefined,fetcher)).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
 })
})
