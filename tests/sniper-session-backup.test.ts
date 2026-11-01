import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {buildSniperSessionBackup,parseSniperSessionBackup} from '../src/lib/sniperPairs/sessionBackup'
import type {ResolvedSniperPair} from '../src/lib/sniperPairs/catalog'
import type {WalletSummary} from '../src/lib/walletLibrary/types'

const time='2026-11-01T00:00:00.000Z'
function session(count=2,withDeployer=true){
 const keys=new Map<string,Keypair>(),wallet=(id:string):WalletSummary=>{const key=Keypair.generate();keys.set(id,key);return{id,name:id,publicKey:key.publicKey.toBase58(),createdAt:time}}
 const pairs:ResolvedSniperPair[]=Array.from({length:count},(_,index)=>{const sniper=wallet(`Sniper-${index}`),receiver=wallet(`Receiver-${index}`);return{id:`pair-${index}`,name:`Pair ${index}`,sniperWalletId:sniper.id,sniperAddress:sniper.publicKey,receiverWalletId:receiver.id,receiverAddress:receiver.publicKey,createdAt:time,sniper,receiver}})
 const deployer=withDeployer?wallet('Deployer'):undefined
 return{name:'My reusable session',pairs,deployer,readKeypair:(id:string)=>keys.get(id)??null,keys}
}
const decode=(input:ReturnType<typeof session>)=>JSON.parse(buildSniperSessionBackup(input).content)

describe('whole sniper session private backup',()=>{
 it('exports one file preserving all pair roles and the optional distinct deployer',()=>{
  const input=session(),file=buildSniperSessionBackup(input),raw=JSON.parse(file.content),restored=parseSniperSessionBackup(file.content)
  expect(file).toMatchObject({mimeType:'application/json',filename:'outsol-my-reusable-session-sniper-session.json'})
  expect(raw).toMatchObject({version:1,type:'outsol-sniper-session',name:input.name,deployerAddress:input.deployer!.publicKey})
  expect(raw.pairs).toEqual(input.pairs.map(pair=>({name:pair.name,sniperAddress:pair.sniperAddress,receiverAddress:pair.receiverAddress})))
  expect(raw.wallets).toHaveLength(5);expect(raw.wallets.every((wallet:{secretKey:number[]})=>wallet.secretKey.length===64)).toBe(true)
  expect(restored.wallets).toHaveLength(5);expect(restored.pairs).toEqual(raw.pairs)
  for(const wallet of restored.wallets)expect(Keypair.fromSecretKey(bs58.decode(wallet.privateKey)).publicKey.toBase58()).toBe(wallet.publicKey)
  expect(file.content).not.toContain('sniperWalletId');expect(file.content).not.toContain('receiverWalletId')
 })
 it('accepts more than 20 wallets for encrypted chunked restoration',()=>{
  const input=session(16),restored=parseSniperSessionBackup(buildSniperSessionBackup(input).content)
  expect(restored.pairs).toHaveLength(16);expect(restored.wallets).toHaveLength(33)
 })
 it('exports every selected pair without a deployer and validates the 50-pair maximum',()=>{
  const input=session(50,false),file=buildSniperSessionBackup(input),restored=parseSniperSessionBackup(file.content)
  expect(restored.wallets).toHaveLength(100);expect(restored.deployerAddress).toBeUndefined();expect(new TextEncoder().encode(file.content).length).toBeLessThanOrEqual(131072)
  const tooMany=session(51,false);expect(()=>buildSniperSessionBackup(tooMany)).toThrow(/50|100/)
 })
 it('refuses partial export if any source or receiver is locked, mismatched or locks late',()=>{
  const input=session(),first=input.pairs[0].sniper.id,last=input.deployer!.id
  input.keys.delete(first);expect(()=>buildSniperSessionBackup(input)).toThrow(/unlock/i)
  const mismatch=session();mismatch.keys.set(mismatch.pairs[0].receiver.id,Keypair.generate());expect(()=>buildSniperSessionBackup(mismatch)).toThrow(/match/i)
  const late=session();let reads=0
  expect(()=>buildSniperSessionBackup({...late,readKeypair:id=>{if(id===last&&++reads===1)late.keys.delete(first);return late.keys.get(id)??null}})).toThrow(/unlock/i)
 })
 it('refuses a deployer that is a source or receiver and rejects cross-role duplicate pairs',()=>{
  const input=session();expect(()=>buildSniperSessionBackup({...input,deployer:input.pairs[0].receiver})).toThrow(/distinct|duplicate|deployer/i)
  input.pairs[1]={...input.pairs[1],receiver:input.pairs[0].sniper,receiverWalletId:input.pairs[0].sniper.id,receiverAddress:input.pairs[0].sniper.publicKey}
  expect(()=>buildSniperSessionBackup(input)).toThrow(/distinct|duplicate|already/i)
 })
 it('rejects a changed receiver role instead of silently exporting another destination',()=>{
  const input=session();input.pairs[0].receiver={...input.pairs[0].receiver,publicKey:Keypair.generate().publicKey.toBase58()}
  expect(()=>buildSniperSessionBackup(input)).toThrow(/match|changed|missing|restore/i)
 })
 it('rejects bad private key arrays and any key that differs from the declared address',()=>{
  const raw=decode(session());raw.wallets[0].secretKey[0]=256;expect(()=>parseSniperSessionBackup(JSON.stringify(raw))).toThrow(/key|invalid/i)
  const other=decode(session());other.wallets[0].secretKey=Array.from(Keypair.generate().secretKey);expect(()=>parseSniperSessionBackup(JSON.stringify(other))).toThrow(/match/i)
 })
 it('rejects missing referenced wallets, extra unreferenced wallets and duplicate addresses',()=>{
  const missing=decode(session());missing.wallets.pop();expect(()=>parseSniperSessionBackup(JSON.stringify(missing))).toThrow(/missing|every|deployer/i)
  const extra=decode(session());const key=Keypair.generate();extra.wallets.push({name:'Unreferenced',publicKey:key.publicKey.toBase58(),secretKey:Array.from(key.secretKey)});expect(()=>parseSniperSessionBackup(JSON.stringify(extra))).toThrow(/unreferenced|referenced|extra/i)
  const duplicate=decode(session());duplicate.wallets.push(duplicate.wallets[0]);expect(()=>parseSniperSessionBackup(JSON.stringify(duplicate))).toThrow(/duplicate|distinct/i)
 })
 it('rejects role swaps into another pair, unknown/private extra fields and malformed formats',()=>{
  const swapped=decode(session());swapped.pairs[1].sniperAddress=swapped.pairs[0].receiverAddress;expect(()=>parseSniperSessionBackup(JSON.stringify(swapped))).toThrow(/distinct|duplicate/i)
  for(const raw of [{...decode(session()),apiKey:'never allowed'},{...decode(session()),version:2},{...decode(session()),type:'ordinary-wallets'}])expect(()=>parseSniperSessionBackup(JSON.stringify(raw))).toThrow()
  const privateExtra=decode(session());privateExtra.pairs[0].privateKey='forbidden';expect(()=>parseSniperSessionBackup(JSON.stringify(privateExtra))).toThrow()
  const walletExtra=decode(session());walletExtra.wallets[0].privateKey='forbidden';expect(()=>parseSniperSessionBackup(JSON.stringify(walletExtra))).toThrow()
  expect(()=>parseSniperSessionBackup('{broken')).toThrow();expect(()=>parseSniperSessionBackup(' '.repeat(131073))).toThrow(/128/)
 })
})
