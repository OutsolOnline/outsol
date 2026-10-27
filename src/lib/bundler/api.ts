'use client'

import {Connection,Keypair,LAMPORTS_PER_SOL,PublicKey,VersionedTransaction} from '@solana/web3.js'
import bs58 from 'bs58'
import {getRpcEndpoint} from '@/lib/rpc'
import {buildCreateTransaction,buildSellTransaction,buildNativeBuyTransaction,buildFreshNativeBuy,solToLamports} from '@/lib/pumpfun/api'
import {sendAndConfirmTransaction,signedTransactionSignature,throwIfAborted} from '@/lib/transactions/send'
import {withTimeout} from '@/lib/transactions/http'
import {createVerifiedJitoTipTransaction,submitAtomicBundle} from './jito'
import type {BundlerConfig,BundleResult,BundleWallet} from './types'
import {assertNoPendingWalletOperation} from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import type {BundleSigners} from './managedSource'
import {requireSupportedCreatorFeeSelection,parseResolvedCreatorFeeRouting,resolveCreatorFeeRouting} from '@/lib/creatorFeeRouting'
import {fetchGitHubIndividual} from '@/lib/githubRecipient'
import {verifyCreatorFeeRoutingOnChain} from '@/lib/creatorFeeRecovery'
import {validatePumpLaunchPlan} from '@/lib/transactions/validatePumpLaunchPlan'
import {validatePumpTransaction} from '@/lib/transactions/validatePumpTransaction'

export function validatePrivateKey(input:string):{valid:boolean;keypair?:Keypair;error?:string} {
  try {
    const text=input.trim()
    const parsed=text.startsWith('[')?JSON.parse(text):null
    if(parsed && (!Array.isArray(parsed)||parsed.length!==64||parsed.some((value:unknown)=>typeof value!=='number'||!Number.isInteger(value)||value<0||value>255))) throw new Error('Invalid JSON byte array')
    const bytes=parsed?new Uint8Array(parsed):bs58.decode(text)
    if (bytes.length!==64) throw new Error('Invalid length')
    return {valid:true,keypair:Keypair.fromSecretKey(bytes)}
  } catch {return {valid:false,error:'Invalid private key; use a Base58 key or a 64-byte JSON array'}}
}

function requireKey(input:string,label:string):Keypair {
  const result=validatePrivateKey(input)
  if (!result.keypair) throw new Error(`Invalid ${label} private key`)
  return result.keypair
}

export async function getBalance(publicKey:string):Promise<number> {
  return (await withTimeout(new Connection(getRpcEndpoint(),'confirmed').getBalance(new PublicKey(publicKey),'confirmed')))/LAMPORTS_PER_SOL
}

