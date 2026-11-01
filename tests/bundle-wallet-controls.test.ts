import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {createBundleWalletControlScope,createLaunchWalletControlScope,type BundleControlLibrary,type BundleControlConfig} from '../src/lib/bundler/walletControls'
import {prepareBundleWalletControlStorage,bundleWalletRouteStorage,launchWalletControlMint} from '../src/lib/bundler/walletControls'
import {readRelayRoutes,saveRelayRoute} from '../src/lib/relay/routes'
const summary=(id:string,key:Keypair)=>({id,name:id,publicKey:key.publicKey.toBase58(),createdAt:'2026-11-01T00:00:00.000Z'})
function fixture(){
 const creator=Keypair.generate(),buyer=Keypair.generate(),recipient=Keypair.generate(),unrelated=Keypair.generate(),keys=new Map([['creator',creator],['buyer',buyer],['recipient',recipient],['unrelated',unrelated]])
 const library:BundleControlLibrary={revision:1,storageUnavailable:false,wallets:[summary('creator',creator),summary('buyer',buyer),summary('recipient',recipient),summary('unrelated',unrelated)],groups:[{id:'group',walletIds:['creator','buyer']}],unlockedIds:[...keys.keys()],getKeypair:id=>keys.get(id)??null}
 const config:BundleControlConfig={creatorPublicKey:creator.publicKey.toBase58(),creatorPrivateKey:'',managedGroupId:'group',managedCreatorWalletId:'creator',bundleWallets:[{id:0,libraryWalletId:'buyer',publicKey:buyer.publicKey.toBase58(),privateKey:'',isValid:true,buyAmount:0,transferTo:recipient.publicKey.toBase58()}]}
 return {creator,buyer,recipient,unrelated,keys,library,config}
}
describe('bundle-scoped live wallet controls',()=>{
 it('includes creator, configured zero-buy buyers and controlled recipients without unrelated library wallets',()=>{
  const f=fixture(),scope=createBundleWalletControlScope(()=>f.config,()=>f.library)
  expect(scope.wallets.map(row=>row.id)).toEqual(['creator','buyer','recipient'])
  expect(scope.roles).toMatchObject({creator:'creator',buyer:'buyer',recipient:'recipient'})
  expect(scope.getKeypair('recipient')?.publicKey.toBase58()).toBe(f.recipient.publicKey.toBase58())
  expect(scope.resolveWallet('unrelated')).toBeNull()
 })
 it('binds the public review to source membership and recipient addresses',()=>{
  const f=fixture(),scope=createBundleWalletControlScope(()=>f.config,()=>f.library)
  f.config.bundleWallets[0].transferTo=Keypair.generate().publicKey.toBase58()
  expect(()=>scope.assertCurrent()).toThrow(/changed|review/i)
  expect(scope.getKeypair('creator')).toBeNull()
 })
 it('keeps session keys in their live source and refuses cleared or mismatched private keys',()=>{
  const f=fixture();f.config.managedGroupId=undefined;f.config.managedCreatorWalletId=undefined;f.config.creatorPrivateKey=bs58.encode(f.creator.secretKey);f.config.bundleWallets[0].libraryWalletId=undefined;f.config.bundleWallets[0].privateKey=bs58.encode(f.buyer.secretKey)
  const scope=createBundleWalletControlScope(()=>f.config,()=>f.library),buyer=scope.wallets.find(row=>scope.roles[row.id]==='buyer')!
  expect(scope.getKeypair(buyer.id)?.publicKey.toBase58()).toBe(f.buyer.publicKey.toBase58())
  f.config.bundleWallets[0].privateKey=bs58.encode(f.unrelated.secretKey)
  expect(scope.getKeypair(buyer.id)).toBeNull()
  f.config.bundleWallets[0].privateKey='';expect(scope.getKeypair(buyer.id)).toBeNull()
 })
 it('controls creator and buyer keys supplied as standard Solana JSON keypair arrays',()=>{
  const f=fixture();f.config.managedGroupId=undefined;f.config.managedCreatorWalletId=undefined;f.config.creatorPrivateKey=JSON.stringify(Array.from(f.creator.secretKey));f.config.bundleWallets[0].libraryWalletId=undefined;f.config.bundleWallets[0].privateKey=JSON.stringify(Array.from(f.buyer.secretKey))
  const scope=createBundleWalletControlScope(()=>f.config,()=>f.library)
  for(const role of ['creator','buyer']){const wallet=scope.wallets.find(row=>scope.roles[row.id]===role)!;expect(scope.getKeypair(wallet.id)?.publicKey.toBase58()).toBe(wallet.publicKey)}
 })
 it('invalidates a signer after library lock and replacement even at the same public address',()=>{
  const f=fixture(),scope=createBundleWalletControlScope(()=>f.config,()=>f.library)
  expect(scope.getKeypair('buyer')).toBe(f.buyer)
  f.keys.delete('buyer');expect(scope.getKeypair('buyer')).toBeNull()
  f.keys.set('buyer',Keypair.fromSecretKey(f.buyer.secretKey));expect(scope.getKeypair('buyer')).toBeNull()
 })
 it('shows unowned recipients for inspection without inventing a signer',()=>{
  const f=fixture(),address=Keypair.generate().publicKey.toBase58();f.config.bundleWallets[0].transferTo=address
  const scope=createBundleWalletControlScope(()=>f.config,()=>f.library),row=scope.wallets.find(row=>row.publicKey===address)!
  expect(row).toBeDefined();expect(scope.roles[row.id]).toBe('recipient');expect(scope.getKeypair(row.id)).toBeNull();expect(scope.readOnlyIds).toContain(row.id)
 })
 it('deduplicates a recipient already represented by a creator wallet',()=>{
  const f=fixture();f.config.bundleWallets[0].transferTo=f.creator.publicKey.toBase58()
  expect(createBundleWalletControlScope(()=>f.config,()=>f.library).wallets.map(row=>row.id)).toEqual(['creator','buyer'])
 })
 it('includes only explicitly attached additional recipients and stores no private key in its public revision',()=>{
  const f=fixture(),scope=createBundleWalletControlScope(()=>f.config,()=>f.library,{recipientIds:['unrelated','missing']})
  expect(scope.wallets.map(row=>row.id)).toEqual(['creator','buyer','recipient','unrelated'])
  expect(scope.roles.unrelated).toBe('recipient');expect(scope.getKeypair('unrelated')).toBe(f.unrelated)
  expect(scope.revision.includes(bs58.encode(f.creator.secretKey))).toBe(false)
 })
 it('restores only known receipt actors after refresh and binds imported keys by exact public address',()=>{
  const f=fixture(),config:BundleControlConfig={creatorPublicKey:null,creatorPrivateKey:'',bundleWallets:[],result:{submissions:[{payer:f.creator.publicKey.toBase58()},{payer:f.buyer.publicKey.toBase58()}],tokenTransfers:[{payer:f.buyer.publicKey.toBase58(),recipient:f.recipient.publicKey.toBase58()}]}}
  const scope=createBundleWalletControlScope(()=>config,()=>f.library)
  expect(scope.wallets.map(row=>row.id)).toEqual(['creator','buyer','recipient']);expect(scope.getKeypair('buyer')).toBe(f.buyer);expect(scope.resolveWallet('unrelated')).toBeNull()
  f.library.wallets=f.library.wallets.filter(row=>row.id!=='buyer');f.keys.delete('buyer')
  const restored=createBundleWalletControlScope(()=>config,()=>f.library),uncontrolled=restored.wallets.find(row=>row.publicKey===f.buyer.publicKey.toBase58())!
  expect(restored.readOnlyIds).toContain(uncontrolled.id);expect(restored.getKeypair(uncontrolled.id)).toBeNull()
 })
 it('binds inline source wallets and a platform creator while preserving explicit external read-only identity',()=>{
  const f=fixture(),launch={usePlatformWallet:true,bundleSettings:{wallets:[{walletId:'buyer',publicKey:f.buyer.publicKey.toBase58(),name:'Buyer',buySol:0,delaySeconds:0,transferTo:f.recipient.publicKey.toBase58()}]}}
  const platform={getSelectedAddress:()=>f.creator.publicKey.toBase58(),getKeypair:()=>f.creator}
  const scope=createLaunchWalletControlScope(()=>launch,()=>f.library,()=>platform,()=>f.creator.publicKey.toBase58())
  expect(scope.wallets.map(row=>row.id)).toEqual(['creator','buyer','recipient']);expect(scope.getKeypair('creator')).toBe(f.creator)
  launch.usePlatformWallet=false
  expect(()=>scope.assertCurrent()).toThrow(/changed|review/i)
  const external=createLaunchWalletControlScope(()=>launch,()=>f.library,()=>platform,()=>f.creator.publicKey.toBase58())
  expect(external.getKeypair(external.wallets[0].id)).toBeNull();expect(external.readOnlyIds).toContain(external.wallets[0].id)
 })
 it('supports the legacy platform getter rebuilding a keypair while still refusing a live lock',()=>{
  const f=fixture();f.library.wallets=f.library.wallets.filter(wallet=>wallet.id!=='creator');let available=true
  const launch={usePlatformWallet:true,bundleSettings:{wallets:[]}},platform={getSelectedAddress:()=>f.creator.publicKey.toBase58(),getKeypair:()=>available?Keypair.fromSecretKey(f.creator.secretKey):null}
  const scope=createLaunchWalletControlScope(()=>launch,()=>f.library,()=>platform),id=scope.wallets[0].id
  expect(scope.getKeypair(id)?.publicKey.toBase58()).toBe(f.creator.publicKey.toBase58());expect(scope.getKeypair(id)?.publicKey.toBase58()).toBe(f.creator.publicKey.toBase58())
  available=false;expect(scope.getKeypair(id)).toBeNull()
 })
 it('restores known inline receipt actors when their mint matches the active project',()=>{
  const f=fixture(),mint=Keypair.generate().publicKey,launch={usePlatformWallet:false,bundleSettings:{wallets:[]},getMintKeypair:()=>({publicKey:mint}),receipt:{mint:mint.toBase58(),creatorFeeRouting:{payer:f.creator.publicKey.toBase58()},bundleExecution:{transfers:[{payer:f.buyer.publicKey.toBase58(),recipient:f.recipient.publicKey.toBase58()}]}}}
  const scope=createLaunchWalletControlScope(()=>launch,()=>f.library,()=>({getSelectedAddress:()=>null,getKeypair:()=>null}))
  expect(scope.wallets.map(wallet=>wallet.id)).toEqual(['creator','buyer','recipient']);expect(scope.getKeypair('buyer')).toBe(f.buyer)
  launch.getMintKeypair=()=>({publicKey:Keypair.generate().publicKey})
  const changed=createLaunchWalletControlScope(()=>launch,()=>f.library,()=>({getSelectedAddress:()=>null,getKeypair:()=>null}))
  expect(changed.wallets).toEqual([])
 })
 it('controls only public inline draft buyers and recipients after a cold restoration',()=>{
  const f=fixture(),draft=JSON.parse(JSON.stringify({usePlatformWallet:false,bundleSettings:{wallets:[{walletId:'buyer',name:'Saved buyer',publicKey:f.buyer.publicKey.toBase58(),transferTo:f.recipient.publicKey.toBase58()}]}}))
  const scope=createLaunchWalletControlScope(()=>draft,()=>f.library,()=>({getSelectedAddress:()=>null,getKeypair:()=>null}))
  expect(scope.wallets.map(row=>row.id)).toEqual(['buyer','recipient']);expect(scope.getKeypair('buyer')).toBe(f.buyer);expect(scope.getKeypair('unrelated')).toBeNull()
 })
 it('preserves attached recipients and address-bound Relay routes when a zero-buy wallet disappears from a cold receipt',()=>{
  const f=fixture(),zero=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58(),disk=new Map<string,string>(),storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}}
  f.config.bundleWallets.push({id:1,publicKey:zero.publicKey.toBase58(),privateKey:bs58.encode(zero.secretKey),isValid:true,buyAmount:0});f.config.bundleWallets[0].transferTo=undefined
  const readScope=(ids:readonly string[]=[])=>createBundleWalletControlScope(()=>f.config,()=>f.library,{recipientIds:ids}),draft=prepareBundleWalletControlStorage('standalone',null,readScope,storage)
  storage.setItem(`outsol-bundle-recipients-v1:${draft.context}`,JSON.stringify(['unrelated']))
  const scope=readScope(['unrelated']);saveRelayRoute({name:'Buyer exit',sourceWalletId:'buyer',destinationWalletId:'unrelated'},scope.wallets,bundleWalletRouteStorage(draft.context,scope,storage))
  f.config.result={mintAddress:mint,submissions:[{payer:f.creator.publicKey.toBase58()},{payer:f.buyer.publicKey.toBase58()}]}
  prepareBundleWalletControlStorage('standalone',mint,readScope,storage)
  // A restored/imported library record may have a new local ID for the same key.
  f.library.wallets=f.library.wallets.map(row=>row.id==='buyer'?{...row,id:'restored-buyer'}:row);f.keys.set('restored-buyer',f.buyer)
  f.config.creatorPublicKey=null;f.config.managedGroupId=undefined;f.config.managedCreatorWalletId=undefined;f.config.bundleWallets=[]
  const cold=prepareBundleWalletControlStorage('standalone',mint,readScope,storage),restored=readScope(cold.ids),routes=readRelayRoutes(bundleWalletRouteStorage(cold.context,restored,storage))
  expect(cold.ids).toEqual(['unrelated']);expect(restored.wallets.map(row=>row.publicKey)).not.toContain(zero.publicKey.toBase58());expect(restored.getKeypair('unrelated')).toBe(f.unrelated)
  expect(routes).toHaveLength(1);expect(routes[0]).toMatchObject({name:'Buyer exit',sourceWalletId:'restored-buyer',destinationWalletId:'unrelated'})
  expect(cold.context).toBe(`bundle:mint-${mint}`)
 })
 it('does not bind a different active mint to an inline receipt or discover other actor contexts',()=>{
  const f=fixture(),mint=Keypair.generate().publicKey,other=Keypair.generate().publicKey,launch={usePlatformWallet:false,bundleSettings:{wallets:[]},getMintKeypair:()=>({publicKey:other}),receipt:{mint:mint.toBase58()}},disk=new Map<string,string>(),storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}}
  disk.set(`outsol-bundle-recipients-v1:launch:mint-${mint.toBase58()}`,JSON.stringify(['unrelated']))
  expect(launchWalletControlMint(launch)).toBeNull()
  const prepared=prepareBundleWalletControlStorage('launch',launchWalletControlMint(launch),()=>createLaunchWalletControlScope(()=>launch,()=>f.library,()=>({getSelectedAddress:()=>null,getKeypair:()=>null})),storage)
  expect(prepared.ids).toEqual([]);expect(prepared.context).toBe('launch:empty');expect(disk.size).toBe(1)
 })
 it('fails closed when migration cannot verify its storage write',()=>{
  const f=fixture(),disk=new Map<string,string>(),storage={getItem:(key:string)=>disk.get(key)??null,setItem:()=>{},removeItem:()=>{}},readScope=(ids:readonly string[]=[])=>createBundleWalletControlScope(()=>f.config,()=>f.library,{recipientIds:ids}),draft=prepareBundleWalletControlStorage('standalone',null,readScope,storage)
  disk.set(`outsol-bundle-recipients-v1:${draft.context}`,JSON.stringify(['unrelated']))
  expect(()=>prepareBundleWalletControlStorage('standalone',Keypair.generate().publicKey.toBase58(),readScope,storage)).toThrow(/saved|storage/i)
  expect(disk.get(`outsol-bundle-recipients-v1:${draft.context}`)).toBe(JSON.stringify(['unrelated']))
 })
 it('keeps explicitly attached recipients in the same managed group when buyers are added, and never reimports deleted routes',()=>{
  const f=fixture(),disk=new Map<string,string>(),storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}},readScope=(ids:readonly string[]=[])=>createBundleWalletControlScope(()=>f.config,()=>f.library,{recipientIds:ids})
  const first=prepareBundleWalletControlStorage('standalone',null,readScope,storage,{groupId:'group'});storage.setItem(`outsol-bundle-recipients-v1:${first.context}`,JSON.stringify(['unrelated']))
  f.config.bundleWallets.push({id:1,publicKey:Keypair.generate().publicKey.toBase58(),privateKey:'',isValid:true,buyAmount:0})
  const next=prepareBundleWalletControlStorage('standalone',null,readScope,storage,{groupId:'group'})
  expect(next.ids).toEqual(['unrelated']);expect(next.context).toBe('standalone:group-group')
  const scope=readScope(next.ids),routes=bundleWalletRouteStorage(next.context,scope,storage);saveRelayRoute({name:'Exit',sourceWalletId:'buyer',destinationWalletId:'unrelated'},scope.wallets,routes)
  const mint=Keypair.generate().publicKey.toBase58(),bound=prepareBundleWalletControlStorage('standalone',mint,readScope,storage,{groupId:'group'}),boundRoutes=bundleWalletRouteStorage(bound.context,scope,storage)
  boundRoutes.setItem('outsol-relay-routes-v1','[]')
  prepareBundleWalletControlStorage('standalone',mint,readScope,storage,{groupId:'group'})
  expect(readRelayRoutes(boundRoutes)).toEqual([])
 })
 it('opens the same mint-scoped recipient and route from an inline receipt in standalone bundle controls after refresh',()=>{
  const f=fixture(),mint=Keypair.generate().publicKey,disk=new Map<string,string>(),storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},removeItem:(key:string)=>{disk.delete(key)}},launch={usePlatformWallet:false,bundleSettings:{groupId:'group',wallets:[{walletId:'buyer',name:'Buyer',publicKey:f.buyer.publicKey.toBase58()}]},getMintKeypair:()=>({publicKey:mint}),receipt:undefined as {mint:string}|undefined},inlineScope=(ids:readonly string[]=[])=>createLaunchWalletControlScope(()=>launch,()=>f.library,()=>({getSelectedAddress:()=>null,getKeypair:()=>null}),()=>f.creator.publicKey.toBase58(),{recipientIds:ids})
  const draft=prepareBundleWalletControlStorage('launch',null,inlineScope,storage,{groupId:'group'});storage.setItem(`outsol-bundle-recipients-v1:${draft.context}`,JSON.stringify(['unrelated']))
  const wallets=inlineScope(['unrelated']);saveRelayRoute({name:'Inline receiver',sourceWalletId:'buyer',destinationWalletId:'unrelated'},wallets.wallets,bundleWalletRouteStorage(draft.context,wallets,storage))
  launch.receipt={mint:mint.toBase58()};prepareBundleWalletControlStorage('launch',launchWalletControlMint(launch),inlineScope,storage,{groupId:'group'})
  const cold:BundleControlConfig={creatorPublicKey:null,creatorPrivateKey:'',bundleWallets:[],result:{mintAddress:mint.toBase58(),submissions:[{payer:f.creator.publicKey.toBase58()},{payer:f.buyer.publicKey.toBase58()}]}},standaloneScope=(ids:readonly string[]=[])=>createBundleWalletControlScope(()=>cold,()=>f.library,{recipientIds:ids}),restored=prepareBundleWalletControlStorage('standalone',cold.result?.mintAddress,standaloneScope,storage),controlled=standaloneScope(restored.ids)
  expect(restored.ids).toEqual(['unrelated']);expect(controlled.getKeypair('unrelated')).toBe(f.unrelated);expect(readRelayRoutes(bundleWalletRouteStorage(restored.context,controlled,storage))[0]).toMatchObject({sourceWalletId:'buyer',destinationWalletId:'unrelated'})
  expect(controlled.wallets.map(row=>row.id)).toEqual(['creator','buyer','unrelated'])
 })
})
