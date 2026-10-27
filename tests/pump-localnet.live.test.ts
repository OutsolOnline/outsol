import { beforeAll, describe, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Signer } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount, unpackMint, getMetadataPointerState, getExtensionData, ExtensionType } from '@solana/spl-token'
import { unpack } from '@solana/spl-token-metadata'
import { OnlinePumpSdk, PUMP_SDK, PUMP_PROGRAM_ID, bondingCurvePda } from '@pump-fun/pump-sdk'
import { buildCreateTransaction, buildFreshNativeBuy, buildNativeBuyTransaction, buildNativeCreateInstructions } from '../src/lib/pumpfun/api'
import { createVerifiedJitoTipTransaction, simulateAtomicBundle, submitAtomicBundle } from '../src/lib/bundler/jito'
import { preparePumpTrade, inspectTradeIntent, readTokenPosition } from '../src/lib/venues/trade'
import { confirmSignatures, sendAndConfirmTransaction, signedTransactionSignature } from '../src/lib/transactions/send'
import { validatePumpTransaction } from '../src/lib/transactions/validatePumpTransaction'
import type { TradeInput } from '../src/lib/venues/trade'
import { executeBundleLaunch } from '../src/lib/bundler/api'
import type { BundleWallet, BundlerConfig } from '../src/lib/bundler/types'
import bs58 from 'bs58'

const endpoint = process.env.VANITY_LOCALNET_RPC || 'http://127.0.0.1:8899'
const metadata = { name: 'N'.repeat(32), symbol: 'S'.repeat(10), uri: 'https://example.com/'.padEnd(200, 'm') }
const generatedPayers = new Set<string>()
let runtimeVerified = false

function requireLocalEndpoint() {
  const parsed = new URL(endpoint)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Local execution requires an unauthenticated loopback HTTP Surfpool endpoint')
  }
}

// Every outgoing send is checked again at transport time. The payer must be a
// fresh in-memory test key; the mainnet fork's genesis is not a safety signal.
const localFetch: typeof fetch = async (input, init) => {
  requireLocalEndpoint()
  if (new URL(String(input)).origin !== new URL(endpoint).origin) throw new Error('Local test rejected an outgoing non-local request')
  const call = JSON.parse(String(init?.body))
  if (['sendTransaction', 'requestAirdrop', 'sendBundle'].includes(call.method)) {
    if (!runtimeVerified) throw new Error('Surfpool identity must be verified before local execution')
    const payers = call.method === 'requestAirdrop' ? [call.params[0]] : (call.method === 'sendBundle' ? call.params[0] : [call.params[0]]).map((encoded: string) => VersionedTransaction.deserialize(Buffer.from(encoded, 'base64')).message.staticAccountKeys[0].toBase58())
    if (payers.some((payer: string) => !generatedPayers.has(payer))) throw new Error('Only fresh test-generated payers may spend fake local SOL')
  }
  return fetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(30_000) })
}
const connection = new Connection(endpoint, { commitment: 'confirmed', fetch: localFetch, disableRetryOnRateLimit: true })

async function localRpc(method: string, params: unknown[]) {
  const response = await localFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const body = await response.json()
  if (!response.ok || body.error) throw new Error(`Local ${method} failed (${body.error?.code ?? response.status})`)
  return body.result
}

function evidence(value: Record<string, unknown>) {
  const record = { timestamp: new Date().toISOString(), proof: 'signed-local-surfpool-execution', runtime: 'surfpool', realSolSpent: false, ...value }
  if (process.env.VANITY_LIVE_EVIDENCE_FILE) appendFileSync(process.env.VANITY_LIVE_EVIDENCE_FILE, JSON.stringify(record) + '\n')
  console.log(JSON.stringify(record))
}

async function fundFreshPayer() {
  const payer = Keypair.generate(); generatedPayers.add(payer.publicKey.toBase58())
  const signature = await connection.requestAirdrop(payer.publicKey, 100_000_000_000)
  const status = await confirmSignatures(connection, [signature], { timeoutMs: 10_000, pollIntervalMs: 100 })
  expect(status.status).toBe('confirmed'); expect(await connection.getBalance(payer.publicKey)).toBeGreaterThanOrEqual(100_000_000_000)
  return payer
}

