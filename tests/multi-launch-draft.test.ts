import {beforeEach,describe,expect,it} from 'vitest'
import {readMultiLaunchDraft,saveMultiLaunchDraft,validateMultiLaunchDesign,MULTI_LAUNCH_DRAFT_KEY,type MultiLaunchDraft} from '../src/lib/multiLaunch/draft'

let data:Map<string,string>
const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}
const design=():MultiLaunchDraft=>({version:1,creatorFeeSelection:{kind:'deployer'},rows:[{name:'First',symbol:'ONE',buySol:'0.01'},{name:'',symbol:'',buySol:''}],description:'My shared story',website:'',twitter:'',telegram:'',source:'vault',slippage:5,priority:0.0005,tip:0.00001,kitId:'',artworkId:'a'.repeat(64)})
beforeEach(()=>{data=new Map()})

describe('multi-launch editable design',()=>{
 it('restores an incomplete design and local artwork reference without transaction state',()=>{
  const draft=design()
  saveMultiLaunchDraft({...draft,approved:true,privateKey:'secret',review:{signature:'signed'},image:'data:image/png;base64,secret',rows:[{...draft.rows[0],mintSecretKey:'secret'},draft.rows[1]]} as any,storage)
  expect(readMultiLaunchDraft(storage)).toEqual(draft)
  expect(data.get(MULTI_LAUNCH_DRAFT_KEY)).not.toMatch(/approved|privateKey|secret|signature|review|image/)
 })
 it('keeps deliberately cleared numeric settings as blank for correction',()=>{
  const draft={...design(),slippage:null,priority:null,tip:null}
  saveMultiLaunchDraft(draft,storage)
  expect(readMultiLaunchDraft(storage)).toEqual(draft)
  expect(validateMultiLaunchDesign(draft,{hasArtwork:true,hasSigner:true})).toHaveProperty('multi-setting-0')
 })
 it.each(['not json',JSON.stringify({...design(),version:2}),JSON.stringify({...design(),rows:Array(6).fill(design().rows[0])}),'x'.repeat(20001)])('preserves unreadable or unsupported previous designs',raw=>{
  data.set(MULTI_LAUNCH_DRAFT_KEY,raw)
  expect(()=>readMultiLaunchDraft(storage)).toThrow(/saved batch design/i)
  expect(()=>saveMultiLaunchDraft(design(),storage)).toThrow(/saved batch design/i)
  expect(data.get(MULTI_LAUNCH_DRAFT_KEY)).toBe(raw)
 })
 it('rejects invalid artwork references and oversized fields before replacing saved work',()=>{
  saveMultiLaunchDraft(design(),storage);const previous=data.get(MULTI_LAUNCH_DRAFT_KEY)
  expect(()=>saveMultiLaunchDraft({...design(),artworkId:'javascript:bad'},storage)).toThrow()
  expect(()=>saveMultiLaunchDraft({...design(),description:'x'.repeat(1001)},storage)).toThrow()
  expect(data.get(MULTI_LAUNCH_DRAFT_KEY)).toBe(previous)
 })
 it('surfaces a storage refusal instead of reporting a saved design',()=>{
  expect(()=>saveMultiLaunchDraft(design(),{getItem:()=>null,setItem:()=>{}})).toThrow(/not saved/i)
 })
 it('identifies exactly the incomplete fields before metadata is published',()=>{
  const errors=validateMultiLaunchDesign({...design(),website:'javascript:alert(1)',rows:[{name:'ş'.repeat(17),symbol:'?',buySol:'1e-3'},design().rows[1]]},{hasArtwork:false,hasSigner:false})
  expect(Object.keys(errors)).toEqual(expect.arrayContaining(['multi-name-0','multi-symbol-0','multi-buy-0','multi-name-1','multi-symbol-1','multi-buy-1','multi-link-0','multi-image','multi-signer']))
 })
 it('accepts the engine limits and exact nine-decimal first-buy amounts',()=>{
  const valid={...design(),rows:[{name:'First',symbol:'FIRST_1',buySol:'1000'},{name:'Second',symbol:'SECOND',buySol:'0.000000001'}]}
  expect(validateMultiLaunchDesign(valid,{hasArtwork:true,hasSigner:true})).toEqual({})
  expect(validateMultiLaunchDesign({...valid,rows:[{...valid.rows[0],buySol:'1000.000000001'},valid.rows[1]]},{hasArtwork:true,hasSigner:true})).toHaveProperty('multi-buy-0')
 })
})
