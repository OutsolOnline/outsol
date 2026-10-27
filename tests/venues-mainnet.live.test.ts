import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js'
import {OnlinePumpSdk} from '@pump-fun/pump-sdk'
import {buildCreateTransaction} from '../src/lib/pumpfun/api'
import {PUMP_SDK,bondingCurvePda} from '@pump-fun/pump-sdk'
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackMint,unpackAccount,getMetadataPointerState,getExtensionData,ExtensionType} from '@solana/spl-token'
import {unpack} from '@solana/spl-token-metadata'
import {inspectCompleteSimulation,readonlyConnection,recordLiveEvidence,simulatedAccountInfo} from './live-simulation-helpers'
import {buildLaunchLabPlan} from '../src/lib/venues/launchlab'
import {buildMeteoraPlan} from '../src/lib/venues/meteora'

function liveConnection(){
  const configured=readFileSync('.env.local','utf8').match(/^\s*RPC_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g,'')
  if(!configured)throw new Error('A private RPC is required for this opt-in simulation')
  return new Connection(configured,'confirmed')
}
const payer=new PublicKey('ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u')

async function completeSimulation(connection:Connection,transactions:VersionedTransaction[]){
  let response
  try{
    response=await (await fetch(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateBundle',params:[{encodedTransactions:transactions.map(tx=>Buffer.from(tx.serialize()).toString('base64'))},{transactionEncoding:'base64',skipSigVerify:true,replaceRecentBlockhash:true,preExecutionAccountsConfigs:transactions.map(()=>null),postExecutionAccountsConfigs:transactions.map(()=>null)}]})})).json()
  }catch{throw new Error('Read-only simulation request failed; RPC credentials suppressed')}
  if(response.error)throw new Error(`Read-only simulation error code: ${response.error.code}`)
  const value=response.result?.value
  if(value?.summary!=='succeeded'){
    const first=await connection.simulateTransaction(transactions[0],{sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed'})
    throw new Error(`Simulation failed: ${JSON.stringify(value?.summary)}; first transaction program logs: ${JSON.stringify(first.value.logs?.slice(-25))}`)
  }
  expect(value.transactionResults).toHaveLength(transactions.length)
  expect(value.transactionResults.every((result:{err:unknown})=>result.err===null)).toBe(true)
}

describe.skipIf(process.env.RUN_NATIVE_PUMP_SIMULATION!=='1')('native Pump read-only mainnet simulation',()=>{
  it.each([0n,100_000_000n])('simulates the current official create_v2 format, buy ceiling=%s, without any wallet signature',async maxBuyLamports=>{
    const connection=readonlyConnection(),online=new OnlinePumpSdk(connection),mint=Keypair.generate()
    const metadata={name:'N'.repeat(32),symbol:'S'.repeat(10),uri:'https://example.com/'.padEnd(200,'m')}
    const global=await online.fetchGlobal()
    const plan=await buildCreateTransaction({connection,mintKeypair:mint,userPublicKey:payer.toBase58(),metadata:{...metadata,description:'Read-only proof'},metadataUri:metadata.uri,initialBuyAmount:Number(maxBuyLamports)/1e9})
    if(!plan.success||!plan.transactions?.length)throw new Error('Native preparation failed; RPC credentials suppressed')
    const tokenAddress=getAssociatedTokenAddressSync(mint.publicKey,payer,false,TOKEN_2022_PROGRAM_ID)
    const result=await inspectCompleteSimulation(connection,plan.transactions,[mint.publicKey,bondingCurvePda(mint.publicKey),tokenAddress])
    const mintState=unpackMint(mint.publicKey,simulatedAccountInfo(result.postAccounts[0]),TOKEN_2022_PROGRAM_ID)
    expect(mintState.supply.toString()).toBe(global.tokenTotalSupply.toString())
    expect(mintState.mintAuthority).toBeNull();expect(mintState.freezeAuthority).toBeNull()
    const metadataPointer=getMetadataPointerState(mintState),tokenMetadata=unpack(getExtensionData(ExtensionType.TokenMetadata,mintState.tlvData)!)
    expect(metadataPointer).not.toBeNull();expect(metadataPointer!.authority).toBeNull()
    expect(metadataPointer!.metadataAddress?.equals(mint.publicKey)).toBe(true)
    expect(tokenMetadata.updateAuthority).toBeUndefined()
    expect(tokenMetadata.name).toBe(metadata.name);expect(tokenMetadata.symbol).toBe(metadata.symbol);expect(tokenMetadata.uri).toBe(metadata.uri)
    const curve=PUMP_SDK.decodeBondingCurve(simulatedAccountInfo(result.postAccounts[1]))
    expect(curve.creator.equals(payer)).toBe(true);expect(curve.complete).toBe(false)
    if(maxBuyLamports>0n)expect(unpackAccount(tokenAddress,simulatedAccountInfo(result.postAccounts[2]),TOKEN_2022_PROGRAM_ID).amount.toString()).toBe(plan.tokenAmountRaw)
    expect(await connection.getAccountInfo(mint.publicKey,'confirmed')).toBeNull()
    recordLiveEvidence({route:'pump-create',initialBuyLamports:maxBuyLamports.toString(),requiresAtomicBundle:plan.requiresAtomicBundle,packetBytes:plan.transactions.map(tx=>tx.serialize().length),unitsConsumed:result.unitsConsumed,checks:['maximum-32-10-200-byte-metadata','same-bank-complete-execution','fixed-supply','revoked-mint-freeze-authorities','immutable-metadata-pointer-to-mint','revoked-metadata-update-authority','curve-creator','exact-initial-buy-output','mint-absent-on-chain']})
  },60_000)
})

describe.skipIf(process.env.RUN_LAUNCHLAB_SIMULATION!=='1')('native LaunchLab/Bonk read-only mainnet simulation',()=>{
  it.each([['raydium-launchlab',0],['raydium-launchlab',0.1],['bonk',0],['bonk',0.1]] as const)('fully simulates %s with initial buy %s SOL without wallet signatures',async(venue,initialBuySol)=>{
    const connection=liveConnection()
    let plan
    try{plan=await buildLaunchLabPlan({connection,venue,payer,mintKeypair:Keypair.generate(),name:'Vanity Readonly Test',symbol:'VTEST',metadataUri:'https://example.com/vanity-readonly.json',initialBuySol,slippage:10,priorityFeeSol:0.0005,jitoTipLamports:10000})}
    catch(error){throw new Error(`Native venue preparation failed: ${error instanceof Error&&!error.message.includes('http')?error.message:'RPC credentials suppressed'}`)}
    expect(plan.transactions.every(tx=>tx.signatures.every(signature=>signature.every(byte=>byte===0)))).toBe(true)
    await completeSimulation(connection,plan.transactions)
    expect(await connection.getAccountInfo(plan.mint,'confirmed')).toBeNull()
    expect(plan.summary.platformFeeBps).toBe(0)
  },45_000)
})

describe.skipIf(process.env.RUN_METEORA_SIMULATION!=='1')('native Meteora DBC read-only mainnet simulation',()=>{
  it.each([0,0.1])('fully simulates new config, pool and optional buy of %s SOL without wallet signatures',async initialBuySol=>{
    const connection=liveConnection()
    let plan
    try{plan=await buildMeteoraPlan({connection,venue:'meteora-dbc',payer,mintKeypair:Keypair.generate(),name:'Vanity Readonly Test',symbol:'VTEST',metadataUri:'https://example.com/vanity-readonly.json',initialBuySol,slippage:10,priorityFeeSol:0.0005,jitoTipLamports:10000})}
    catch(error){throw new Error(`Meteora preparation failed: ${error instanceof Error&&!error.message.includes('http')?error.message:'RPC credentials suppressed'}`)}
    expect(plan.transactions.every(tx=>tx.signatures.every(signature=>signature.every(byte=>byte===0)))).toBe(true)
    await completeSimulation(connection,plan.transactions)
    expect(await connection.getAccountInfo(plan.mint,'confirmed')).toBeNull()
    expect(await connection.getAccountInfo(new PublicKey(plan.summary.configAddress),'confirmed')).toBeNull()
    expect(plan.summary.platformFeeBps).toBe(0)
  },45_000)
})
