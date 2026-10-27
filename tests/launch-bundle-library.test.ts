import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {createLaunchBuyerSource} from '../src/lib/launchBundle/librarySource'
import type {LaunchBundleSettings} from '../src/lib/launchBundle/types'

function fixture(){
 const key=Keypair.generate()
 let current={revision:1,storageUnavailable:false,groups:[{id:'group',walletIds:['buyer']}],wallets:[{id:'buyer',publicKey:key.publicKey.toBase58()}],getKeypair:(_id:string)=>key as Keypair|null}
 const settings:LaunchBundleSettings={version:1,mode:'manual',groupId:'group',wallets:[{walletId:'buyer',publicKey:key.publicKey.toBase58(),name:'Buyer',buySol:0.01,delaySeconds:0}],intervalMinSeconds:3,intervalMaxSeconds:10}
 return {key,settings,read:()=>current,change:(patch:Partial<typeof current>)=>{current={...current,...patch}}}
}
describe('inline launch encrypted buyer source',()=>{
 it('only resolves the approved unlocked group member',()=>{
  const f=fixture(),source=createLaunchBuyerSource(f.read,f.settings)
  expect(source('buyer')).toBe(f.key)
  expect(()=>source('other')).toThrow(/selected|approved/i)
 })
 it.each(['lock','replace','revision','group','address','storage'])('stops after a selected wallet or group changes: %s',kind=>{
  const f=fixture(),source=createLaunchBuyerSource(f.read,f.settings)
  if(kind==='lock')f.change({getKeypair:()=>null})
  if(kind==='replace')f.change({getKeypair:()=>Keypair.fromSecretKey(f.key.secretKey)})
  if(kind==='revision')f.change({revision:2})
  if(kind==='group')f.change({groups:[{id:'group',walletIds:[]}]})
  if(kind==='address')f.change({wallets:[{id:'buyer',publicKey:Keypair.generate().publicKey.toBase58()}]})
  if(kind==='storage')f.change({storageUnavailable:true})
  expect(()=>source('buyer')).toThrow(/locked|changed|unavailable/i)
 })
 it('does not require a wallet library for a launch without additional buys',()=>{
  const f=fixture();f.change({storageUnavailable:true,groups:[]})
  const source=createLaunchBuyerSource(f.read,{...f.settings,groupId:null,wallets:[]})
  expect(()=>source('buyer')).toThrow(/selected|approved/i)
 })
})
