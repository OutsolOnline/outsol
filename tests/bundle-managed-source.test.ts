import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {createManagedBundleSource} from '../src/lib/bundler/managedSource'

function library(){
 const creator=Keypair.generate(),buyer=Keypair.generate(),keys=new Map([['creator',creator],['buyer',buyer]])
 const state={revision:1,storageUnavailable:false,groups:[{id:'group',name:'Launch',walletIds:['creator','buyer'],createdAt:'now',updatedAt:'now'}],wallets:[{id:'creator',name:'Creator',publicKey:creator.publicKey.toBase58(),createdAt:'now'},{id:'buyer',name:'Buyer',publicKey:buyer.publicKey.toBase58(),createdAt:'now'}],getKeypair:(id:string)=>keys.get(id)??null}
 return {keys,state,read:()=>state,creator,buyer}
}
describe('managed bundle signer source',()=>{
 it('resolves unlocked keys from callbacks without serializing secrets',()=>{
  const lib=library(),source=createManagedBundleSource(lib.read,'group','creator',[{id:1,libraryWalletId:'buyer',publicKey:lib.buyer.publicKey.toBase58()}])
  expect(source().creator).toBe(lib.creator)
  expect(source().wallets.get(1)).toBe(lib.buyer)
 })
 it.each(['locked','changed','revision','membership','storage'])('refuses a source that becomes %s before the next sign',kind=>{
  const lib=library(),source=createManagedBundleSource(lib.read,'group','creator',[{id:1,libraryWalletId:'buyer',publicKey:lib.buyer.publicKey.toBase58()}])
  source()
  if(kind==='locked')lib.keys.delete('buyer')
  if(kind==='changed')lib.keys.set('buyer',Keypair.fromSecretKey(lib.buyer.secretKey))
  if(kind==='revision')lib.state.revision++
  if(kind==='membership')lib.state.groups[0].walletIds=['creator']
  if(kind==='storage')lib.state.storageUnavailable=true
  expect(()=>source()).toThrow(/locked|changed|library|group/i)
 })
})