async function submitLocal(tx: VersionedTransaction, signers: Signer[]) {
  const reviewed = Buffer.from(tx.message.serialize()).toString('base64')
  expect(tx.signatures[0].every(byte => byte === 0)).toBe(true)
  tx.sign(signers)
  expect(Buffer.from(tx.message.serialize()).toString('base64')).toBe(reviewed)
  const expectedSignature = signedTransactionSignature(tx)
  const receipt = await sendAndConfirmTransaction(connection, tx, { timeoutMs: 30_000, pollIntervalMs: 100 })
  if (receipt.status !== 'confirmed') throw new Error(`Local execution failed: ${receipt.error ?? receipt.status}`)
  expect(receipt.signature).toBe(expectedSignature); expect(receipt.submitted).toBe(true)
  return receipt.signature
}

async function submitLocalBundle(transactions: VersionedTransaction[], signers: Signer[][]) {
  requireLocalEndpoint()
  if (!runtimeVerified || transactions.some(tx => !generatedPayers.has(tx.message.staticAccountKeys[0].toBase58()))) throw new Error('Only fresh fake-funded local payers may submit a bundle')
  for (let index = 0; index < transactions.length; index++) {
    const message = Buffer.from(transactions[index].message.serialize()).toString('base64')
    transactions[index].sign(signers[index])
    expect(Buffer.from(transactions[index].message.serialize()).toString('base64')).toBe(message)
  }
  // Surfpool simulateBundle does not lazy hydrate its sandbox's public accounts.
  const keys = [...new Map(transactions.flatMap(tx => tx.message.staticAccountKeys).map(key => [key.toBase58(), key])).values()]
  for (let index = 0; index < keys.length; index += 100) await connection.getMultipleAccountsInfo(keys.slice(index, index + 100))
  const payer = transactions[0].message.staticAccountKeys[0], beforeBalance = await connection.getBalance(payer)
  const simulation = await simulateAtomicBundle(connection, transactions, { verifySignatures: true, timeoutMs: 30_000, payer: payer.toBase58() })
  if (!simulation.success) {
    const diagnostic = await localRpc('simulateBundle', [{ encodedTransactions: transactions.map(tx => Buffer.from(tx.serialize()).toString('base64')) }, { transactionEncoding: 'base64', skipSigVerify: false, replaceRecentBlockhash: false, preExecutionAccountsConfigs: transactions.map(() => null), postExecutionAccountsConfigs: transactions.map(() => null) }])
    throw new Error(`Signed local bundle failed: ${JSON.stringify(diagnostic.value?.summary)}; ${JSON.stringify(diagnostic.value?.transactionResults?.map((result: { err: unknown; logs?: string[] }) => ({ err: result.err, logs: result.logs?.slice(-12) })))}`)
  }
  expect(simulation.success, simulation.error).toBe(true)
  const receipt = await submitAtomicBundle(connection, transactions, { endpoint, timeoutMs: 30_000, pollIntervalMs: 100 })
  expect(receipt.status, receipt.error).toBe('confirmed'); expect(receipt.bundleId).toBeTruthy()
  const actualDebit = BigInt(beforeBalance) - BigInt(await connection.getBalance(payer))
  expect(simulation.payerDebitLamports).toBe(actualDebit.toString())
  evidence({ route: 'payer-cost-preview', packets: transactions.length, payerDebitLamports: simulation.payerDebitLamports, actualPayerDebitLamports: actualDebit.toString(), checks: ['complete-same-bank-payer-cost', 'preview-matches-confirmed-local-debit'] })
  return { ...receipt, simulationUnitsConsumed: simulation.unitsConsumed }
}

async function tokenAmount(mint: PublicKey, payer: PublicKey) {
  const address = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_2022_PROGRAM_ID), account = await connection.getAccountInfo(address)
  return account ? unpackAccount(address, account, TOKEN_2022_PROGRAM_ID).amount : 0n
}

