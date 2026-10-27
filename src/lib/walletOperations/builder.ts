import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type AccountInfo, type TransactionInstruction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, ExtensionType, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getExtensionTypes, unpackAccount, unpackMint } from '@solana/spl-token'
import { fetchBounded, withTimeout } from '@/lib/transactions/http'
import { normalizeOperationInput, parseExactUnits, publicAddress, type WalletOperationInput, type WalletOperationIntent } from './model'
import { publicWalletOperationIntent } from './history'

const UNIT_LIMIT = 400000
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const ALLOWED_MINT_EXTENSIONS = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata])
const ALLOWED_ACCOUNT_EXTENSIONS = new Set([ExtensionType.ImmutableOwner])
export interface WalletOperationPreview {
  payerBeforeLamports: string; payerAfterLamports: string; networkFeeLamports: string; rentChangeLamports: string
  sourceBeforeRaw?: string; sourceAfterRaw?: string
  recipients: { address: string; rawAmount: string; beforeRaw: string; afterRaw: string }[]
}
export interface PreparedWalletOperation { intent: WalletOperationIntent; transaction: VersionedTransaction; message: string; preview: WalletOperationPreview; createdAt: number; lastValidBlockHeight: number }
export interface WalletTokenAccount { address: string; mint: string; amountRaw: string; decimals: number; tokenProgram: string; lamports: string; closeable: boolean; reason: string }

function tokenProgram(value: string): PublicKey {
  const key = new PublicKey(value)
  if (!key.equals(TOKEN_PROGRAM_ID) && !key.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('This token program is not supported.')
  return key
}
function safeLamports(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('A wallet balance could not be read exactly.')
  return BigInt(value)
}
export function checkedMint(address: PublicKey, info: AccountInfo<Buffer> | null) {
  if (!info || info.executable) throw new Error('The token mint could not be loaded.')
  const program = tokenProgram(info.owner.toBase58()), state = unpackMint(address, info, program)
  if (!state.isInitialized) throw new Error('The token mint is not initialized.')
  if (getExtensionTypes(state.tlvData).some(type => !ALLOWED_MINT_EXTENSIONS.has(type))) throw new Error('This mint has unsupported token extensions. Only standard SPL and metadata-only Token-2022 mints are supported.')
  return { state, program }
}
export function checkedTokenAccount(address: PublicKey, info: AccountInfo<Buffer> | null, program: PublicKey, mint: PublicKey, owner: PublicKey, closing = false) {
  if (!info || info.executable) throw new Error('The token account could not be loaded.')
  const state = unpackAccount(address, info, program)
  if (!state.isInitialized || state.isFrozen || state.isNative || state.mint.equals(NATIVE_MINT) || !state.mint.equals(mint) || !state.owner.equals(owner)) throw new Error('The token account must be initialized, unfrozen, non-native and owned by the selected wallet.')
  if (getExtensionTypes(state.tlvData).some(type => !ALLOWED_ACCOUNT_EXTENSIONS.has(type))) throw new Error('This token account has unsupported extensions.')
  if (closing && (state.amount !== 0n || (state.closeAuthority && !state.closeAuthority.equals(owner)))) throw new Error('Only empty accounts whose owner can close them are eligible for cleanup.')
  return state
}
function requireSystemWallet(info: AccountInfo<Buffer> | null) { if (info && (info.executable || !info.owner.equals(SystemProgram.programId) || info.data.length)) throw new Error('SOL recipients must be ordinary Solana wallet accounts.') }

export function buildWalletOperationTransaction(input: WalletOperationIntent, blockhash: string): VersionedTransaction {
  const intent = publicWalletOperationIntent(input), payer = new PublicKey(intent.payer), instructions: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: UNIT_LIMIT })]
  const priority = BigInt(intent.priorityLamports)
  if (priority > 0n) instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority * 1000000n / BigInt(UNIT_LIMIT) }))
  if (intent.kind === 'sol') for (const recipient of intent.recipients!) instructions.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(recipient.address), lamports: BigInt(recipient.rawAmount) }))
  if (intent.kind === 'token') {
    const mint = new PublicKey(intent.mint!), source = new PublicKey(intent.sourceAccount!), program = tokenProgram(intent.tokenProgram!)
    for (const recipient of intent.recipients!) {
      const owner = new PublicKey(recipient.address), ata = getAssociatedTokenAddressSync(mint, owner, false, program)
      if (ata.toBase58() !== recipient.tokenAccount || source.equals(ata)) throw new Error('The reviewed recipient token account does not match its wallet.')
      instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, program, ASSOCIATED_TOKEN_PROGRAM_ID), createTransferCheckedInstruction(source, mint, ata, payer, BigInt(recipient.rawAmount), intent.decimals!, [], program))
    }
  }
  if (intent.kind === 'close') for (const account of intent.closeAccounts!) instructions.push(createCloseAccountInstruction(new PublicKey(account.address), payer, payer, [], tokenProgram(account.tokenProgram)))
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: publicAddress(blockhash), instructions }).compileToV0Message())
  if (transaction.serialize().length > 1232) throw new Error('This operation exceeds the transaction size limit. Use fewer recipients or accounts.')
  return transaction
}
/** Reconstruct the complete approved message: extra instructions, signers, lookup tables or amount changes are rejected. */
export function inspectWalletOperationIntent(transaction: VersionedTransaction, intent: WalletOperationIntent): void {
  if (transaction.message.header.numRequiredSignatures !== 1 || transaction.message.addressTableLookups.length || transaction.serialize().length > 1232) throw new Error('The wallet operation contains an unsupported signing capability.')
  const expected = buildWalletOperationTransaction(intent, transaction.message.recentBlockhash)
  if (!Buffer.from(expected.message.serialize()).equals(Buffer.from(transaction.message.serialize()))) throw new Error('The transaction does not match the reviewed wallet operation intent.')
}

