import type {WalletLibraryState} from '@/stores/walletLibraryStore'
import type {SniperPairState} from '@/stores/sniperPairStore'
import type {WalletSummary} from '@/lib/walletLibrary/types'
import {parseWalletImport} from '@/lib/walletLibrary/import'
import {sniperPairAddress,sniperPairName,validateSniperPairs,type SniperPairInput} from './catalog'
import type {ParsedSniperSessionBackup} from './sessionBackup'

export interface SniperSessionSetupPorts {
 readLibrary:()=>Pick<WalletLibraryState,'wallets'|'revision'|'hydrated'|'storageUnavailable'|'createWallets'|'importWallets'|'renameWallet'>
 readPairs:()=>Pick<SniperPairState,'pairs'|'revision'|'hydrated'|'storageUnavailable'|'addPairs'>
 assertAvailable:()=>void
}
export interface SniperSessionSetupResult {pairIds:string[];deployerId?:string;name:string}
export interface SniperSessionUnlockPorts {readLibrary:()=>Pick<WalletLibraryState,'wallets'|'revision'|'storageUnavailable'|'unlockWallets'|'getKeypair'>;assertAvailable:()=>void}
let operationActive=false
const message=(error:unknown)=>error instanceof Error?error.message:'The session could not be saved.'
const pairSnapshot=(ports:SniperSessionSetupPorts)=>{const state=ports.readPairs();return JSON.stringify({revision:state.revision,storageUnavailable:state.storageUnavailable,pairs:state.pairs})}
function coordinator(ports:SniperSessionSetupPorts){
 const initial=ports.readLibrary(),catalog=ports.readPairs(),snapshot=pairSnapshot(ports);let revision=initial.revision,saved=0
 if(!initial.hydrated||initial.storageUnavailable||!catalog.hydrated||catalog.storageUnavailable)throw new Error('Wallet or pair storage is unavailable. Preserve browser data and reload before continuing.')
 const assert=()=>{ports.assertAvailable();const library=ports.readLibrary();if(!library.hydrated||library.storageUnavailable||library.revision!==revision)throw new Error('The wallet library changed. Review the session again.');if(pairSnapshot(ports)!==snapshot)throw new Error('The pair catalog changed. Review the session again.')}
 const after=(created=0)=>{saved+=created;const current=ports.readLibrary();if(current.revision!==revision+1)throw new Error('The wallet library changed while saving. Review the encrypted wallets in Wallets.');revision=current.revision;assert()}
 const failure=(error:unknown)=>new Error(saved?`${saved} new wallet${saved===1?' was':'s were'} encrypted and saved in Wallets. ${message(error)} Your saved keys were preserved; pair setup did not finish.`:message(error))
 assert();return{assert,after,failure}
}
async function exclusive<T>(action:()=>Promise<T>):Promise<T>{if(operationActive)throw new Error('Finish the current session setup before starting another.');operationActive=true;try{return await action()}finally{operationActive=false}}
function label(index:number):string{return index<26?String.fromCharCode(65+index):`A${String.fromCharCode(65+index-26)}`}
function validatePassphrase(passphrase:string){if(typeof passphrase!=='string'||passphrase.length<12)throw new Error('Use an encryption passphrase of at least 12 characters.')}
/** Unlock only the exact reviewed session wallets, including its separate
 * deployer. Already unlocked keys are preserved; later batches can fail safely. */
