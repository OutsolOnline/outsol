import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {DEFAULT_WORKSPACE_PREFERENCES,exportWorkspacePreferences,importWorkspacePreferences,readWorkspacePreferences,saveWorkspacePreferences,validateWorkspacePreferences} from '../src/lib/workspacePreferences'
import {safeWalletLibrary} from '../src/lib/walletLibrary/storage'
const payer=Keypair.fromSeed(new Uint8Array(32).fill(55)).publicKey.toBase58()
const storage=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}}
describe('public workspace preferences',()=>{
 it('exports portable public settings while preserving review-only hotkeys and excluding unknown state',()=>{
  const source=storage();saveWorkspacePreferences({...DEFAULT_WORKSPACE_PREFERENCES,profileName:'Studio',defaultFunder:payer,secretKey:'PRIVATE'} as never,source)
  const text=exportWorkspacePreferences(readWorkspacePreferences(source));expect(text).not.toContain('PRIVATE')
  const destination=storage();importWorkspacePreferences(text,destination)
  expect(readWorkspacePreferences(destination)).toMatchObject({profileName:'Studio',defaultFunder:payer,hotkeys:{enabled:false,buy:'b',sell:'s',review:'r'}})
 })
 it('rejects unreadable settings without overwriting them and checks palette readability',()=>{
  const corrupt={getItem:()=>'{',setItem:()=>{throw new Error('must not overwrite')}}
  expect(()=>readWorkspacePreferences(corrupt)).toThrow(/Preserve/)
  expect(()=>saveWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES,corrupt)).toThrow(/Preserve/)
  expect(()=>validateWorkspacePreferences({...DEFAULT_WORKSPACE_PREFERENCES,palette:{...DEFAULT_WORKSPACE_PREFERENCES.palette,text:'#191D20'}})).toThrow(/contrast/)
  expect(()=>validateWorkspacePreferences({...DEFAULT_WORKSPACE_PREFERENCES,palette:{...DEFAULT_WORKSPACE_PREFERENCES.palette,accent:'url(evil)'}})).toThrow(/color/)
 })
 it('rejects duplicate hotkeys and invalid public funders',()=>{
  expect(()=>validateWorkspacePreferences({...DEFAULT_WORKSPACE_PREFERENCES,hotkeys:{enabled:true,buy:'b',sell:'b',review:'r'}})).toThrow(/distinct/)
  expect(()=>validateWorkspacePreferences({...DEFAULT_WORKSPACE_PREFERENCES,defaultFunder:'not a wallet'})).toThrow()
 })
 it('roundtrips group colors and archive state in the existing library schema',()=>{
  const group={id:'12345678-1234-1234-1234-123456789012',name:'Long term',walletIds:[],createdAt:'2026-11-03T00:00:00.000Z',updatedAt:'2026-11-03T00:00:00.000Z',color:'blue',archivedAt:'2026-11-03T01:00:00.000Z'}
  const value=safeWalletLibrary({version:1,revision:1,wallets:[],groups:[group],legacyImported:false})
  expect(value.groups[0]).toMatchObject({color:'blue',archivedAt:group.archivedAt})
  expect(()=>safeWalletLibrary({...value,groups:[{...group,color:'url(evil)'}]})).toThrow()
 })
})