type SimAccount = { data: [string, 'base64']; lamports: number; owner: string; executable?: boolean; rentEpoch?: number }
function simulationAccount(value: unknown): AccountInfo<Buffer> | null {
  if (value === null) return null
  const info = value as SimAccount
  if (!info || !Array.isArray(info.data) || info.data.length !== 2 || info.data[1] !== 'base64' || typeof info.data[0] !== 'string' || info.data[0].length > 20000) throw new Error('The RPC returned incomplete account preview data.')
  const data = Buffer.from(info.data[0], 'base64'), owner = new PublicKey(publicAddress(info.owner)), lamports = Number(safeLamports(info.lamports))
  if (!data.length && lamports === 0 && owner.equals(SystemProgram.programId)) return null
  return { data, owner, lamports, executable: info.executable === true, rentEpoch: info.rentEpoch ?? 0 }
}
export async function simulateWalletOperation(connection: Connection, transaction: VersionedTransaction, input: WalletOperationIntent, signed = false): Promise<WalletOperationPreview> {
  const intent = publicWalletOperationIntent(input)
  inspectWalletOperationIntent(transaction, intent)
  const addresses = [...new Set([intent.payer, ...(intent.kind === 'sol' ? intent.recipients!.map(value => value.address) : intent.kind === 'token' ? [intent.mint!, intent.sourceAccount!, ...intent.recipients!.flatMap(value => [value.address, value.tokenAccount!])] : intent.closeAccounts!.flatMap(value => [value.address, value.mint]))])]
  if (addresses.length > 20) throw new Error('Too many accounts to preview safely.')
  // Hydrate all public instruction accounts before the local-fork simulator takes its bank snapshot.
  await withTimeout(connection.getMultipleAccountsInfo(transaction.message.staticAccountKeys, 'confirmed'))
  const config = { encoding: 'base64', addresses }
  const [response, fee] = await Promise.all([
    fetchBounded<any>(connection.rpcEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [{ encodedTransactions: [Buffer.from(transaction.serialize()).toString('base64')] }, { transactionEncoding: 'base64', skipSigVerify: !signed, replaceRecentBlockhash: false, preExecutionAccountsConfigs: [config], postExecutionAccountsConfigs: [config] }] }) }, value => value.json()),
    withTimeout(connection.getFeeForMessage(transaction.message, 'confirmed')),
  ])
  const value = response.result?.value, result = value?.transactionResults?.[0]
  if (response.error || value?.summary !== 'succeeded' || value.transactionResults?.length !== 1 || result?.err !== null || !Array.isArray(result.preExecutionAccounts) || !Array.isArray(result.postExecutionAccounts) || result.preExecutionAccounts.length !== addresses.length || result.postExecutionAccounts.length !== addresses.length || fee.value === null) throw new Error(`A complete wallet operation simulation is unavailable. Nothing was submitted.${result?.err ? ` ${JSON.stringify(result.err)}` : ''}`)
  const before = result.preExecutionAccounts.map(simulationAccount) as (AccountInfo<Buffer> | null)[], after = result.postExecutionAccounts.map(simulationAccount) as (AccountInfo<Buffer> | null)[]
  const at = (side: (AccountInfo<Buffer> | null)[], address: string) => side[addresses.indexOf(address)]
  if (!before[0] || !after[0] || !before[0].owner.equals(SystemProgram.programId) || !after[0].owner.equals(SystemProgram.programId)) throw new Error('The sending wallet could not be verified in the simulation.')
  const beforePayer = safeLamports(before[0].lamports), afterPayer = safeLamports(after[0].lamports), networkFee = safeLamports(fee.value)
  const recipients: WalletOperationPreview['recipients'] = []
  let expectedChange = -networkFee, rentChange = 0n, sourceBeforeRaw: string | undefined, sourceAfterRaw: string | undefined
  if (intent.kind === 'sol') for (const recipient of intent.recipients!) {
    const initial = at(before, recipient.address), final = at(after, recipient.address)
    requireSystemWallet(initial); requireSystemWallet(final)
    const beforeRaw = initial ? safeLamports(initial.lamports) : 0n, afterRaw = final ? safeLamports(final.lamports) : 0n
    if (afterRaw - beforeRaw !== BigInt(recipient.rawAmount)) throw new Error('A recipient amount does not match the reviewed transfer.')
    expectedChange -= BigInt(recipient.rawAmount)
    recipients.push({ ...recipient, beforeRaw: beforeRaw.toString(), afterRaw: afterRaw.toString() })
  }
  if (intent.kind === 'token') {
    const mint = new PublicKey(intent.mint!), payer = new PublicKey(intent.payer), program = tokenProgram(intent.tokenProgram!)
    const mintState = checkedMint(mint, at(before, intent.mint!))
    if (!mintState.program.equals(program) || mintState.state.decimals !== intent.decimals) throw new Error('The token mint changed. Prepare again.')
    const source = new PublicKey(intent.sourceAccount!), initialSource = checkedTokenAccount(source, at(before, intent.sourceAccount!), program, mint, payer), finalSource = checkedTokenAccount(source, at(after, intent.sourceAccount!), program, mint, payer)
    sourceBeforeRaw = initialSource.amount.toString(); sourceAfterRaw = finalSource.amount.toString()
    const total = intent.recipients!.reduce((sum, recipient) => sum + BigInt(recipient.rawAmount), 0n)
    if (initialSource.amount - finalSource.amount !== total) throw new Error('The source token amount does not match the approved transfers.')
    for (const recipient of intent.recipients!) {
      requireSystemWallet(at(before, recipient.address)); requireSystemWallet(at(after, recipient.address))
      const address = new PublicKey(recipient.tokenAccount!), owner = new PublicKey(recipient.address), initial = at(before, recipient.tokenAccount!), final = at(after, recipient.tokenAccount!)
      const beforeRaw = initial ? checkedTokenAccount(address, initial, program, mint, owner).amount : 0n
      const afterRaw = checkedTokenAccount(address, final, program, mint, owner).amount
      if (afterRaw - beforeRaw !== BigInt(recipient.rawAmount)) throw new Error('A recipient token amount does not match the approved transfer.')
      const accountRent = (final ? safeLamports(final.lamports) : 0n) - (initial ? safeLamports(initial.lamports) : 0n)
      if (accountRent < 0n || (initial && accountRent !== 0n)) throw new Error('Recipient account rent changed unexpectedly.')
      rentChange -= accountRent; expectedChange -= accountRent
      recipients.push({ address: recipient.address, rawAmount: recipient.rawAmount, beforeRaw: beforeRaw.toString(), afterRaw: afterRaw.toString() })
    }
  }
  if (intent.kind === 'close') for (const account of intent.closeAccounts!) {
    const address = new PublicKey(account.address), mint = new PublicKey(account.mint), program = tokenProgram(account.tokenProgram), initial = at(before, account.address)
    const mintState = checkedMint(mint, at(before, account.mint))
    if (!mintState.program.equals(program)) throw new Error('The token mint program changed. Prepare again.')
    checkedTokenAccount(address, initial, program, mint, new PublicKey(intent.payer), true)
    if (at(after, account.address) !== null) throw new Error('An account was not closed by the simulation.')
    const returnedRent = safeLamports(initial!.lamports)
    rentChange += returnedRent; expectedChange += returnedRent
  }
  if (afterPayer - beforePayer !== expectedChange) throw new Error('The simulated wallet balance does not match transfers, rent and the network fee.')
  return { payerBeforeLamports: beforePayer.toString(), payerAfterLamports: afterPayer.toString(), networkFeeLamports: networkFee.toString(), rentChangeLamports: rentChange.toString(), ...(sourceBeforeRaw === undefined ? {} : { sourceBeforeRaw, sourceAfterRaw }), recipients }
}

