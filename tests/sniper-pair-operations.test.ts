import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {createSniperPairPolicy} from '../src/lib/sniperPairs/operations'
import type {WalletControlScope} from '../src/lib/bundler/walletControls'
import type {ResolvedSniperPair} from '../src/lib/sniperPairs/catalog'

function fixture(){
 const wallet=(id:string)=>({id,name:id,publicKey:Keypair.generate().publicKey.toBase58(),createdAt:'2026-11-01T00:00:00.000Z'})
 const a=wallet('a-source'),b=wallet('a-receiver'),c=wallet('b-source'),d=wallet('b-receiver'),wallets=[a,b,c,d]
 const pairs=[{id:'pair-a',name:'A',sniperWalletId:'old-a-source',sniperAddress:a.publicKey,receiverWalletId:'old-a-receiver',receiverAddress:b.publicKey,createdAt:a.createdAt,sniper:a,receiver:b},{id:'pair-b',name:'B',sniperWalletId:c.id,sniperAddress:c.publicKey,receiverWalletId:d.id,receiverAddress:d.publicKey,createdAt:c.createdAt,sniper:c,receiver:d}] satisfies ResolvedSniperPair[]
 let live=true
 const scope:WalletControlScope={wallets,revision:'one',roles:{[a.id]:'buyer',[b.id]:'recipient',[c.id]:'buyer',[d.id]:'recipient'},readOnlyIds:[],assertCurrent:()=>{if(!live)throw Error('Scope changed')},resolveWallet:id=>wallets.find(w=>w.id===id)??null,getKeypair:()=>null}
 return{a,b,c,d,pairs,scope,setLive:(value:boolean)=>{live=value}}
}
describe('receiver-only sniper pair operations',()=>{
 it('constructs all-receiver and individual selections without sniper sources, using restored current IDs',()=>{
  const h=fixture(),policy=createSniperPairPolicy(h.pairs,h.scope)
  expect(policy.receivers().map(w=>w.id)).toEqual([h.b.id,h.d.id]);expect(policy.receivers(['pair-a']).map(w=>w.id)).toEqual([h.b.id])
  expect(()=>policy.assertSaleRows([{walletId:h.a.id,payer:h.a.publicKey}])).toThrow(/receiver/i)
  expect(()=>policy.assertSaleRows([{walletId:h.b.id,payer:h.a.publicKey}])).toThrow(/receiver/i)
  expect(()=>policy.assertSaleRows([{walletId:'deployer',payer:Keypair.generate().publicKey.toBase58()}])).toThrow(/receiver/i)
  expect(()=>policy.receivers(['missing'])).toThrow(/pair/i)
 })
 it('binds a manual transfer to its exact paired receiver and refuses cross-pair or reversed routes',()=>{
  const h=fixture(),policy=createSniperPairPolicy(h.pairs,h.scope)
  expect(()=>policy.assertTransfer(h.a.id,h.b.id,h.a.publicKey,h.b.publicKey)).not.toThrow()
  expect(()=>policy.assertTransfer(h.a.id,h.d.id,h.a.publicKey,h.d.publicKey)).toThrow(/pair/i)
  expect(()=>policy.assertTransfer(h.b.id,h.a.id,h.b.publicKey,h.a.publicKey)).toThrow(/pair/i)
  expect(policy.routes()[0]).toMatchObject({sourceWalletId:h.a.id,destinationWalletId:h.b.id})
 })
 it('rechecks live scope and receiver role before constructing or signing an existing reviewed sale',()=>{
  const h=fixture(),policy=createSniperPairPolicy(h.pairs,h.scope)
  expect(()=>policy.assertSaleRows([{walletId:h.b.id,payer:h.b.publicKey}])).not.toThrow()
  h.scope.roles[h.b.id]='buyer';expect(()=>policy.assertSaleRows([{walletId:h.b.id,payer:h.b.publicKey}])).toThrow(/receiver/i)
  h.scope.roles[h.b.id]='recipient';h.setLive(false)
  expect(()=>policy.receivers()).toThrow(/changed/i)
  expect(()=>policy.assertSaleRows([{walletId:h.b.id,payer:h.b.publicKey}])).toThrow(/changed/i)
 })
 it('refuses duplicate roles, mismatched restored addresses and mutation of resolved wallet identities',()=>{
  const h=fixture()
  expect(()=>createSniperPairPolicy([{...h.pairs[0],receiver:h.a,receiverAddress:h.a.publicKey}],h.scope)).toThrow(/distinct|receiver|pair/i)
  expect(()=>createSniperPairPolicy([{...h.pairs[0],receiverAddress:h.d.publicKey}],h.scope)).toThrow(/address|pair/i)
  const policy=createSniperPairPolicy(h.pairs,h.scope);h.b.publicKey=Keypair.generate().publicKey.toBase58()
  expect(()=>policy.assertSaleRows([{walletId:h.b.id,payer:h.b.publicKey}])).toThrow(/changed|receiver/i)
 })
})