export function validateBundleConfig(config:BundlerConfig,signers?:BundleSigners):void {
  requireSupportedCreatorFeeSelection(config.creatorFeeSelection)
  if (!config.tokenName.trim() || Buffer.byteLength(config.tokenName)>32 || !config.tokenSymbol.trim() || Buffer.byteLength(config.tokenSymbol)>10) throw new Error('Token name or symbol is invalid')
  if (!config.tokenImage) throw new Error('A token image is required')
  solToLamports(config.devBuyAmount)
  if (!Number.isFinite(config.slippage) || config.slippage<0 || config.slippage>50) throw new Error('Slippage must be between 0% and 50%')
  if((config.managedCreatorWalletId||config.bundleWallets.some(wallet=>wallet.libraryWalletId&&wallet.buyAmount>0))&&!signers)throw new Error('Managed wallets require a live unlocked wallet-library source')
  const creator=signers?.creator??requireKey(config.creatorPrivateKey,'creator')
  if(config.creatorPublicKey&&creator.publicKey.toBase58()!==config.creatorPublicKey)throw new Error('Creator signer changed; review the launch again')
  if(config.bundleWallets.length>16) throw new Error('At most 16 trading wallets are supported')
  config.bundleWallets.forEach(wallet=>solToLamports(wallet.buyAmount))
  const identities=new Set([creator.publicKey.toBase58()])
  const selected=config.bundleWallets.filter(wallet=>wallet.privateKey || wallet.buyAmount>0)
  for (const wallet of selected) {
    const budget=solToLamports(wallet.buyAmount)
    if (budget===0n) continue
    const key=signers?.wallets.get(wallet.id)??(wallet.libraryWalletId?undefined:requireKey(wallet.privateKey,`wallet ${wallet.id}`))
    if(!key)throw new Error(`Wallet ${wallet.id} is locked or changed`)
    const identity=key.publicKey.toBase58()
    if(wallet.publicKey&&wallet.publicKey!==identity)throw new Error(`Wallet ${wallet.id} signer changed`)
    if (identities.has(identity)) throw new Error('Every bundle wallet must have a unique identity; duplicate wallet found')
    identities.add(identity)
    if (!Number.isFinite(wallet.delaySeconds) || wallet.delaySeconds<0 || wallet.delaySeconds>3600) throw new Error('Buy delay must be 0–3600 seconds')
    if (wallet.sellEnabled) validateSell(wallet.sellTriggerType,wallet.sellDelaySeconds,wallet.sellPercent)
  }
  const immediate=selected.filter(wallet=>wallet.buyAmount>0 && wallet.mode==='sniper')
  const tipBudget=solToLamports(config.jitoTip)
  if(tipBudget>100_000_000n || (tipBudget>0n&&tipBudget<1000n)) throw new Error('Jito tip reserve must be 0 or 0.000001–0.1 SOL')
  if (config.sniperMode==='block0') {
    if (config.bundleMode==='natural') throw new Error('Organic timing uses sequential mode, not an atomic bundle')
    if (immediate.length>3) throw new Error('Atomic mode supports up to three immediate buyers; recipient setup and metadata can reduce capacity. Move buyers to delayed mode or reduce the selection.')
    if (tipBudget<1000n) throw new Error('Atomic mode requires a Jito tip of at least 0.000001 SOL')
  }
  if (config.bundleMode==='natural' && (!Number.isFinite(config.naturalDelayMin) || !Number.isFinite(config.naturalDelayMax) || config.naturalDelayMin<0 || config.naturalDelayMax<config.naturalDelayMin || config.naturalDelayMax>3600)) throw new Error('Organic delay range must be ordered and between 0 and 3600 seconds')
  if (config.autoSellEnabled) {
    if (config.devBuyAmount<=0) throw new Error('A dev buy is required for a dev sell')
    validateSell(config.autoSellTriggerType,config.autoSellDelay,config.autoSellPercent)
  }
}

function validateSell(trigger:string,delay:number,percent:number) {
  if (trigger!=='time') throw new Error('Profit-trigger automation is unsupported; use a time-based browser action')
  if (!Number.isFinite(delay) || delay<1 || delay>3600) throw new Error('Sell delay must be 1–3600 seconds')
  if (!Number.isFinite(percent) || percent<=0 || percent>100) throw new Error('Sell percent must be above 0 and at most 100')
}

export async function buildBuyTransaction(buyer:Keypair,mintAddress:string,buyAmountSol:number,slippage=10):Promise<{success:boolean;transaction?:VersionedTransaction;error?:string}> {
  try {return {success:true,transaction:await buildNativeBuyTransaction({connection:new Connection(getRpcEndpoint(),'confirmed'),userPublicKey:buyer.publicKey.toBase58(),mintAddress,maxBuyAmountSol:buyAmountSol,slippage})}}
  catch (error) {return {success:false,error:error instanceof Error?error.message:'Failed to build native buy'}}
}

