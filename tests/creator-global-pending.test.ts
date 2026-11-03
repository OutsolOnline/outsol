import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {assertNoPendingWalletOperation} from '../src/lib/walletOperations/history'
import {savePendingCreatorOperation,clearPendingCreatorOperation} from '../src/lib/creatorOperations/history'
import type {PendingCreatorOperation} from '../src/lib/creatorOperations/history'
describe('creator pending protection across existing transaction screens',()=>{
 it('blocks other spending while an original creator signature is unresolved',()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const payer=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58()
  const record:PendingCreatorOperation={version:1,intent:{version:1,input:{version:1,kind:'collect',payer,mint,priorityFeeLamports:'0'},scope:'wallet-wide'},signature:bs58.encode(new Uint8Array(64).fill(41)),blockhash:payer,lastValidBlockHeight:200,submittedAt:'2026-11-03T00:00:00.000Z'}
  savePendingCreatorOperation(record,storage)
  expect(()=>assertNoPendingWalletOperation(storage)).toThrow(/creator.*pending/i)
  clearPendingCreatorOperation(record,storage)
  expect(()=>assertNoPendingWalletOperation(storage)).not.toThrow()
 })
 it.each(['{broken',JSON.stringify({version:1,intent:{},signature:'original',lastValidBlockHeight:200})])('blocks every existing spending screen when supply lock recovery exists',raw=>{
  const values=new Map<string,string>([['outsol-supply-lock-pending-v1',raw]]),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  expect(()=>assertNoPendingWalletOperation(storage)).toThrow(/supply lock/i)
  values.delete('outsol-supply-lock-pending-v1')
  expect(()=>assertNoPendingWalletOperation(storage)).not.toThrow()
 })
})
