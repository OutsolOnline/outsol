import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {buildPrivateWalletBackup,type WalletPrivateBackupSource} from '../src/lib/walletLibrary/privateBackup'
import {parseWalletImport} from '../src/lib/walletLibrary/import'

function wallet(name='Bundle wallet'):WalletPrivateBackupSource {
 const key=Keypair.generate()
 return {id:crypto.randomUUID(),name,address:key.publicKey.toBase58(),readKeypair:()=>key}
}
describe('explicit local private wallet backups',()=>{
 it('exports one standard64-byteSolana keypair file that restores the reviewed wallet',()=>{
  const source=wallet('Creator'),result=buildPrivateWalletBackup([source],'keypair'),bytes=JSON.parse(result.content)
  expect(Array.isArray(bytes)&&bytes.length===64&&bytes.every((byte:unknown)=>Number.isInteger(byte)&&Number(byte)>=0&&Number(byte)<=255)).toBe(true)
  expect(Keypair.fromSecretKey(new Uint8Array(bytes)).publicKey.toBase58()).toBe(source.address)
  expect(result.filename).toMatch(/keypair\.json$/);expect(result.mimeType).toBe('application/json')
 })
 it('exports oneBase58privatekey file that restores the reviewed wallet',()=>{
  const source=wallet('Recipient'),result=buildPrivateWalletBackup([source],'base58')
  expect(Keypair.fromSecretKey(bs58.decode(result.content.trim())).publicKey.toBase58()).toBe(source.address)
  expect(result.filename).toMatch(/private-key\.txt$/);expect(result.mimeType).toBe('text/plain')
 })
 it.each(['keypair','base58'] as const)('exports every named wallet in a %s bundle backup without omitting recipients',format=>{
  const sources=[wallet('Creator'),wallet('Buyer'),wallet('Recipient')],result=buildPrivateWalletBackup(sources,format),parsed=parseWalletImport(result.content)
  expect(parsed.map(value=>({name:value.name,address:value.publicKey}))).toEqual(sources.map(value=>({name:value.name,address:value.address})))
  expect(result.filename).toMatch(/wallets.*\.json$/)
 })
 it('refuses the entire export when any selected wallet is locked',()=>{
  const source=wallet(),locked={...wallet('Locked'),readKeypair:()=>null}
  expect(()=>buildPrivateWalletBackup([source,locked],'keypair')).toThrow(/unlock|locked/i)
 })
 it('refuses a signing key whose public address differs from the reviewed wallet',()=>{
  const source=wallet(),other=Keypair.generate()
  expect(()=>buildPrivateWalletBackup([{...source,readKeypair:()=>other}],'base58')).toThrow(/match|changed/i)
 })
 it('refuses a wallet locked while export material is being prepared',()=>{
  const source=wallet(),read=source.readKeypair;let opened=true
  source.readKeypair=()=>{if(!opened)return null;opened=false;return read()}
  expect(()=>buildPrivateWalletBackup([source],'keypair')).toThrow(/unlock|locked|changed/i)
 })
 it('rejects duplicate, malformed, empty or oversized selections and unsupported formats',()=>{
  const source=wallet()
  expect(()=>buildPrivateWalletBackup([source,{...source,id:'another'}],'keypair')).toThrow(/distinct|duplicate/i)
  expect(()=>buildPrivateWalletBackup([{...source,address:'not-a-solana-address'}],'keypair')).toThrow(/address|wallet/i)
  expect(()=>buildPrivateWalletBackup([],'keypair')).toThrow(/one|wallet/i)
  expect(()=>buildPrivateWalletBackup(Array.from({length:101},()=>source),'keypair')).toThrow(/100|wallet/i)
  expect(()=>buildPrivateWalletBackup([source],'unsupported' as 'keypair')).toThrow(/format/i)
 })
 it('retains all100wallets in a single named export and restricts filenames to public safe characters',()=>{
  const sources=Array.from({length:100},(_,index)=>wallet(`Wallet ${index+1}`)),result=buildPrivateWalletBackup(sources,'keypair'),parsed=JSON.parse(result.content)
  expect(parsed.wallets.length).toBe(100)
  expect(parsed.wallets.every((row:{publicKey:string},index:number)=>row.publicKey===sources[index].address)).toBe(true)
  expect(result.filename).toMatch(/^[a-z0-9._-]+$/)
  const named=buildPrivateWalletBackup([wallet('Buyer / private 🔑')],'keypair')
  expect(named.filename).toMatch(/^[a-z0-9._-]+$/)
 })
})
