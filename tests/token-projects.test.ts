import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { readTokenProjects, saveTokenProject } from '../src/lib/tokenProjects'
const mint = Keypair.fromSeed(new Uint8Array(32).fill(31)).publicKey.toBase58()
function store() { const values = new Map<string,string>(); return { getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)} } }
describe('persistent public token workspaces',()=>{
 it('updates one project per mint, preserving public notes and stripping secrets',()=>{
  const storage=store()
  saveTokenProject({mint,name:'First',symbol:'ONE',notes:'My plan',secretKey:'PRIVATE'} as never,storage)
  saveTokenProject({mint,name:'Updated',symbol:'ONE'},storage)
  expect(readTokenProjects(storage)).toMatchObject([{mint,name:'Updated',notes:'My plan'}])
  expect(JSON.stringify(readTokenProjects(storage))).not.toContain('PRIVATE')
 })
 it('rejects unsafe identifiers and preserves unreadable saved work',()=>{
  expect(()=>saveTokenProject({mint:'javascript:alert(1)',name:'X',symbol:'X'},store())).toThrow()
  const storage={getItem:()=>'{',setItem:()=>{throw new Error('must not overwrite')}}
  expect(()=>readTokenProjects(storage)).toThrow(/cannot be read/)
 })
 it('accepts only safe public metadata links',()=>{
  expect(()=>saveTokenProject({mint,name:'X',symbol:'X',metadataUri:'javascript:alert(1)'},store())).toThrow()
 })
})