/** Read-only preparation. No keys are accepted and no transaction is submitted. */
export async function prepareWalletOperation(connection: Connection, input: WalletOperationInput): Promise<PreparedWalletOperation> {
  const normalized = normalizeOperationInput(input), payer = new PublicKey(normalized.payer)
  const [genesis, payerInfo, latest] = await Promise.all([withTimeout(connection.getGenesisHash()), withTimeout(connection.getAccountInfo(payer, 'confirmed')), withTimeout(connection.getLatestBlockhash('confirmed'))])
  if (genesis !== MAINNET_GENESIS) throw new Error('Wallet operations support Solana mainnet.')
  if (!payerInfo || payerInfo.executable || !payerInfo.owner.equals(SystemProgram.programId) || payerInfo.data.length) throw new Error('Use an ordinary funded Solana wallet as the sender.')
  let intent: WalletOperationIntent = { kind: normalized.kind, payer: normalized.payer, priorityLamports: parseExactUnits(normalized.priorityFeeSol, 9, true).toString() }
  if (normalized.kind === 'sol') {
    const recipients = normalized.recipients.map(recipient => ({ address: recipient.address, rawAmount: parseExactUnits(recipient.amount, 9).toString() }))
    const infos = await withTimeout(connection.getMultipleAccountsInfo(recipients.map(value => new PublicKey(value.address)), 'confirmed'))
    infos.forEach(requireSystemWallet); intent = { ...intent, recipients }
  }
  if (normalized.kind === 'token') {
    const mint = new PublicKey(normalized.mint), mintInfo = await withTimeout(connection.getAccountInfo(mint, 'confirmed')), { state, program } = checkedMint(mint, mintInfo)
    if (mint.equals(NATIVE_MINT)) throw new Error('Use SOL transfer controls for native SOL; wrapped SOL accounts are not supported here.')
    const source = normalized.sourceAccount ? new PublicKey(normalized.sourceAccount) : getAssociatedTokenAddressSync(mint, payer, false, program)
    const sourceInfo = await withTimeout(connection.getAccountInfo(source, 'confirmed'))
    const account = checkedTokenAccount(source, sourceInfo, program, mint, payer)
    const recipients = normalized.recipients.map(recipient => ({ address: recipient.address, rawAmount: parseExactUnits(recipient.amount, state.decimals).toString(), tokenAccount: getAssociatedTokenAddressSync(mint, new PublicKey(recipient.address), false, program).toBase58() }))
    if (recipients.reduce((total, recipient) => total + BigInt(recipient.rawAmount), 0n) > account.amount) throw new Error('The selected token account has insufficient tokens.')
    intent = { ...intent, recipients, mint: mint.toBase58(), sourceAccount: source.toBase58(), tokenProgram: program.toBase58(), decimals: state.decimals }
  }
  if (normalized.kind === 'close') {
    const accounts = await withTimeout(connection.getMultipleAccountsInfo(normalized.accounts.map(value => new PublicKey(value)), 'confirmed'))
    const closeAccounts = []
    for (let index = 0; index < normalized.accounts.length; index++) {
      const address = new PublicKey(normalized.accounts[index]), info = accounts[index]
      if (!info) throw new Error('An account selected for cleanup no longer exists.')
      const program = tokenProgram(info.owner.toBase58()), account = unpackAccount(address, info, program), mintInfo = await withTimeout(connection.getAccountInfo(account.mint, 'confirmed'))
      const mint = checkedMint(account.mint, mintInfo)
      if (!mint.program.equals(program)) throw new Error('The token account and mint use different programs.')
      checkedTokenAccount(address, info, program, account.mint, payer, true)
      closeAccounts.push({ address: address.toBase58(), mint: account.mint.toBase58(), tokenProgram: program.toBase58() })
    }
    intent = { ...intent, closeAccounts }
  }
  intent = publicWalletOperationIntent(intent)
  const transaction = buildWalletOperationTransaction(intent, latest.blockhash), preview = await simulateWalletOperation(connection, transaction, intent)
  return { intent, transaction, preview, message: Buffer.from(transaction.message.serialize()).toString('base64'), lastValidBlockHeight: latest.lastValidBlockHeight, createdAt: Date.now() }
}

