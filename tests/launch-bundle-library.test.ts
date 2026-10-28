import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {createLaunchBuyerSource} from '../src/lib/launchBundle/librarySource'
import type {LaunchBundleSettings} from '../src/lib/launchBundle/types'
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {launchOutcomeFromResult} from '../src/stores/launchStore'
import {publicPending} from '../src/lib/launchHistory'

function fixture(){
 const key=Keypair.generate()
 let current={revision:1,storageUnavailable:false,groups:[{id:'group',walletIds:['buyer']}],wallets:[{id:'buyer',publicKey:key.publicKey.toBase58()}],getKeypair:(_id:string)=>key as Keypair|null}
 const settings:LaunchBundleSettings={version:1,mode:'manual',groupId:'group',wallets:[{walletId:'buyer',publicKey:key.publicKey.toBase58(),name:'Buyer',buySol:0.01,delaySeconds:0}],intervalMinSeconds:3,intervalMaxSeconds:10}
 return {key,settings,read:()=>current,change:(patch:Partial<typeof current>)=>{current={...current,...patch}}}
}
describe('inline launch encrypted buyer source',()=>{
 it.each(['confirmed','unknown','partial'] as const)('records only public transfer intent for a %s execution outcome',status=>{
  const transfer={walletId:'buyer',payer:Keypair.generate().publicKey.toBase58(),recipient:Keypair.generate().publicKey.toBase58(),mint:Keypair.generate().publicKey.toBase58(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),rawAmount:'18446744073709551615',decimals:6}
  const result={status,tokenTransfers:[{...transfer,privateKey:'never-copy'}],error:status==='unknown'?'Check\noriginal signatures':undefined}
  const outcome=launchOutcomeFromResult('block0',1,result)
  expect(outcome.transfers).toEqual([transfer])
  expect(outcome.status).toBe(status==='confirmed'?'confirmed':'partial')
  if(status==='unknown')expect(outcome.message).toBe('Check original signatures')
  const record=publicPending({mode:'standard',venue:'pump',mint:transfer.mint,payer:transfer.payer,blockhash:'hash',signatures:['original-signature'],submittedAt:'now',bundleExecution:outcome})
  expect(JSON.parse(JSON.stringify(record)).bundleExecution.transfers).toEqual([transfer])
  expect(JSON.stringify(record)).not.toMatch(/privateKey|never-copy/)
  result.tokenTransfers[0].recipient=Keypair.generate().publicKey.toBase58()
  expect(outcome.transfers?.[0].recipient).toBe(transfer.recipient)
 })
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