export interface ExecutionOptions {
  signal?:AbortSignal
  onReceipt?:(receipt:BundleResult)=>void
  /** Explicit transport and existing metadata also support isolated local forks. */
  connection?:Connection
  metadataUri?:string
  bundleEndpoint?:string
  /** Synchronous live lookup; rerun after awaits and at every broadcast boundary. */
  resolveSigners?:()=>BundleSigners
}
async function waitUntil(timestamp:number,signal?:AbortSignal) {
  while (Date.now()<timestamp) {
    if (signal?.aborted) throw new Error('Pending browser actions cancelled; already submitted transactions remain on-chain')
    await new Promise(resolve=>setTimeout(resolve,Math.min(500,timestamp-Date.now())))
  }
  if (signal?.aborted) throw new Error('Pending browser actions cancelled')
}

/** Native protocol builders; private keys remain in memory and never leave this browser. */
export async function executeBundleLaunch(config:BundlerConfig,onProgress:(status:string)=>void,options:ExecutionOptions={}):Promise<BundleResult> {
  let result:BundleResult={success:false,status:'failed',buySignatures:[],bundleSellSignatures:[],submittedSignatures:[]}
  const checkpoint=()=>options.onReceipt?.({...result,buySignatures:[...(result.buySignatures??[])],submittedSignatures:[...(result.submittedSignatures??[])]})
  let expectedSigners:BundleSigners|undefined
  const checkCancelled=()=>{
    throwIfAborted(options.signal);assertNoPendingWalletOperation();assertNoPendingGroupOperation()
    if(options.resolveSigners){
      const live=options.resolveSigners()
      if(expectedSigners&&(live.creator.publicKey.toBase58()!==expectedSigners.creator.publicKey.toBase58()||[...expectedSigners.wallets].some(([id,key])=>live.wallets.get(id)?.publicKey.toBase58()!==key.publicKey.toBase58())))throw new Error('A signing wallet was locked or changed; pending browser actions stopped')
    }
  }
  const progress=(message:string)=>{onProgress(message);checkCancelled()}
  try {
    checkCancelled()
    const initialSigners=options.resolveSigners?.()
    validateBundleConfig(config,initialSigners)
    const creator=initialSigners?.creator??requireKey(config.creatorPrivateKey,'creator')
    const wallets=config.bundleWallets.filter(wallet=>wallet.buyAmount>0).map(wallet=>({wallet,key:initialSigners?.wallets.get(wallet.id)??requireKey(wallet.privateKey,`wallet ${wallet.id}`)}))
    expectedSigners={creator,wallets:new Map(wallets.map(({wallet,key})=>[wallet.id,key]))}
    let mint:Keypair
    if (config.mintMode==='import') mint=requireKey(config.importedMintKey,'mint')
    else if (config.mintMode==='vanity') mint=requireKey(config.foundVanityKey??'','vanity mint')
    else if (config.mintMode==='pumpfun') throw new Error('Generate a vanity mint first or choose a random mint')
    else mint=Keypair.generate()
    const connection=options.connection??new Connection(getRpcEndpoint(),'confirmed')
    const mintAddress=mint.publicKey.toBase58()
    result={...result,mintAddress}
    progress('Checking wallet funds and launch settings…')
    await Promise.all([{key:creator,required:config.devBuyAmount+(config.sniperMode==='block0'?config.jitoTip:0)+0.03},...wallets.map(({key,wallet})=>({key,required:wallet.buyAmount+0.005}))].map(async({key,required})=>{
      const balance=await withTimeout(connection.getBalance(key.publicKey,'confirmed'))
      checkCancelled()
      if (balance<Number(solToLamports(required))) throw new Error(`Wallet ${key.publicKey.toBase58().slice(0,8)} needs at least ${required.toFixed(5)} SOL for its buy and estimated network/rent costs`)
    }))
    await waitUntil(0,options.signal)
    progress('Preparing metadata and native Pump launch. OutSol fee: 0 SOL.')
    checkCancelled()
    const creatorFeeSelection=requireSupportedCreatorFeeSelection(config.creatorFeeSelection)
    const githubRecipient=creatorFeeSelection.kind==='github'?await fetchGitHubIndividual(creatorFeeSelection.username,options.signal):undefined
    checkCancelled()
    if(githubRecipient)progress(`GitHub recipient verified: ${githubRecipient.username} · individual ID ${githubRecipient.userId}. Creator fees accrue in Pump escrow.`)
    const expectedRouting=resolveCreatorFeeRouting({selection:creatorFeeSelection,payer:creator.publicKey.toBase58(),mint:mintAddress,github:githubRecipient})
    const create=await buildCreateTransaction({metadata:{name:config.tokenName,symbol:config.tokenSymbol,description:config.tokenDescription,image:config.tokenImage??undefined,twitter:config.twitter,telegram:config.telegram,website:config.website},bannerFile:config.tokenBanner??undefined,mintKeypair:mint,userPublicKey:creator.publicKey.toBase58(),initialBuyAmount:config.devBuyAmount,slippage:config.slippage,connection,metadataUri:options.metadataUri,jitoTipLamports:Number(solToLamports(config.jitoTip)),creatorFeeSelection,githubRecipient,separateJitoTip:config.sniperMode==='block0'})
    checkCancelled()
    const createPackets=create.transactions??(create.transaction?[create.transaction]:[])
    if (!create.success || !createPackets.length || !create.nativeContext || !create.metadataUri || !create.launchPlan || !create.creatorFeeRouting) throw new Error(create.error??'Verified native create construction failed')
    const routing=parseResolvedCreatorFeeRouting(create.creatorFeeRouting)
    if(JSON.stringify(routing)!==JSON.stringify(expectedRouting))throw new Error('Prepared creator fee recipient differs from this launch')
    if(JSON.stringify(create.launchPlan.routing)!==JSON.stringify(routing)||create.launchPlan.maxBuyLamports!==solToLamports(config.devBuyAmount).toString()||create.launchPlan.metadata.name!==config.tokenName||create.launchPlan.metadata.symbol!==config.tokenSymbol||create.launchPlan.metadata.uri!==create.metadataUri||create.launchPlan.requiresAtomicBundle!==!!create.requiresAtomicBundle||create.launchPlan.jitoTipLamports!==(create.jitoTipLamports??'0')||BigInt(create.launchPlan.jitoTipLamports)>solToLamports(config.jitoTip)||create.nativeContext.curve.creator.toBase58()!==routing.effectiveCreator)throw new Error('The native plan or buyer context differs from the reviewed route, metadata or budgets')
    validatePumpLaunchPlan({...create.launchPlan,packets:createPackets})
    result={...result,creatorFeeRouting:routing}
    const immediate=wallets.filter(({wallet})=>wallet.mode==='sniper')
    const delayed=wallets.filter(({wallet})=>wallet.mode==='delayed')
    let launchTime:number
    if (config.sniperMode==='block0'||create.requiresAtomicBundle) {
      progress('Building atomic launch; no sequential fallback is permitted.')
      // Only the explicit standalone final tip may be removed. The default
      // builder can embed its tip alongside required fee configuration.
      const separateTip=create.requiresAtomicBundle&&config.sniperMode==='block0'
      if(separateTip&&(create.launchPlan.stepsByPacket.at(-1)?.length!==1||create.launchPlan.stepsByPacket.at(-1)?.[0]!=='validator-tip'))throw new Error('The launch does not provide the reviewed separate validator tip; prepare again')
      const launchPackets=separateTip?createPackets.slice(0,-1):createPackets
      const atomicBuyers=config.sniperMode==='block0'?immediate:[]
      const appendTip=config.sniperMode==='block0'
      if(launchPackets.length+atomicBuyers.length+Number(appendTip)>5)throw new Error(`This recipient and metadata need ${launchPackets.length} launch packets; atomic mode supports at most ${4-launchPackets.length} additional buyers. Shorten metadata, move buyers to delayed mode, remove the first buy, or deliberately choose another recipient.`)
      const transactions=[...launchPackets]
      const signers:Keypair[][]=launchPackets.map((_,index)=>index===0?[creator,mint]:[creator])
      let context=create.nativeContext
      for (const {wallet,key} of atomicBuyers) {
        checkCancelled()
        const built=await buildFreshNativeBuy({context,mint:mint.publicKey,payer:key.publicKey,metadata:{name:config.tokenName,symbol:config.tokenSymbol,uri:create.metadataUri},maxBuyLamports:solToLamports(wallet.buyAmount),blockhash:createPackets[0].message.recentBlockhash})
        checkCancelled()
        context=built.context;transactions.push(built.transaction);signers.push([key])
        validatePumpTransaction(built.transaction,{action:'buy',payer:key.publicKey,mint:mint.publicKey,maxSolLamports:solToLamports(wallet.buyAmount),expectedBuyCreator:routing.effectiveCreator})
      }
      const {blockhash}=await withTimeout(connection.getLatestBlockhash('confirmed'))
      checkCancelled()
      transactions.forEach(tx=>{tx.message.recentBlockhash=blockhash})
      if(appendTip){
        transactions.push(separateTip?createPackets.at(-1)!:await createVerifiedJitoTipTransaction(connection,creator.publicKey,blockhash,Number(solToLamports(config.jitoTip))))
        transactions.at(-1)!.message.recentBlockhash=blockhash
        signers.push([creator])
      }
      const validateLaunch=()=>validatePumpLaunchPlan({...create.launchPlan!,packets:separateTip?[...launchPackets,transactions.at(-1)!]:launchPackets})
      validateLaunch()
      transactions.forEach((tx,index)=>{checkCancelled();tx.sign(signers[index]);checkCancelled()})
      const signedBytes=transactions.map(tx=>Buffer.from(tx.serialize()).toString('base64'))
      const assertStable=()=>{validateLaunch();if(transactions.some((tx,index)=>Buffer.from(tx.serialize()).toString('base64')!==signedBytes[index]))throw new Error('A signed bundle packet changed. Nothing new was sent.')}
      const before=result
      const signatures=transactions.map(signedTransactionSignature)
      progress('Submitting once to Jito and checking every signature…')
      checkCancelled()
      const receipt=await submitAtomicBundle(connection,transactions,{endpoint:options.bundleEndpoint,signal:options.signal,onBroadcast:()=>{
        checkCancelled()
        assertStable()
        result={...result,status:'unknown',createSignature:signatures[0],submittedSignatures:signatures}
        checkpoint()
      }})
      if(receipt.submitted===false) result=before
      result={...result,status:receipt.status,bundleId:receipt.bundleId,error:receipt.error}
      if (receipt.status!=='confirmed') {checkpoint();return result}
      result.buySignatures=receipt.signatures.slice(launchPackets.length,appendTip?-1:undefined)
      result.status='unknown'
      launchTime=Date.now()
    } else {
      if(!create.transaction)throw new Error('A single launch transaction is unavailable; prepare an atomic launch')
      checkCancelled()
      create.transaction.sign([creator,mint])
      validatePumpLaunchPlan({...create.launchPlan,packets:[create.transaction]})
      const signedBytes=Buffer.from(create.transaction.serialize()).toString('base64')
      checkCancelled()
      const before=result
      const signature=signedTransactionSignature(create.transaction)
      progress('Submitting launch once and waiting for confirmation…')
      checkCancelled()
      const receipt=await sendAndConfirmTransaction(connection,create.transaction,{signal:options.signal,onBroadcast:()=>{
        checkCancelled()
        validatePumpLaunchPlan({...create.launchPlan!,packets:[create.transaction!]})
        if(Buffer.from(create.transaction!.serialize()).toString('base64')!==signedBytes)throw new Error('The signed launch changed. Nothing new was sent.')
        result={...result,status:'unknown',createSignature:signature,submittedSignatures:[signature]}
        checkpoint()
      }})
      if(receipt.submitted===false) result=before
      result={...result,status:receipt.status,error:receipt.error}
      if (receipt.status!=='confirmed') {checkpoint();return result}
      result.status='unknown'
      launchTime=Date.now()
    }
    await verifyCreatorFeeRoutingOnChain(connection,routing,{payer:creator.publicKey.toBase58(),mint:mintAddress})
    result.status='partial';checkpoint();checkCancelled()

    const buyQueue=config.sniperMode==='block0'?delayed:config.bundleMode==='natural'?wallets:[...immediate,...delayed.sort((a,b)=>a.wallet.delaySeconds-b.wallet.delaySeconds)]
    for (const {wallet,key} of buyQueue) {
      const due=config.bundleMode==='natural'?Date.now()+(config.naturalDelayMin+Math.random()*(config.naturalDelayMax-config.naturalDelayMin))*1000:wallet.mode==='delayed'?launchTime+wallet.delaySeconds*1000:0
      progress(`Browser action: waiting to buy from wallet ${wallet.id}… Keep this page open.`)
      await waitUntil(due,options.signal)
      checkCancelled()
      const tx=await buildNativeBuyTransaction({connection,userPublicKey:key.publicKey.toBase58(),mintAddress,maxBuyAmountSol:wallet.buyAmount,slippage:config.slippage})
      checkCancelled()
      tx.sign([key])
      checkCancelled()
      const before=result
      const signature=signedTransactionSignature(tx)
      const receipt=await sendAndConfirmTransaction(connection,tx,{signal:options.signal,onBroadcast:()=>{
        checkCancelled()
        result={...result,submittedSignatures:[...(result.submittedSignatures??[]),signature],status:'unknown'};checkpoint()
      }})
      if(receipt.submitted===false) {
        result={...before,status:before.createSignature?'partial':'failed',error:receipt.error};checkpoint();return result
      }
      if (receipt.status!=='confirmed') {result={...result,status:receipt.status,error:receipt.error};checkpoint();return result}
      result.buySignatures!.push(receipt.signature);result.status='partial';checkpoint();checkCancelled()
    }
    const sells:Array<{key:Keypair;percent:number;delay:number;wallet?:BundleWallet}>=wallets.filter(({wallet})=>wallet.sellEnabled).map(({wallet,key})=>({key,percent:wallet.sellPercent,delay:wallet.sellDelaySeconds,wallet}))
    if(config.autoSellEnabled) sells.push({key:creator,percent:config.autoSellPercent,delay:config.autoSellDelay})
    sells.sort((a,b)=>a.delay-b.delay)
    for(const sell of sells) {
      progress('Browser-only scheduled sell pending. Closing this page stops pending actions.')
      await waitUntil(launchTime+sell.delay*1000,options.signal)
      checkCancelled()
      const built=await buildSellTransaction({connection,userPublicKey:sell.key.publicKey.toBase58(),mintAddress,sellPercent:sell.percent,slippage:config.slippage})
      checkCancelled()
      if(!built.success||!built.transaction) throw new Error(built.error??'Sell could not be built')
      built.transaction.sign([sell.key])
      checkCancelled()
      const before=result
      const signature=signedTransactionSignature(built.transaction)
      const receipt=await sendAndConfirmTransaction(connection,built.transaction,{signal:options.signal,onBroadcast:()=>{
        checkCancelled()
        result={...result,submittedSignatures:[...(result.submittedSignatures??[]),signature],status:'unknown'};checkpoint()
      }})
      if(receipt.submitted===false) {
        result={...before,status:before.createSignature?'partial':'failed',error:receipt.error};checkpoint();return result
      }
      if(receipt.status!=='confirmed'){result={...result,status:receipt.status,error:receipt.error};checkpoint();return result}
      if(sell.wallet) result.bundleSellSignatures!.push(receipt.signature);else result.sellSignature=receipt.signature
      result.status='partial';checkpoint();checkCancelled()
    }
    result={...result,success:true,status:'confirmed',error:undefined};checkpoint();return result
  }catch(error){
    result={...result,success:false,status:result.status==='unknown'?'unknown':result.createSignature?'partial':'failed',error:error instanceof Error?error.message:'Launch execution failed'}
    checkpoint();return result
  }
}
