import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {DEFAULT_WORKSPACE_PREFERENCES,WORKSPACE_PREFERENCES_KEY,colorContrast,exportWorkspacePreferences,importWorkspacePreferences,readWorkspacePreferences,saveWorkspacePreferences,validateWorkspacePreferences,applyWorkspacePalette} from '../src/lib/workspacePreferences'
import {safeWalletLibrary} from '../src/lib/walletLibrary/storage'
const payer=Keypair.fromSeed(new Uint8Array(32).fill(55)).publicKey.toBase58()
const storage=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}}
describe('public workspace preferences',()=>{
 it('preserves a valid legacy boundary-contrast custom palette and uses a readable action foreground',()=>{
  const source=storage(),palette={background:'#000000',surface:'#000000',elevated:'#111111',border:'#555555',text:'#FFFFFF',secondary:'#CCCCCC',accent:'#7D7D7D'}
  const original=JSON.stringify({...DEFAULT_WORKSPACE_PREFERENCES,profileName:'Legacy studio',defaultFunder:payer,hotkeys:{enabled:true,buy:'a',sell:'s',review:'d'},palette})
  source.setItem(WORKSPACE_PREFERENCES_KEY,original)
  const restored=readWorkspacePreferences(source);expect(restored).toMatchObject({profileName:'Legacy studio',defaultFunder:payer,palette,hotkeys:{enabled:true,buy:'a',sell:'s',review:'d'}})
  expect(source.getItem(WORKSPACE_PREFERENCES_KEY)).toBe(original)
  const styles=new Map<string,string>();applyWorkspacePalette(restored.palette,{setProperty:(name,value)=>{styles.set(name,value??'')}})
  expect(colorContrast(palette.accent,styles.get('--accent-foreground')!)).toBeGreaterThanOrEqual(4.5)
  const destination=storage();importWorkspacePreferences(exportWorkspacePreferences(restored),destination);expect(readWorkspacePreferences(destination)).toEqual(restored)
 })
 it('upgrades the old stock appearance without changing stored data, the funder or shortcuts',()=>{
  const source=storage()
  const previous={...DEFAULT_WORKSPACE_PREFERENCES,profileName:'My studio',defaultFunder:payer,hotkeys:{enabled:true,buy:'a',sell:'s',review:'d'},palette:{background:'#111315',surface:'#191D20',elevated:'#20262A',border:'#2D3539',text:'#EDF2EF',secondary:'#ADB8B3',accent:'#C5D7E3'}}
  const original=JSON.stringify(previous)
  source.setItem(WORKSPACE_PREFERENCES_KEY,original)
  expect(readWorkspacePreferences(source)).toMatchObject({profileName:'My studio',defaultFunder:payer,hotkeys:previous.hotkeys,palette:{background:'#0E1322',accent:'#9FB6FF'}})
  expect(source.getItem(WORKSPACE_PREFERENCES_KEY)).toBe(original)
 })
 it('preserves a deliberately customized palette and keeps legacy settings imports compatible',()=>{
  const source=storage()
  const custom={background:'#111315',surface:'#191D20',elevated:'#20262A',border:'#2D3539',text:'#EDF2EF',secondary:'#ADB8B3',accent:'#C5D7E4'}
  source.setItem(WORKSPACE_PREFERENCES_KEY,JSON.stringify({...DEFAULT_WORKSPACE_PREFERENCES,palette:custom}))
  expect(readWorkspacePreferences(source).palette).toEqual(custom)
  const destination=storage()
  importWorkspacePreferences(exportWorkspacePreferences(readWorkspacePreferences(source)),destination)
  expect(readWorkspacePreferences(destination).palette).toEqual(custom)
  expect(exportWorkspacePreferences(readWorkspacePreferences(destination))).toContain('outsol-workspace-preferences')
 })
 it('gives the new default labels and action colors sufficient contrast on elevated surfaces',()=>{
  const palette=DEFAULT_WORKSPACE_PREFERENCES.palette
  expect(palette.background).toBe('#0E1322')
  for(const text of [palette.text,palette.secondary,palette.accent]){
   expect(colorContrast(text,palette.surface)).toBeGreaterThanOrEqual(4.5)
   expect(colorContrast(text,palette.elevated)).toBeGreaterThanOrEqual(4.5)
  }
 })
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