async function prepareLocalTrade(input: TradeInput) {
  try { return await preparePumpTrade(connection, input) }
  catch (error) {
    if (input.action !== 'buy') throw error
    const transaction = await buildNativeBuyTransaction({ connection, userPublicKey: input.payer, mintAddress: input.mint, maxBuyAmountSol: Number(input.buySol), slippage: input.slippage, priorityFee: input.priorityFeeSol })
    const bundle = await localRpc('simulateBundle', [{ encodedTransactions: [Buffer.from(transaction.serialize()).toString('base64')] }, { transactionEncoding: 'base64', skipSigVerify: true, replaceRecentBlockhash: true, preExecutionAccountsConfigs: [null], postExecutionAccountsConfigs: [null] }])
    const details = await Promise.all(transaction.message.staticAccountKeys.slice(0, 6).map(async (key, index) => ({ index, key: key.toBase58(), account: await connection.getAccountInfo(key).then(account => account ? { lamports: account.lamports, owner: account.owner.toBase58() } : null) })))
    throw new Error(`${error instanceof Error ? error.message : 'Trade failed'}; accounts ${JSON.stringify(details)}; bundle summary ${JSON.stringify(bundle.value?.summary)}; results ${JSON.stringify(bundle.value?.transactionResults?.map((item: { err: unknown; logs?: string[] }) => ({ err: item.err, logs: item.logs?.slice(-5) })))}`)
  }
}