export function unlockSniperSessionWallets(wallets:readonly WalletSummary[],passphrase:string,ports:SniperSessionUnlockPorts):Promise<number>{return exclusive(async()=>{
 if(!passphrase)throw new Error('Enter the passphrase for these session wallets.')
 if(!wallets.length||wallets.length>100)throw new Error('Select between one and 100 session wallets to unlock.')
 const chosen=wallets.map(wallet=>({id:wallet.id,address:sniperPairAddress(wallet.publicKey)})),initial=ports.readLibrary(),revision=initial.revision
 if(new Set(chosen.map(wallet=>wallet.id)).size!==chosen.length||new Set(chosen.map(wallet=>wallet.address)).size!==chosen.length)throw new Error('Session wallet roles must be distinct.')
 const assert=()=>{ports.assertAvailable();const current=ports.readLibrary();if(current.storageUnavailable||current.revision!==revision||chosen.some(wallet=>!current.wallets.some(row=>row.id===wallet.id&&row.publicKey===wallet.address)))throw new Error('The session wallet selection or library changed. Review and unlock again.')}
 let opened=0
 try{
  assert();const locked=chosen.filter(wallet=>ports.readLibrary().getKeypair(wallet.id)?.publicKey.toBase58()!==wallet.address)
  for(let index=0;index<locked.length;index+=20){assert();const chunk=locked.slice(index,index+20);await ports.readLibrary().unlockWallets(chunk.map(wallet=>wallet.id),passphrase);opened+=chunk.length;assert();if(locked.slice(0,index+chunk.length).some(wallet=>ports.readLibrary().getKeypair(wallet.id)?.publicKey.toBase58()!==wallet.address))throw new Error('A session wallet was locked or changed while unlocking.')}
  if(chosen.some(wallet=>ports.readLibrary().getKeypair(wallet.id)?.publicKey.toBase58()!==wallet.address))throw new Error('A session wallet was locked again. Review and unlock the remaining wallets.')
  return chosen.length
 }catch(error){throw new Error(opened?`${opened} additional wallet${opened===1?' was':'s were'} unlocked before this stopped. ${message(error)} Some wallets may still be locked; unlock those separately if their passphrases differ.`:message(error))}
})}
/** Generates the complete session in encrypted batches. A later interruption
 * never deletes a wallet already saved by the existing encrypted library. */
export function generateSniperSession(input:{count:number;includeDeployer:boolean;passphrase:string},ports:SniperSessionSetupPorts):Promise<SniperSessionSetupResult>{return exclusive(async()=>{
 validatePassphrase(input.passphrase);if(!Number.isInteger(input.count)||input.count<1||input.count>16)throw new Error('Generate between one and 16 sniper pairs.')
 const control=coordinator(ports)
 try{
  const current=ports.readLibrary(),catalog=ports.readPairs(),total=input.count*2+Number(input.includeDeployer)
  if(current.wallets.length+total>100)throw new Error('The encrypted library supports at most 100 wallets. Choose fewer pairs.')
  if(catalog.pairs.length+input.count>50)throw new Error('Save at most 50 reusable sniper pairs.')
  const used=new Set(catalog.pairs.map(pair=>pair.name.toLocaleLowerCase('en-US'))),names=new Set(current.wallets.map(wallet=>wallet.name.toLocaleLowerCase('en-US')))
  const labels=Array.from({length:50},(_,index)=>label(index)).filter(value=>!used.has(value.toLowerCase())&&!names.has(`${value} Sniper`.toLowerCase())&&!names.has(`${value} Token Receiver`.toLowerCase())).slice(0,input.count)
  if(labels.length!==input.count)throw new Error('Not enough unused A–AX pair labels remain. Review existing pairs and wallets first.')
  let deployerName='Session deployer',suffix=1;while(names.has(deployerName.toLowerCase()))deployerName=`Session deployer ${++suffix}`
  const targetNames=[...(input.includeDeployer?[deployerName]:[]),...labels.flatMap(name=>[`${name} Sniper`,`${name} Token Receiver`])],created:WalletSummary[]=[]
  while(created.length<total){control.assert();const chunk=await ports.readLibrary().createWallets({count:Math.min(20,total-created.length),prefix:'New sniper session',passphrase:input.passphrase});created.push(...chunk);control.after(chunk.length)}
  for(let index=0;index<created.length;index++){control.assert();await ports.readLibrary().renameWallet(created[index].id,targetNames[index]);control.after()}
  control.assert();const offset=Number(input.includeDeployer),pairs=ports.readPairs().addPairs(labels.map((name,index)=>({name,sniperWalletId:created[offset+index*2].id,sniperAddress:created[offset+index*2].publicKey,receiverWalletId:created[offset+index*2+1].id,receiverAddress:created[offset+index*2+1].publicKey})))
  return{pairIds:pairs.map(pair=>pair.id),...(input.includeDeployer?{deployerId:created[0].id}:{}),name:'Sniper session'}
 }catch(error){throw control.failure(error)}
})}
function restorationPlan(input:ParsedSniperSessionBackup,ports:SniperSessionSetupPorts){
 const name=sniperPairName(input.name),pairs=validateSniperPairs(input.pairs.map((pair,index)=>({id:`restore-${index}`,name:pair.name,sniperWalletId:pair.sniperAddress,sniperAddress:pair.sniperAddress,receiverWalletId:pair.receiverAddress,receiverAddress:pair.receiverAddress,createdAt:'1970-01-01T00:00:00.000Z'}))),deployerAddress=input.deployerAddress?sniperPairAddress(input.deployerAddress):undefined
 const addresses=pairs.flatMap(pair=>[pair.sniperAddress,pair.receiverAddress]);if(deployerAddress){if(addresses.includes(deployerAddress))throw new Error('The deployer must be separate from every pair.');addresses.push(deployerAddress)}
 if(!pairs.length||addresses.length>100||!Array.isArray(input.wallets)||input.wallets.length!==addresses.length)throw new Error('The session must contain every referenced wallet, up to 100 wallets.')
 const validated=input.wallets.flatMap((_,index)=>index%20?[]:parseWalletImport(JSON.stringify({wallets:input.wallets.slice(index,index+20)}))),walletAddresses=validated.map(wallet=>wallet.publicKey)
 if(new Set(walletAddresses).size!==walletAddresses.length||walletAddresses.some(address=>!addresses.includes(address))||addresses.some(address=>!walletAddresses.includes(address)))throw new Error('Session wallet addresses must be distinct and match every pair role.')
 const catalog=ports.readPairs(),matches=pairs.map(pair=>{
  const match=catalog.pairs.find(existing=>existing.sniperAddress===pair.sniperAddress&&existing.receiverAddress===pair.receiverAddress)
  if(catalog.pairs.some(existing=>existing.id!==match?.id&&existing.name.toLowerCase()===pair.name.toLowerCase()))throw new Error(`Pair name ${pair.name} belongs to a different pair. Rename it before importing this session.`)
  if(catalog.pairs.some(existing=>existing.id!==match?.id&&[existing.sniperAddress,existing.receiverAddress].some(address=>address===pair.sniperAddress||address===pair.receiverAddress)))throw new Error('A session wallet is already assigned to a different pair. Review the pair roles before importing.')
  return match
 })
 if(catalog.pairs.length+matches.filter(pair=>!pair).length>50)throw new Error('The session exceeds the 50-pair catalog capacity.')
 const library=ports.readLibrary(),missing=validated.filter(wallet=>!library.wallets.some(existing=>existing.publicKey===wallet.publicKey))
 if(library.wallets.length+missing.length>100)throw new Error('The restored session exceeds the 100-wallet library capacity.')
 return{name,pairs,matches,deployerAddress,missing}
}
/** Restores missing keys in encrypted chunks, then rebuilds public pair roles.
 * Existing wallets keep their identity, names and original encryption. */
