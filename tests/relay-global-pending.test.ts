import {describe,it,expect} from 'vitest'
import {assertNoPendingWalletOperation} from '../src/lib/walletOperations/history'
describe('Relay protection across existing OutSol workflows',()=>{
 it('blocks spending when generic wallet recovery is clear but the original Relay remains unknown',()=>{
  const values=new Map([['outsol-relay-receipts-v1',JSON.stringify([{status:'unknown'}])]])
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  expect(()=>assertNoPendingWalletOperation(storage)).toThrow(/Relay|relay/)
 })
 it('refuses malformed Relay recovery instead of treating it as no pending transfers',()=>{
  const storage={getItem:(key:string)=>key==='outsol-relay-receipts-v1'?'broken-json':null,setItem:()=>{},removeItem:()=>{}}
  expect(()=>assertNoPendingWalletOperation(storage)).toThrow(/Relay|relay/)
 })
})