describe.skipIf(process.env.RUN_PUMP_LOCALNET !== '1')('Pump complete signed local mainnet-fork execution', () => {
  beforeAll(async () => {
    requireLocalEndpoint()
    const version = await localRpc('getVersion', [])
    if (typeof version['surfnet-version'] !== 'string') throw new Error('Loopback endpoint is not an identified Surfpool runtime')
    const info = await localRpc('surfnet_getSurfnetInfo', [])
    if (info.value?.startup?.phase !== 'ready') throw new Error('Surfpool runtime is not ready')
    await localRpc('surfnet_getLocalSignatures', [0])
    runtimeVerified = true
    // Surfpool bundle sandboxes need external fee destinations hydrated before
    // their initial snapshot. These are unmodified public mainnet accounts.
    const global = await new OnlinePumpSdk(connection).fetchGlobal()
    const publicAccounts = Object.values(global).flat().filter((value): value is PublicKey => value instanceof PublicKey)
    await connection.getMultipleAccountsInfo([...new Map(publicAccounts.map(key => [key.toBase58(), key])).values()])
    evidence({ route: 'runtime-safety', surfnetVersion: version['surfnet-version'], checks: ['loopback-only-transport', 'surfnet-identity', 'runtime-ready', 'fresh-payers-only', 'no-user-secret-loading'] })
  }, 30_000)

  it.each([{ initialBuySol: 0, priorityFeeSol: 0 }, { initialBuySol: 0.1, priorityFeeSol: 0 }, { initialBuySol: 0, priorityFeeSol: 0.00002 }, { initialBuySol: 0.1, priorityFeeSol: 0.00002 }])('creates max metadata with initial buy $initialBuySol and priority fee $priorityFeeSol, then buys and sells', async ({ initialBuySol, priorityFeeSol }) => {
    const payer = await fundFreshPayer(), mint = Keypair.generate(), online = new OnlinePumpSdk(connection), global = await online.fetchGlobal()
    const prepared = await buildCreateTransaction({ connection, userPublicKey: payer.publicKey.toBase58(), mintKeypair: mint, metadata: { ...metadata, description: 'Local fork verification' }, metadataUri: metadata.uri, initialBuyAmount: initialBuySol, priorityFee: priorityFeeSol })
    if (!prepared.success || !prepared.transactions?.length || !prepared.nativeContext) throw new Error(prepared.error ?? 'Native creation failed')
    const createPackets = prepared.transactions
    let createSignature: string
    if (prepared.requiresAtomicBundle) {
      expect(prepared.transaction).toBeUndefined(); expect(createPackets).toHaveLength(3)
      validatePumpTransaction(createPackets[0], { action: 'create', payer: payer.publicKey, mint: mint.publicKey, maxSolLamports: 0n, expectedMetadata: metadata })
      validatePumpTransaction(createPackets[1], { action: 'buy', payer: payer.publicKey, mint: mint.publicKey, maxSolLamports: BigInt(Math.round(initialBuySol * 1e9)) })
      const receipt = await submitLocalBundle(createPackets, createPackets.map(() => [payer]))
      createSignature = receipt.signatures[0]
    } else {
      expect(prepared.transaction).toBe(createPackets[0])
      validatePumpTransaction(prepared.transaction!, { action: 'create', payer: payer.publicKey, mint: mint.publicKey, maxSolLamports: BigInt(Math.round(initialBuySol * 1e9)), maxPriorityFeeLamports: BigInt(Math.round(priorityFeeSol * 1e9)), expectedMetadata: metadata })
      createSignature = await submitLocal(prepared.transaction!, [payer])
    }
    const mintInfo = await connection.getAccountInfo(mint.publicKey), curveInfo = await connection.getAccountInfo(bondingCurvePda(mint.publicKey))
    expect(mintInfo).not.toBeNull(); expect(curveInfo?.owner.equals(PUMP_PROGRAM_ID)).toBe(true)
    const state = unpackMint(mint.publicKey, mintInfo!, TOKEN_2022_PROGRAM_ID), curve = PUMP_SDK.decodeBondingCurve(curveInfo!)
    expect(state.supply.toString()).toBe(global.tokenTotalSupply.toString()); expect(state.mintAuthority).toBeNull(); expect(state.freezeAuthority).toBeNull()
    const tokenMetadata = unpack(getExtensionData(ExtensionType.TokenMetadata, state.tlvData)!)
    expect(tokenMetadata.name).toBe(metadata.name); expect(tokenMetadata.symbol).toBe(metadata.symbol); expect(tokenMetadata.uri).toBe(metadata.uri)
    const metadataPointer = getMetadataPointerState(state)
    expect(metadataPointer).not.toBeNull(); expect(metadataPointer!.authority).toBeNull()
    expect(metadataPointer!.metadataAddress?.equals(mint.publicKey)).toBe(true)
    // SPL metadata represents an absent OptionalNonZeroPubkey as undefined.
    expect(tokenMetadata.updateAuthority).toBeUndefined()
    expect(curve.creator.equals(payer.publicKey)).toBe(true); expect(curve.complete).toBe(false)
    expect(await tokenAmount(mint.publicKey, payer.publicKey)).toBe(BigInt(prepared.tokenAmountRaw!))
    const initialTokens = await tokenAmount(mint.publicKey, payer.publicKey)
    const buy = await prepareLocalTrade({ action: 'buy', mint: mint.publicKey.toBase58(), payer: payer.publicKey.toBase58(), buySol: '0.01', sellPercent: 25, slippage: 10, priorityFeeSol })
    expect(buy.message).toBe(Buffer.from(buy.transaction.message.serialize()).toString('base64'))
    inspectTradeIntent(buy.transaction, buy.input, 0n)
    const buySignature = await submitLocal(buy.transaction, [payer])
    expect(await tokenAmount(mint.publicKey, payer.publicKey)).toBe(initialTokens + BigInt(buy.tokenChangeRaw))
    const beforePartial = await tokenAmount(mint.publicKey, payer.publicKey)
    const partial = await preparePumpTrade(connection, { ...buy.input, action: 'sell', sellPercent: 25 })
    expect(partial.maxSellRaw).toBe((beforePartial * 25n / 100n).toString()); inspectTradeIntent(partial.transaction, partial.input, BigInt(partial.maxSellRaw))
    const partialSignature = await submitLocal(partial.transaction, [payer])
    expect(await tokenAmount(mint.publicKey, payer.publicKey)).toBe(beforePartial - BigInt(partial.maxSellRaw))
    const sellAll = await preparePumpTrade(connection, { ...buy.input, action: 'sell', sellPercent: 100 })
    const sellAllSignature = await submitLocal(sellAll.transaction, [payer])
    expect(await tokenAmount(mint.publicKey, payer.publicKey)).toBe(0n)
    expect((await readTokenPosition(connection, mint.publicKey.toBase58(), payer.publicKey.toBase58())).status).toBe('active')
    evidence({ route: 'pump-create-and-manual-trade', initialBuySol, priorityFeeSol, mint: mint.publicKey.toBase58(), createSignature, buySignature, partialSignature, sellAllSignature, createPacketBytes: createPackets.map(tx => tx.serialize().length), requiresAtomicBundle: prepared.requiresAtomicBundle, mintAuthority: state.mintAuthority, freezeAuthority: state.freezeAuthority, metadataPointerAuthority: metadataPointer!.authority, metadataUpdateAuthority: tokenMetadata.updateAuthority ?? null, checks: ['max-32-10-200-byte-metadata', 'confirmed-create', 'fixed-supply', 'revoked-mint-freeze-authorities', 'immutable-metadata-pointer-to-mint', 'revoked-metadata-update-authority', 'exact-initial-buy', 'complete-bank-buy-preview', 'unchanged-reviewed-message-on-sign', 'confirmed-manual-buy', 'confirmed-25-percent-sell', 'confirmed-100-percent-sell', 'zero-final-wallet-token-balance'] })
  }, 120_000)

  it.each([{ maximumMetadata: false, buyerCount: 3 }, { maximumMetadata: true, buyerCount: 2 }])('atomically executes a full five-packet local launch with $buyerCount distinct buyers (maximum metadata=$maximumMetadata)', async ({ maximumMetadata, buyerCount }) => {
    const creator = await fundFreshPayer(), buyers = await Promise.all(Array.from({ length: buyerCount }, () => fundFreshPayer())), mint = Keypair.generate(), bundleMetadata = { ...metadata, uri: maximumMetadata ? metadata.uri : 'https://example.com/local.json' }
    const prepared = await buildCreateTransaction({ connection, userPublicKey: creator.publicKey.toBase58(), mintKeypair: mint, metadata: { ...bundleMetadata, description: 'Local bundle' }, metadataUri: bundleMetadata.uri, initialBuyAmount: 0.1 })
    if (!prepared.success || !prepared.transactions?.length || !prepared.nativeContext) throw new Error(prepared.error ?? 'Bundle create failed')
    expect(prepared.requiresAtomicBundle).toBe(maximumMetadata)
    const transactions = prepared.requiresAtomicBundle ? prepared.transactions.slice(0, -1) : [...prepared.transactions], launchPacketCount = transactions.length, expected: bigint[] = []
    let context = prepared.nativeContext
    for (const buyer of buyers) {
      const next = await buildFreshNativeBuy({ context, mint: mint.publicKey, payer: buyer.publicKey, metadata: bundleMetadata, maxBuyLamports: 10_000_000n, blockhash: transactions[0].message.recentBlockhash })
      context = next.context; transactions.push(next.transaction); expected.push(BigInt(context.tokenAmount.toString()))
    }
    transactions.push(await createVerifiedJitoTipTransaction(connection, creator.publicKey, transactions[0].message.recentBlockhash, 10_000))
    expect(transactions).toHaveLength(5)
    const signers = [...Array.from({ length: launchPacketCount }, () => [creator]), ...buyers.map(buyer => [buyer]), [creator]]
    const receipt = await submitLocalBundle(transactions, signers)
    for (let index = 0; index < buyers.length; index++) expect(await tokenAmount(mint.publicKey, buyers[index].publicKey)).toBe(expected[index])
    expect(await tokenAmount(mint.publicKey, creator.publicKey)).toBe(BigInt(prepared.tokenAmountRaw!))
    evidence({ route: 'pump-five-packet-bundle', maximumMetadata, buyerCount, mint: mint.publicKey.toBase58(), packets: transactions.length, signatures: receipt.signatures, bundleId: receipt.bundleId, simulationUnitsConsumed: receipt.simulationUnitsConsumed, checks: ['distinct-fake-funded-buyers', 'signed-complete-bank-five-packet-simulation', 'confirmed-atomic-local-create-buys-tip', 'each-exact-quoted-token-output'], limits: ['external Jito relay acceptance and mainnet landing are not proven'] })
  }, 120_000)

  it('rejects UTF-8 metadata overflow and negative/tiny buy boundaries before signing', async () => {
    const online = new OnlinePumpSdk(connection), [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()])
    const input = { global, feeConfig, payer: Keypair.generate().publicKey, mint: Keypair.generate().publicKey, metadata, maxBuyLamports: 0n }
    for (const bad of [{ ...metadata, name: 'é'.repeat(17) }, { ...metadata, symbol: 'é'.repeat(6) }, { ...metadata, uri: metadata.uri + 'x' }, { ...metadata, name: ' ' }]) await expect(buildNativeCreateInstructions({ ...input, metadata: bad })).rejects.toThrow()
    await expect(buildNativeCreateInstructions({ ...input, maxBuyLamports: -1n })).rejects.toThrow(/budget/)
    await expect(buildNativeCreateInstructions({ ...input, maxBuyLamports: 1n })).rejects.toThrow(/small/)
    evidence({ route: 'pump-negative-boundaries', checks: ['utf8-name-overflow', 'utf8-symbol-overflow', 'uri-overflow', 'blank-name', 'negative-buy', 'one-lamport-buy'] })
  }, 30_000)

  it('recovers the original confirmed signature after a lost send response and cancels an unsent launch', async () => {
    const payer = await fundFreshPayer(), mint = Keypair.generate()
    const prepared = await buildCreateTransaction({ connection, userPublicKey: payer.publicKey.toBase58(), mintKeypair: mint, metadata: { name: 'Recovery', symbol: 'RCV', description: 'Local response recovery' }, metadataUri: 'https://example.com/recovery.json' })
    expect(prepared.transaction).toBeDefined()
    const transaction = prepared.transaction!; transaction.sign([payer])
    const savedSignature = signedTransactionSignature(transaction), sendRaw = connection.sendRawTransaction.bind(connection)
    let broadcasts = 0
    connection.sendRawTransaction = async (...args) => { broadcasts++; await sendRaw(...args); throw new Error('Deliberately lost local response after execution') }
    let recovered
    try { recovered = await sendAndConfirmTransaction(connection, transaction, { timeoutMs: 10_000, pollIntervalMs: 100 }) }
    finally { connection.sendRawTransaction = sendRaw }
    expect(recovered.status).toBe('confirmed'); expect(recovered.signature).toBe(savedSignature); expect(broadcasts).toBe(1)
    expect(await connection.getAccountInfo(mint.publicKey)).not.toBeNull()
    const cancelledMint = Keypair.generate(), cancelled = await buildCreateTransaction({ connection, userPublicKey: payer.publicKey.toBase58(), mintKeypair: cancelledMint, metadata: { name: 'Cancelled', symbol: 'STOP', description: 'Local cancellation' }, metadataUri: 'https://example.com/cancel.json' })
    cancelled.transaction!.sign([payer])
    const controller = new AbortController(); controller.abort()
    const receipt = await sendAndConfirmTransaction(connection, cancelled.transaction!, { signal: controller.signal })
    expect(receipt.status).toBe('failed'); expect(receipt.submitted).toBe(false); expect(await connection.getAccountInfo(cancelledMint.publicKey)).toBeNull()
    evidence({ route: 'pump-recovery-and-cancellation', savedSignature, broadcasts, checks: ['response-loss-after-actual-local-send', 'original-signature-reconciled', 'no-duplicate-broadcast', 'abort-before-broadcast', 'cancelled-mint-absent'] })
  }, 30_000)

  it('rolls back a local Pump creation when a later transaction in its atomic bundle fails', async () => {
    const payer = await fundFreshPayer(), mint = Keypair.generate()
    const prepared = await buildCreateTransaction({ connection, userPublicKey: payer.publicKey.toBase58(), mintKeypair: mint, metadata: { name: 'Atomic rollback', symbol: 'ROLL', description: 'Local bundle rollback' }, metadataUri: 'https://example.com/rollback.json' })
    const creation = prepared.transaction!, impossible = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: creation.message.recentBlockhash, instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 200_000_000_000 })] }).compileToV0Message())
    creation.sign([payer]); impossible.sign([payer])
    const before = await connection.getBalance(payer.publicKey)
    await expect(localRpc('sendBundle', [[creation, impossible].map(tx => Buffer.from(tx.serialize()).toString('base64')), { encoding: 'base64' }])).rejects.toThrow(/Local sendBundle failed/)
    expect(await connection.getAccountInfo(mint.publicKey)).toBeNull(); expect(await connection.getBalance(payer.publicKey)).toBe(before)
    evidence({ route: 'pump-atomic-rollback', checks: ['real-local-bundle-submission', 'dependent-transaction-fails', 'mint-creation-rolled-back', 'payer-balance-unchanged'] })
  }, 30_000)

  it.each(['atomic', 'after-confirm', 'organic'] as const)('executes the configured %s bundler with real local buys and browser-timed sells', async mode => {
    const creator = await fundFreshPayer(), buyers = await Promise.all([fundFreshPayer(), fundFreshPayer()]), mint = Keypair.generate()
    const wallets: BundleWallet[] = buyers.map((buyer, index) => ({ id: index + 1, privateKey: bs58.encode(buyer.secretKey), publicKey: buyer.publicKey.toBase58(), balance: 100, buyAmount: 0.01, mode: index === 0 ? 'sniper' : 'delayed', delaySeconds: 0.05, isValid: true, sellEnabled: true, sellPercent: 100, sellTriggerType: 'time', sellDelaySeconds: 1, sellProfitMultiplier: 2 }))
    const config: BundlerConfig = {
      creatorFeeSelection:{kind:'deployer'},
      tokenName: 'Configured Local', tokenSymbol: 'LOCAL', tokenDescription: 'Funded only in Surfpool', tokenImage: new Blob(['local image'], { type: 'image/png' }) as File, tokenBanner: null,
      creatorPrivateKey: bs58.encode(creator.secretKey), creatorPublicKey: creator.publicKey.toBase58(), creatorBalance: 100, devBuyAmount: 0.1,
      mintMode: 'import', importedMintKey: bs58.encode(mint.secretKey), importedMintPublicKey: mint.publicKey.toBase58(), vanityPattern: '', vanityMode: 'suffix', foundVanityKey: null, foundVanityPublicKey: null,
      bundleWallets: wallets, bundleMode: mode === 'organic' ? 'natural' : 'sniper', naturalDelayMin: 0.01, naturalDelayMax: 0.02, jitoTip: 0.001, slippage: 10, sniperMode: mode === 'atomic' ? 'block0' : 'after_confirm',
      autoSellEnabled: true, autoSellTriggerType: 'time', autoSellDelay: 1, autoSellProfitMultiplier: 2, autoSellPercent: 100, twitter: '', telegram: '', website: '',
    }
    requireLocalEndpoint()
    const checkpoints: { status?: string; submitted: number }[] = []
    const result = await executeBundleLaunch(config, () => {}, { connection, metadataUri: 'https://example.com/configured.json', bundleEndpoint: endpoint, onReceipt: receipt => checkpoints.push({ status: receipt.status, submitted: receipt.submittedSignatures?.length ?? 0 }) })
    expect(result.success, result.error).toBe(true); expect(result.status).toBe('confirmed'); expect(result.mintAddress).toBe(mint.publicKey.toBase58())
    expect(result.buySignatures).toHaveLength(2); expect(result.bundleSellSignatures).toHaveLength(2); expect(result.sellSignature).toBeTruthy()
    expect(result.bundleId !== undefined).toBe(mode === 'atomic')
    expect(await tokenAmount(mint.publicKey, creator.publicKey)).toBe(0n)
    for (const buyer of buyers) expect(await tokenAmount(mint.publicKey, buyer.publicKey)).toBe(0n)
    expect(checkpoints.some(item => item.status === 'unknown' && item.submitted > 0)).toBe(true)
    evidence({ route: 'pump-configured-bundler', mode, mint: result.mintAddress, createSignature: result.createSignature, buySignatures: result.buySignatures, sellSignature: result.sellSignature, bundleSellSignatures: result.bundleSellSignatures, checks: ['actual-executeBundleLaunch', 'fresh-local-creator-and-buyers', 'configured-buy-timing', 'configured-browser-timed-sells', 'all-wallet-token-balances-zero', 'public-receipt-checkpoints'] })
  }, 60_000)
})