export async function readWalletTokenAccounts(connection: Connection, payerAddress: string): Promise<WalletTokenAccount[]> {
  const payer = new PublicKey(publicAddress(payerAddress, true)), result: WalletTokenAccount[] = []
  const inventory = await Promise.all([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(program => withTimeout(connection.getTokenAccountsByOwner(payer, { programId: program }, 'confirmed')).then(response => ({ program, values: response.value }))))
  if (inventory.some(value => value.values.length > 200)) throw new Error('This wallet has over 200 token accounts for one program. Use the inspector to review its inventory first.')
  const mintAddresses = [...new Set(inventory.flatMap(({ program, values }) => values.flatMap(({ pubkey, account }) => { try { return [unpackAccount(pubkey, account, program).mint.toBase58()] } catch { return [] } })))]
  const mintInfos = new Map<string, AccountInfo<Buffer> | null>()
  for (let offset = 0; offset < mintAddresses.length; offset += 100) {
    const addresses = mintAddresses.slice(offset, offset + 100), infos = await withTimeout(connection.getMultipleAccountsInfo(addresses.map(value => new PublicKey(value)), 'confirmed'))
    addresses.forEach((address, index) => mintInfos.set(address, infos[index]))
  }
  for (const { program, values } of inventory) {
    for (const { pubkey, account: info } of values) {
      let amountRaw = '0', mint = '', decimals = 0, closeable = false, reason = ''
      try {
        const account = unpackAccount(pubkey, info, program); mint = account.mint.toBase58(); amountRaw = account.amount.toString()
        const mintState = checkedMint(account.mint, mintInfos.get(mint) ?? null)
        if (!mintState.program.equals(program)) throw new Error('Mint program mismatch.')
        decimals = mintState.state.decimals
        checkedTokenAccount(pubkey, info, program, account.mint, payer, true); closeable = true
      } catch (error) { reason = error instanceof Error ? error.message : 'This account requires a separate review.' }
      result.push({ address: pubkey.toBase58(), mint, amountRaw, decimals, tokenProgram: program.toBase58(), lamports: safeLamports(info.lamports).toString(), closeable, reason })
    }
  }
  return result
}
