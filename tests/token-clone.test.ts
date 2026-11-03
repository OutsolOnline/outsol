import {describe,it,expect} from 'vitest'
import {Connection,Keypair,PublicKey} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token'
import {Metadata,Key,PROGRAM_ID} from '@metaplex-foundation/mpl-token-metadata'
import {createClonedDraft,fetchCloneMetadata,readCloneSource} from '../src/lib/tokenClone'
import type {TokenFacts} from '../src/lib/tokenFacts'
const mint=Keypair.generate().publicKey,other=Keypair.generate().publicKey
const facts:TokenFacts={mint:mint.toBase58(),slot:1,checkedAt:new Date().toISOString(),decimals:6,supplyRaw:'1000000',mintAuthority:null,freezeAuthority:null,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),curveAddress:other.toBase58(),curveStatus:'unverified'}
function metadata(){return Metadata.fromArgs({key:Key.MetadataV1,updateAuthority:other,mint,data:{name:'Onchain\0',symbol:'CHAIN\0',uri:'https://example.com/token.json\0',sellerFeeBasisPoints:0,creators:null},primarySaleHappened:false,isMutable:true,editionNonce:null,tokenStandard:null,collection:null,uses:null,collectionDetails:null,programmableConfig:null}).serialize()[0]}
describe('mint-address design cloning',()=>{
 it('verifies legacy metadata PDA owner and mint before using chain identity',async()=>{
  const connection={getAccountInfo:async(address:PublicKey)=>{const expected=PublicKey.findProgramAddressSync([Buffer.from('metadata'),PROGRAM_ID.toBuffer(),mint.toBuffer()],PROGRAM_ID)[0];expect(address.equals(expected)).toBe(true);return {owner:PROGRAM_ID,data:metadata(),lamports:1,executable:false}}} as unknown as Connection
  expect(await readCloneSource(connection,mint.toBase58(),async()=>facts)).toMatchObject({name:'Onchain',symbol:'CHAIN',metadataUri:'https://example.com/token.json'})
  const bad={getAccountInfo:async()=>({owner:other,data:metadata()})} as unknown as Connection
  await expect(readCloneSource(bad,mint.toBase58(),async()=>facts)).rejects.toThrow()
  await expect(readCloneSource(connection,other.toBase58(),async()=>facts)).rejects.toThrow()
 })
 it('uses verified embedded Token-2022 fields without assuming an unrelated external metadata PDA',async()=>{
  let calls=0;const connection={getAccountInfo:async()=>{calls++;throw new Error()}} as unknown as Connection
  expect(await readCloneSource(connection,mint.toBase58(),async()=>({...facts,tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),name:'Embedded',symbol:'EMB',metadataUri:'https://example.com/embedded.json'}))).toMatchObject({name:'Embedded',symbol:'EMB'})
  expect(calls).toBe(0)
 })
 it('makes bounded browser CORS metadata reads without credentials, redirects or server proxies',async()=>{
  const result=await fetchCloneMetadata('https://example.com/token.json',undefined,async(url,options)=>{expect(url).toBe('https://example.com/token.json');expect(options).toMatchObject({mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});return Response.json({description:'Public description',image:'https://example.com/token.png',twitter:'https://x.com/example'})})
  expect(result).toMatchObject({description:'Public description',imageUrl:'https://example.com/token.png',twitter:'https://x.com/example'})
 })
 it.each(['http://example.com/a','https://127.0.0.1/a','https://user:secret@example.com/a','data:application/json,{}','file:///a'])('rejects unsafe metadata URI %s before fetching',async uri=>{
  let calls=0;await expect(fetchCloneMetadata(uri,undefined,async()=>{calls++;return Response.json({})})).rejects.toThrow();expect(calls).toBe(0)
 })
 it('rejects oversized metadata and unsafe image URLs and creates only a new default draft',async()=>{
  await expect(fetchCloneMetadata('https://example.com/a',undefined,async()=>new Response('{}',{headers:{'content-length':'131073','content-type':'application/json'}}))).rejects.toThrow()
  const safe=await fetchCloneMetadata('https://example.com/a',undefined,async()=>Response.json({image:'javascript:alert(1)',description:'Text'}))
  expect(safe.imageUrl).toBeUndefined();expect(safe.warnings.length).toBeGreaterThan(0)
  const draft=createClonedDraft({name:'New token',symbol:'NEW',description:'Editable',website:'https://example.com'})
  expect(draft).toMatchObject({metadataUri:'',config:{venue:'pump',devBuySol:0,creatorFeeSelection:{kind:'deployer'}}})
  expect(draft.bundleSettings?.wallets??[]).toEqual([]);expect(JSON.stringify(draft)).not.toContain(mint.toBase58())
 })
})
