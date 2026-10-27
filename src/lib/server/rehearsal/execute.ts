import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { ExtensionType, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getExtensionData, getMetadataPointerState, unpackAccount, unpackMint } from '@solana/spl-token'
import { unpack } from '@solana/spl-token-metadata'
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk'
import { buildCreateTransaction } from '@/lib/pumpfun/api'
import { confirmSignatures, signedTransactionSignature } from '@/lib/transactions/send'
import { parseRehearsalInput, rehearsalLamports } from './input'
import { acquireRehearsalRuntime, assertLoopbackEndpoint, localRuntimeRpc, releaseRehearsalRuntime, verifyRehearsalRuntime } from './runtime'
import type { RehearsalInput, RehearsalReport } from './types'
import { readBoundedResponse } from './bounded'
import {validatePumpLaunchPlan} from '@/lib/transactions/validatePumpLaunchPlan'
import {verifyCreatorFeeRoutingOnChain} from '@/lib/creatorFeeRecovery'
import {resolveGitHubIndividual} from '@/lib/server/githubRecipient'
import {resolveCreatorFeeRouting,parseResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'

function requireState(condition: unknown): asserts condition {
  if (!condition) throw new Error('The rehearsal state did not match the launch plan')
}

/** Only server-generated keys ever sign. The remote state source cannot receive sends. */
export async function executeRehearsal(rawInput: RehearsalInput, signal: AbortSignal): Promise<RehearsalReport> {
  const input = parseRehearsalInput(rawInput)
  const githubRecipient=input.creatorFeeSelection?.kind==='github'?await resolveGitHubIndividual(input.creatorFeeSelection.username,signal):undefined
  signal.throwIfAborted()
  const endpoint = await acquireRehearsalRuntime(signal)
  const payer = Keypair.generate(), mint = Keypair.generate()
  let healthy = false
  try {
    await verifyRehearsalRuntime(endpoint, signal)
    const origin = assertLoopbackEndpoint(endpoint).origin
    const guardedFetch: typeof fetch = async (resource, init) => {
      signal.throwIfAborted()
      const url = new URL(typeof resource === 'string' || resource instanceof URL ? String(resource) : resource.url)
      if (url.origin !== origin || url.pathname !== '/' || url.search || url.hash) throw new Error('Outgoing rehearsal request rejected')
      const body = JSON.parse(String(init?.body))
      if (['requestAirdrop', 'sendTransaction', 'sendBundle'].includes(body.method)) {
        await verifyRehearsalRuntime(endpoint, signal)
        signal.throwIfAborted()
      }
      if (body.method === 'requestAirdrop') requireState(body.params?.[0] === payer.publicKey.toBase58())
      if (body.method === 'sendTransaction' || body.method === 'sendBundle') {
        const packets: string[] = body.method === 'sendBundle' ? body.params[0] : [body.params[0]]
        for (const packet of packets) {
          const tx = VersionedTransaction.deserialize(Buffer.from(packet, 'base64'))
          requireState(tx.message.staticAccountKeys[0].equals(payer.publicKey))
          requireState(tx.message.staticAccountKeys.slice(0,tx.message.header.numRequiredSignatures).every(key=>key.equals(payer.publicKey)||key.equals(mint.publicKey)))
          requireState(tx.signatures.every(signature => signature.some(byte => byte !== 0)))
        }
      }
      return fetch(resource, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), redirect: 'error', cache: 'no-store' })
    }
    const connection = new Connection(endpoint, { commitment: 'confirmed', fetch: guardedFetch, disableRetryOnRateLimit: true })
    const fundingLamports=Number(rehearsalLamports(input.initialBuySol)+rehearsalLamports(input.priorityFeeSol)+rehearsalLamports(input.jitoTipSol)+1_000_000_000n)
    await connection.requestAirdrop(payer.publicKey, fundingLamports)
    const payerBefore = await connection.getBalance(payer.publicKey)
    requireState(payerBefore === fundingLamports)
    const expectedRouting=resolveCreatorFeeRouting({selection:input.creatorFeeSelection,payer:payer.publicKey.toBase58(),mint:mint.publicKey.toBase58(),github:githubRecipient})
    const built = await buildCreateTransaction({
      connection, userPublicKey: payer.publicKey.toBase58(), mintKeypair: mint,
      metadata: { name: input.name, symbol: input.symbol, description: '' }, metadataUri: input.metadataUri,
      initialBuyAmount: Number(input.initialBuySol), priorityFee: Number(input.priorityFeeSol),
      jitoTipLamports: Number(rehearsalLamports(input.jitoTipSol)),
      creatorFeeSelection:input.creatorFeeSelection,githubRecipient,
    })
    if(!built.success)throw new Error(built.error||'Native creator fee routing preparation failed')
    requireState(built.transactions?.length && built.nativeContext && built.tokenAmountRaw && built.launchPlan && built.creatorFeeRouting)
    const transactions = built.transactions
    validatePumpLaunchPlan(built.launchPlan)
    const routing=parseResolvedCreatorFeeRouting(built.creatorFeeRouting)
    requireState(transactions.length<=5&&routing.payer===payer.publicKey.toBase58()&&routing.mint===mint.publicKey.toBase58())
    requireState(JSON.stringify(built.launchPlan.routing)===JSON.stringify(routing)&&JSON.stringify(routing)===JSON.stringify(expectedRouting)&&built.launchPlan.maxBuyLamports===rehearsalLamports(input.initialBuySol).toString()&&built.launchPlan.firstBuyTokenAmountRaw===built.tokenAmountRaw&&BigInt(built.launchPlan.maxPriorityFeeLamports)<=rehearsalLamports(input.priorityFeeSol)&&BigInt(built.launchPlan.jitoTipLamports)<=rehearsalLamports(input.jitoTipSol)&&built.launchPlan.metadata.name===input.name&&built.launchPlan.metadata.symbol===input.symbol&&built.launchPlan.metadata.uri===input.metadataUri&&built.launchPlan.requiresAtomicBundle===!!built.requiresAtomicBundle)
    // The native create path has no lookup tables. Refuse a changed packet format
    // until its lookup accounts can be hydrated and inspected explicitly.
    requireState(transactions.every(tx => tx.message.addressTableLookups.length === 0))
    const keys = [...new Map(transactions.flatMap(tx => tx.message.staticAccountKeys).map(key => [key.toBase58(), key])).values()]
    for (let index = 0; index < keys.length; index += 100) await connection.getMultipleAccountsInfo(keys.slice(index, index + 100))
    for (const transaction of transactions) {
      requireState(transaction.message.staticAccountKeys[0].equals(payer.publicKey))
      const required=transaction.message.staticAccountKeys.slice(0,transaction.message.header.numRequiredSignatures)
      requireState(required.every(key=>key.equals(payer.publicKey)||key.equals(mint.publicKey)))
      transaction.sign([payer,mint].filter(key=>required.some(address=>address.equals(key.publicKey))))
      requireState(transaction.signatures.every(signature => signature.some(byte => byte !== 0)))
    }
    const encoded = transactions.map(tx => Buffer.from(tx.serialize()).toString('base64'))
    const assertStable=()=>{validatePumpLaunchPlan(built.launchPlan!);requireState(transactions.every((tx,index)=>Buffer.from(tx.serialize()).toString('base64')===encoded[index]))}
    const simulated = await localRuntimeRpc<{ value?: { summary?: string; transactionResults?: { err: unknown }[] } }>(endpoint, 'simulateBundle', [
      { encodedTransactions: encoded },
      { transactionEncoding: 'base64', skipSigVerify: false, replaceRecentBlockhash: false, preExecutionAccountsConfigs: transactions.map(() => null), postExecutionAccountsConfigs: transactions.map(() => null) },
    ], signal)
    requireState(simulated.value?.summary === 'succeeded' && simulated.value.transactionResults?.length === transactions.length && simulated.value.transactionResults.every(result => result.err === null))
    assertStable()
    // Recheck the fork identity immediately before any state-changing submission.
    await verifyRehearsalRuntime(endpoint, signal)
    assertStable()
    const signatures = transactions.map(signedTransactionSignature)
    if (built.requiresAtomicBundle) {
      const response = await guardedFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded, { encoding: 'base64' }] }) })
      const acknowledgement = JSON.parse(await readBoundedResponse(response, 100000))
      requireState(response.ok && typeof acknowledgement.result === 'string' && !acknowledgement.error)
    } else {
      requireState(transactions.length === 1)
      requireState(await connection.sendRawTransaction(transactions[0].serialize(), { skipPreflight: false, maxRetries: 0 }) === signatures[0])
    }
    const confirmation = await confirmSignatures(connection, signatures, { timeoutMs: 15_000, pollIntervalMs: 150, signal })
    requireState(confirmation.status === 'confirmed')
    const curveAddress = bondingCurvePda(mint.publicKey)
    const ata = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey, false, TOKEN_2022_PROGRAM_ID)
    const [accounts, payerAfter, receipts] = await Promise.all([
      connection.getMultipleAccountsInfo([mint.publicKey, curveAddress, ata]), connection.getBalance(payer.publicKey),
      Promise.all(signatures.map(signature => connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))),
    ])
    const [mintInfo, curveInfo, tokenInfo] = accounts
    requireState(mintInfo && curveInfo)
    requireState(mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) && curveInfo.owner.equals(PUMP_PROGRAM_ID))
    const mintState = unpackMint(mint.publicKey, mintInfo, TOKEN_2022_PROGRAM_ID)
    const curve = PUMP_SDK.decodeBondingCurve(curveInfo)
    const metadataBytes = getExtensionData(ExtensionType.TokenMetadata, mintState.tlvData)
    requireState(metadataBytes)
    const metadata = unpack(metadataBytes)
    const pointer = getMetadataPointerState(mintState)
    requireState(mintState.mintAuthority === null && mintState.freezeAuthority === null)
    requireState(pointer && pointer.authority === null && pointer.metadataAddress?.equals(mint.publicKey) && metadata.updateAuthority === undefined)
    requireState(metadata.name === input.name && metadata.symbol === input.symbol && metadata.uri === input.metadataUri)
    requireState(mintState.supply.toString() === built.nativeContext.global.tokenTotalSupply.toString())
    requireState(curve.creator.toBase58()===routing.effectiveCreator && curve.isHolderReward===routing.holderReward && !curve.isCashbackCoin && !curve.complete)
    await verifyCreatorFeeRoutingOnChain(connection,routing,{payer:payer.publicKey.toBase58(),mint:mint.publicKey.toBase58()})
    const tokenState=tokenInfo?unpackAccount(ata,tokenInfo,TOKEN_2022_PROGRAM_ID):undefined
    requireState(!tokenState||(tokenState.owner.equals(payer.publicKey)&&tokenState.mint.equals(mint.publicKey)))
    const tokenAmount = tokenState?.amount??0n
    requireState(tokenAmount.toString() === built.tokenAmountRaw)
    requireState(receipts.every(receipt => receipt?.meta && receipt.meta.err === null))
    const networkFee = receipts.reduce((total, receipt) => total + BigInt(receipt!.meta!.fee), 0n)
    const totalCost = BigInt(payerBefore) - BigInt(payerAfter)
    const buyBudget = rehearsalLamports(input.initialBuySol)
    const actualTip = BigInt(built.jitoTipLamports || '0')
    requireState(totalCost > 0n && totalCost <= buyBudget + rehearsalLamports(input.priorityFeeSol) + actualTip + 100_000_000n)
    healthy = true
    return {
      network: 'local-mainnet-fork', runtimeVersion: '1.6.1', mint: mint.publicKey.toBase58(), payer: payer.publicKey.toBase58(),
      name: input.name, symbol: input.symbol, metadataUri: input.metadataUri, decimals: mintState.decimals, supplyRaw: mintState.supply.toString(), walletTokenRaw: tokenAmount.toString(),
      payerBeforeLamports: String(payerBefore), payerAfterLamports: String(payerAfter), totalCostLamports: totalCost.toString(), networkFeeLamports: networkFee.toString(),
      initialBuyLamports: buyBudget.toString(), initialBuyBudgetLamports: buyBudget.toString(), jitoTipLamports: actualTip.toString(), platformFeeLamports: '0',
      curveRealSolReservesLamports: curve.realQuoteReserves.toString(), curveRealTokenReservesRaw: curve.realTokenReserves.toString(),
      mintAuthority: null, freezeAuthority: null, metadataImmutable: true, transactionSignatures: signatures, execution: built.requiresAtomicBundle ? 'atomic-bundle' : 'single',
      unsupported: { devLock: 'not-configured', lp: 'not-configured' },
      actualCostBreakdownNote: 'Total cost is the measured local fake SOL debit from copied mainnet state and rent parameters, including the purchase, Pump fees, account rent, network fees, and any bundle tip. Initial buy is the maximum purchase budget. Prepare a fresh live preview before signing; live state and fees can change.',
      completedAt: new Date().toISOString(),
      creatorFeeRouting:routing,
      observedRouting:{creator:curve.creator.toBase58(),isHolderReward:curve.isHolderReward,isCashbackCoin:false,verifiedRecipient:routing.socialRecipient??routing.effectiveCreator,...(routing.selection.kind==='github'?{sharing:{address:routing.sharingConfig!,adminRevoked:true,shareholder:routing.socialRecipient!,shareBps:10000}}:{})},
    }
  } finally {
    // Failed or interrupted work destroys an owned VM; no late native operation
    // can alter the next user's rehearsal. Successful jobs reset all fake state.
    await releaseRehearsalRuntime(!healthy || signal.aborted)
  }
}