export function restoreSniperSession(input:ParsedSniperSessionBackup,passphrase:string,ports:SniperSessionSetupPorts):Promise<SniperSessionSetupResult>{return exclusive(async()=>{
 validatePassphrase(passphrase);const control=coordinator(ports)
 try{
  const plan=restorationPlan(input,ports)
  for(let index=0;index<plan.missing.length;index+=20){control.assert();const chunk=plan.missing.slice(index,index+20),created=await ports.readLibrary().importWallets({prefix:'Restored session',passphrase,text:JSON.stringify({wallets:chunk.map(wallet=>({name:wallet.name,publicKey:wallet.publicKey,privateKey:wallet.secretKeyBase58}))})});control.after(created.length)}
  control.assert();const wallet=(address:string)=>{const matches=ports.readLibrary().wallets.filter(wallet=>wallet.publicKey===address);if(matches.length!==1)throw new Error('A restored wallet is missing or ambiguous. Review Wallets before continuing.');return matches[0]}
  const inputs:SniperPairInput[]=plan.pairs.flatMap((pair,index)=>plan.matches[index]?[]:[{name:pair.name,sniperWalletId:wallet(pair.sniperAddress).id,sniperAddress:pair.sniperAddress,receiverWalletId:wallet(pair.receiverAddress).id,receiverAddress:pair.receiverAddress}]),added=inputs.length?ports.readPairs().addPairs(inputs):[]
  const pairIds=plan.pairs.map((pair,index)=>plan.matches[index]?.id??added.find(value=>value.sniperAddress===pair.sniperAddress&&value.receiverAddress===pair.receiverAddress)!.id)
  return{pairIds,...(plan.deployerAddress?{deployerId:wallet(plan.deployerAddress).id}:{}),name:plan.name}
 }catch(error){throw control.failure(error)}
})}
