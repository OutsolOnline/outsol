import BN from 'bn.js'
import { Buffer } from 'buffer'
import { AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { AuthorityType, ExtensionType, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TYPE_SIZE, LENGTH_SIZE, getMintLen, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createInitializeMintInstruction, createInitializeMetadataPointerInstruction, createMintToInstruction, createSetAuthorityInstruction, createSyncNativeInstruction, createTransferCheckedInstruction, createInitializeAccountInstruction, createCloseAccountInstruction } from '@solana/spl-token'
import { createInitializeInstruction, createUpdateAuthorityInstruction, pack } from '@solana/spl-token-metadata'
import { createCreateMetadataAccountV3Instruction, PROGRAM_ID as METAPLEX_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata'
import { CREATE_CPMM_POOL_PROGRAM, CREATE_CPMM_POOL_FEE_ACC, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId, getCreatePoolKeys, makeCreateCpmmPoolInInstruction } from '@raydium-io/raydium-sdk-v2'
import { createStreamInstruction, PROGRAM_ID, FEE_ORACLE_PUBLIC_KEY, STREAMFLOW_TREASURY_PUBLIC_KEY, WITHDRAWOR_PUBLIC_KEY, ICluster } from '@streamflow/stream'
import { calculateDirectAllocations } from './allocations'
import { JITO_TIP_ACCOUNTS } from '../bundler/jito'

export type LaunchNetwork = 'mainnet-beta' | 'devnet'
export interface DirectLaunchInput {
  payer: PublicKey
  mintKeypair?: Keypair
  name: string
  symbol: string
  metadataUri: string
  totalSupply: string
  decimals: number
  liquidityTokenPercent: number
  liquiditySol: string
  lockUntil?: number | null
  lockRecipient?: PublicKey
  network: LaunchNetwork
  jitoTipLamports?: number
  /** Total priority fee budget in SOL, divided between the prepared packets. */
  priorityFeeSol?: number
  lookupTables?: AddressLookupTableAccount[]
  singleTransactionRequired?: boolean
  /** Retain only in local memory while a lookup table is prepared. */
  lockMetadataKeypair?: Keypair
}
export class LaunchLookupTableRequiredError extends Error {
  constructor(public readonly addresses: PublicKey[], public readonly estimatedTransactionBytes: number, public readonly resumeInput: DirectLaunchInput) {
    super('Prepare a launch address lookup table before signing the single launch transaction')
    this.name = 'LaunchLookupTableRequiredError'
    Object.defineProperty(this, 'resumeInput', { value: resumeInput, enumerable: false })
  }
}
export interface LockFees { creationFeeSol: number; streamflowLockFee: number; partnerFee: number }
export interface DirectLaunchSummary {
  totalTokenAmount: string
  liquidityTokenAmount: string
  developerTokenAmount: string
  developerGrossTokenAmount: string
  lockFeeTokenAmount: string
  lockRoundingFeeTokenAmount: string
  lockFeeSol: string
  lockFeePercent: number
  liquiditySolLamports: string
  liquidityTokenPercent: number
  developerTokenPercent: number
  lockFeeTokenPercent: number
  decimals: number
  platformFeeBps: 0
  developerLocked: boolean
  lockUntil: number | null
  mintAuthorityRevoked: true
  freezeAuthorityRevoked: true
  metadataAuthorityRevoked: true
  lpTokensDisposition: 'wallet'
  poolCreationFeeLamports: string
  estimatedRentAndNetworkFeeLamports: string
  estimatedTotalSolLamports: string
  jitoTipLamports: string
  priorityFeeLamports: string
}
export interface DirectLaunchPlan {
  transactions: VersionedTransaction[]
  signers: Keypair[]
  mint: PublicKey
  poolAddress: PublicKey
  lockAddress: PublicKey | null
  metadataUri: string
  summary: DirectLaunchSummary
  requiresAtomicBundle: boolean
  blockhash: string
  lastValidBlockHeight: number
}
export interface DirectInstructionContext extends DirectLaunchInput {
  mintKeypair: Keypair
  now: number
  mintRentLamports: number
  wrappedSolRentLamports: number
  blockhash: string
  lastValidBlockHeight: number
  lockFees?: LockFees
  configIndex?: number
  poolCreationFeeLamports?: string
  estimatedRentAndNetworkFeeLamports?: string
}

export function getDirectPrograms(network: LaunchNetwork) {
  const cluster = network === 'devnet' ? ICluster.Devnet : ICluster.Mainnet
  return {
    cpmm: network === 'devnet' ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM : CREATE_CPMM_POOL_PROGRAM,
    cpmmFee: network === 'devnet' ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC : CREATE_CPMM_POOL_FEE_ACC,
    streamflow: new PublicKey(PROGRAM_ID[cluster]),
    feeOracle: new PublicKey(FEE_ORACLE_PUBLIC_KEY[cluster]),
  }
}

export function getMetaplexMetadataAddress(mint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()], METAPLEX_PROGRAM_ID)[0]
}

export function getDirectMintSpace(input: Pick<DirectLaunchInput, 'name' | 'symbol' | 'metadataUri' | 'lockUntil' | 'singleTransactionRequired'>, mint: PublicKey) {
  if (input.lockUntil != null || input.singleTransactionRequired) return { baseSpace: 82, rentSpace: 82, metadataRentSpace: 679 }
  const baseSpace = getMintLen([ExtensionType.MetadataPointer])
  const metadata = pack({ mint, name: input.name, symbol: input.symbol, uri: input.metadataUri, additionalMetadata: [] })
  return { baseSpace, rentSpace: baseSpace + TYPE_SIZE + LENGTH_SIZE + metadata.length, metadataRentSpace: 0 }
}

/** Inverse of SDK floor(net * (1 + fee)); disclose any indivisible treasury remainder. */
export function allocateLockReserve(grossRaw: bigint, feePercent: number) {
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) throw new Error('Invalid Streamflow token fee')
  const denominator = BigInt(1000000)
  const fee = BigInt(Math.round(feePercent * 10000))
  const netRaw = ((grossRaw + BigInt(1)) * denominator - BigInt(1)) / (denominator + fee)
  const protocolFeeRaw = netRaw * fee / denominator
  if (netRaw <= BigInt(0)) throw new Error('Developer reserve is too small after lock fees')
  return { netRaw, protocolFeeRaw, roundingFeeRaw: grossRaw - netRaw - protocolFeeRaw }
}

export async function buildStreamflowLockInstruction(input: { payer: PublicKey; mint: PublicKey; amountRaw: bigint; unlockDate: number; network: LaunchNetwork; recipient?: PublicKey; metadataKeypair: Keypair; tokenProgram?: PublicKey }) {
  const programs = getDirectPrograms(input.network)
  const recipient = input.recipient ?? input.payer
  const metadata = input.metadataKeypair.publicKey
  const [escrow] = PublicKey.findProgramAddressSync([Buffer.from('strm'), metadata.toBuffer()], programs.streamflow)
  const tokenProgram = input.tokenProgram ?? TOKEN_2022_PROGRAM_ID
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(input.mint, owner, true, tokenProgram)
  const data = {
    start: new BN(input.unlockDate), depositedAmount: new BN(input.amountRaw.toString()), period: new BN(1),
    amountPerPeriod: new BN(1), cliff: new BN(input.unlockDate), cliffAmount: new BN(input.amountRaw.toString()),
    cancelableBySender: false, cancelableByRecipient: false, transferableBySender: false, transferableByRecipient: false,
    canTopup: false, automaticWithdrawal: false, canPause: false, canUpdateRate: false,
    name: 'Vanity developer supply lock', withdrawFrequency: new BN(1),
  }
  const accounts = {
    sender: input.payer, senderTokens: ata(input.payer), recipient, recipientTokens: ata(recipient), metadata, escrowTokens: escrow,
    streamflowTreasury: STREAMFLOW_TREASURY_PUBLIC_KEY, streamflowTreasuryTokens: ata(STREAMFLOW_TREASURY_PUBLIC_KEY),
    partner: WITHDRAWOR_PUBLIC_KEY, partnerTokens: ata(WITHDRAWOR_PUBLIC_KEY), mint: input.mint,
    feeOracle: programs.feeOracle, rent: SYSVAR_RENT_PUBKEY, timelockProgram: programs.streamflow,
    tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    withdrawor: WITHDRAWOR_PUBLIC_KEY, systemProgram: SystemProgram.programId,
  }
  const instruction = await createStreamInstruction(data, programs.streamflow, accounts)
  return { instruction, metadata, escrow }
}

function compileGroups(groups: TransactionInstruction[][], payer: PublicKey, blockhash: string, signers: Keypair[], priorityBudgetLamports: number, input: DirectLaunchInput) {
  const single = input.lockUntil != null || input.singleTransactionRequired === true
  const units = single ? 1400000 : 600000
  let microLamports = 0
  const compile = (ixs: TransactionInstruction[], tables = input.lookupTables ?? []) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...(priorityBudgetLamports > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports })] : []), ...ixs] }).compileToV0Message(tables))
  if (single) {
    microLamports = Math.floor(priorityBudgetLamports * 1000000 / units)
    const ixs = groups.flat()
    const candidate = compile(ixs)
    let size = Infinity
    try { size = candidate.serialize().length } catch { /* Measure with a lookup table below. */ }
    if (size > 1232) {
      const signerKeys = new Set(ixs.flatMap(ix => ix.keys.filter(k => k.isSigner).map(k => k.pubkey.toBase58())))
      signerKeys.add(payer.toBase58())
      const programKeys = new Set(ixs.map(ix => ix.programId.toBase58()))
      const addresses = [...new Map(ixs.flatMap(ix => ix.keys).filter(k => !signerKeys.has(k.pubkey.toBase58()) && !programKeys.has(k.pubkey.toBase58())).map(k => [k.pubkey.toBase58(), k.pubkey])).values()]
      const synthetic = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses } })
      const estimatedSize = compile(ixs, [synthetic]).serialize().length
      if (estimatedSize > 1232) throw new Error(`The single launch transaction needs ${estimatedSize} bytes after address compression; shorten the token name, symbol or metadata URI`)
      throw new LaunchLookupTableRequiredError(addresses, estimatedSize, input)
    }
    const required = candidate.message.staticAccountKeys.slice(0, candidate.message.header.numRequiredSignatures)
    candidate.sign(signers.filter(signer => required.some(key => key.equals(signer.publicKey))))
    return { transactions: [candidate], priorityFeeLamports: Math.ceil(microLamports * units / 1000000) }
  }
  const packed: TransactionInstruction[][] = []
  for (const group of groups) {
    const previous = packed[packed.length - 1]
    if (previous) {
      try {
        if (compile([...previous, ...group]).serialize().length <= 1232) { previous.push(...group); continue }
      } catch { /* Try the dependent group in its own packet. */ }
    }
    let size: number
    try { size = compile(group).serialize().length } catch { throw new Error('Launch transaction exceeds the Solana packet limit; shorten metadata') }
    if (size > 1232) throw new Error('Launch transaction exceeds the Solana packet limit; shorten metadata')
    packed.push([...group])
  }
  if (packed.length > 5) throw new Error('Launch needs more than five atomic bundle transactions')
  microLamports = Math.floor(Math.floor(priorityBudgetLamports / packed.length) * 1000000 / units)
  const transactions = packed.map(group => {
    const tx = compile(group)
    const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures)
    const localSigners = signers.filter(signer => required.some(key => key.equals(signer.publicKey)))
    if (localSigners.length) tx.sign(localSigners)
    return tx
  })
  return { transactions, priorityFeeLamports: Math.ceil(microLamports * units / 1000000) * packed.length }
}

/** Pure construction: never sends or performs dependent RPC simulations. */
export async function buildDirectLaunchInstructions(input: DirectInstructionContext): Promise<DirectLaunchPlan & { instructionGroups: TransactionInstruction[][] }> {
  const single = input.lockUntil != null || input.singleTransactionRequired === true
  const jitoTipLamports = single ? 0 : (input.jitoTipLamports ?? 10000)
  if (!single && (!Number.isSafeInteger(jitoTipLamports) || jitoTipLamports < 1000 || jitoTipLamports > 100000000)) throw new Error('Jito tip must be between 1,000 and 100,000,000 lamports')
  const priorityFeeSol = input.priorityFeeSol ?? 0
  const priorityBudgetLamports = Math.round(priorityFeeSol * 1000000000)
  if (!Number.isFinite(priorityFeeSol) || priorityFeeSol < 0 || priorityFeeSol > 1 || Math.abs(priorityFeeSol - priorityBudgetLamports / 1000000000) > Number.EPSILON) throw new Error('Priority fee must be between 0 and 1 SOL with at most nine decimals')
  if (!input.name.trim() || Buffer.byteLength(input.name, 'utf8') > 32 || !input.symbol.trim() || Buffer.byteLength(input.symbol, 'utf8') > 10 || !/^(https:\/\/|ipfs:\/\/)/.test(input.metadataUri) || Buffer.byteLength(input.metadataUri, 'utf8') > 200) {
    throw new Error('Use a token name up to 32 bytes, a symbol up to 10 bytes, and an HTTPS or IPFS metadata URI up to 200 bytes')
  }
  if (input.lockUntil != null && (!Number.isSafeInteger(input.lockUntil) || input.lockUntil <= input.now || input.lockUntil > 8640000000000)) throw new Error('Choose a valid future lock date')
  if (input.lockUntil != null && !input.lockFees) throw new Error('Live Streamflow fees are required for a supply lock')
  const amounts = calculateDirectAllocations(input.totalSupply, input.decimals, input.liquidityTokenPercent, input.liquiditySol)
  // CPMM permanently retains 100 LP atomic units at initialization.
  if (amounts.liquidityRaw * amounts.liquidityLamports < BigInt(10201)) throw new Error('Initial liquidity is too small to create a usable LP position')
  const mint = input.mintKeypair.publicKey
  const programs = getDirectPrograms(input.network)
  const tokenProgram = single ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
  const tokenAccount = getAssociatedTokenAddressSync(mint, input.payer, false, tokenProgram)
  // Bundle mode isolates WSOL. Single mode deposits/spends the exact amount in
  // the wallet ATA and never closes it, preserving any pre-existing SOL there.
  const wrappedSolKeypair = single ? undefined : Keypair.generate()
  const wrappedSol = wrappedSolKeypair?.publicKey ?? getAssociatedTokenAddressSync(NATIVE_MINT, input.payer)
  const signers = [input.mintKeypair, ...(wrappedSolKeypair ? [wrappedSolKeypair] : [])]
  const [mintA, mintB] = Buffer.compare(mint.toBuffer(), NATIVE_MINT.toBuffer()) < 0 ? [mint, NATIVE_MINT] : [NATIVE_MINT, mint]
  const tokenIsA = mintA.equals(mint)
  const configId = getCpmmPdaAmmConfigId(programs.cpmm, input.configIndex ?? 0).publicKey
  const pool = getCreatePoolKeys({ programId: programs.cpmm, configId, mintA, mintB })
  const { baseSpace } = getDirectMintSpace(input, mint)
  const createMint = [
    SystemProgram.createAccount({ fromPubkey: input.payer, newAccountPubkey: mint, space: baseSpace, lamports: input.mintRentLamports, programId: tokenProgram }),
    ...(single ? [] : [createInitializeMetadataPointerInstruction(mint, null, mint, TOKEN_2022_PROGRAM_ID)]),
    createInitializeMintInstruction(mint, input.decimals, input.payer, null, tokenProgram),
    // Token-2022 initializes Some(authority), so a zero key is rejected on chain.
    // Initialize with the wallet then irrevocably clear authority in this packet.
    ...(single ? [createCreateMetadataAccountV3Instruction({ metadata: getMetaplexMetadataAddress(mint), mint, mintAuthority: input.payer, payer: input.payer, updateAuthority: PublicKey.default }, {
      createMetadataAccountArgsV3: { data: { name: input.name, symbol: input.symbol, uri: input.metadataUri, sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null }, isMutable: false, collectionDetails: null },
    })] : [createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: input.payer, mint, mintAuthority: input.payer, name: input.name, symbol: input.symbol, uri: input.metadataUri }),
      createUpdateAuthorityInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, oldAuthority: input.payer, newAuthority: null })]),
    createAssociatedTokenAccountIdempotentInstruction(input.payer, tokenAccount, input.payer, mint, tokenProgram),
    createMintToInstruction(mint, tokenAccount, input.payer, amounts.totalRaw, [], tokenProgram),
    createSetAuthorityInstruction(mint, input.payer, AuthorityType.MintTokens, null, [], tokenProgram),
  ]
  const wrapSol = [
    ...(single ? [createAssociatedTokenAccountIdempotentInstruction(input.payer, wrappedSol, input.payer, NATIVE_MINT)] : [
      SystemProgram.createAccount({ fromPubkey: input.payer, newAccountPubkey: wrappedSol, space: 165, lamports: input.wrappedSolRentLamports, programId: TOKEN_PROGRAM_ID }),
      createInitializeAccountInstruction(wrappedSol, NATIVE_MINT, input.payer, TOKEN_PROGRAM_ID),
    ]),
    SystemProgram.transfer({ fromPubkey: input.payer, toPubkey: wrappedSol, lamports: amounts.liquidityLamports }),
    createSyncNativeInstruction(wrappedSol),
  ]
  const poolIx = makeCreateCpmmPoolInInstruction(programs.cpmm, input.payer, configId, pool.authority, pool.poolId, mintA, mintB, pool.lpMint,
    tokenIsA ? tokenAccount : wrappedSol, tokenIsA ? wrappedSol : tokenAccount,
    getAssociatedTokenAddressSync(pool.lpMint, input.payer), pool.vaultA, pool.vaultB, programs.cpmmFee,
    tokenIsA ? tokenProgram : TOKEN_PROGRAM_ID, tokenIsA ? TOKEN_PROGRAM_ID : tokenProgram,
    pool.observationId, new BN((tokenIsA ? amounts.liquidityRaw : amounts.liquidityLamports).toString()), new BN((tokenIsA ? amounts.liquidityLamports : amounts.liquidityRaw).toString()), new BN(0))
  const groups = [createMint, wrapSol, [poolIx, ...(single ? [] : [createCloseAccountInstruction(wrappedSol, input.payer, input.payer)])]]
  let lockAddress: PublicKey | null = null
  let developerRaw = amounts.developerRaw
  let tokenFeeRaw = BigInt(0)
  let roundingFeeRaw = BigInt(0)
  if (input.lockUntil != null) {
    const fees = input.lockFees!
    const allocation = allocateLockReserve(amounts.developerRaw, fees.streamflowLockFee + fees.partnerFee)
    developerRaw = allocation.netRaw
    tokenFeeRaw = allocation.protocolFeeRaw + allocation.roundingFeeRaw
    roundingFeeRaw = allocation.roundingFeeRaw
    const metadataKeypair = input.lockMetadataKeypair ?? Keypair.generate()
    input = { ...input, lockMetadataKeypair: metadataKeypair }
    signers.push(metadataKeypair)
    const lock = await buildStreamflowLockInstruction({ payer: input.payer, mint, amountRaw: developerRaw, unlockDate: input.lockUntil!, network: input.network, recipient: input.lockRecipient, metadataKeypair, tokenProgram })
    lockAddress = lock.metadata
    if (!single) wrapSol.push(
      createAssociatedTokenAccountIdempotentInstruction(input.payer, getAssociatedTokenAddressSync(mint, WITHDRAWOR_PUBLIC_KEY, true, TOKEN_2022_PROGRAM_ID), WITHDRAWOR_PUBLIC_KEY, mint, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountIdempotentInstruction(input.payer, getAssociatedTokenAddressSync(mint, STREAMFLOW_TREASURY_PUBLIC_KEY, true, TOKEN_2022_PROGRAM_ID), STREAMFLOW_TREASURY_PUBLIC_KEY, mint, TOKEN_2022_PROGRAM_ID),
    )
    const lockIxs = [lock.instruction]
    // A fee rounded to zero may leave the treasury ATA uncreated. The initialized
    // protocol escrow always exists; surplus deposits are handled by Streamflow.
    if (roundingFeeRaw > BigInt(0)) lockIxs.push(createTransferCheckedInstruction(tokenAccount, mint, lock.escrow, input.payer, roundingFeeRaw, input.decimals, [], tokenProgram))
    groups.push(lockIxs)
  }
  if (jitoTipLamports > 0) groups[groups.length - 1].push(SystemProgram.transfer({ fromPubkey: input.payer, toPubkey: new PublicKey(JITO_TIP_ACCOUNTS[0]), lamports: jitoTipLamports }))
  const { transactions, priorityFeeLamports } = compileGroups(groups, input.payer, input.blockhash, signers, priorityBudgetLamports, input)
  const feeSol = input.lockUntil != null ? BigInt(input.lockFees!.creationFeeSol) : BigInt(0)
  const poolFee = BigInt(input.poolCreationFeeLamports ?? '0')
  const rentFees = BigInt(input.estimatedRentAndNetworkFeeLamports ?? '0')
  return {
    transactions, signers, mint, poolAddress: pool.poolId, lockAddress, metadataUri: input.metadataUri,
    requiresAtomicBundle: !single, blockhash: input.blockhash, lastValidBlockHeight: input.lastValidBlockHeight,
    instructionGroups: groups,
    summary: {
      totalTokenAmount: amounts.totalRaw.toString(), liquidityTokenAmount: amounts.liquidityRaw.toString(), developerTokenAmount: developerRaw.toString(),
      developerGrossTokenAmount: amounts.developerRaw.toString(), lockFeeTokenAmount: tokenFeeRaw.toString(), lockRoundingFeeTokenAmount: roundingFeeRaw.toString(),
      lockFeeSol: feeSol.toString(), lockFeePercent: input.lockUntil != null ? input.lockFees!.streamflowLockFee + input.lockFees!.partnerFee : 0,
      liquiditySolLamports: amounts.liquidityLamports.toString(), liquidityTokenPercent: input.liquidityTokenPercent,
      developerTokenPercent: Number(developerRaw * BigInt(1000000) / amounts.totalRaw) / 10000,
      lockFeeTokenPercent: Number(tokenFeeRaw * BigInt(1000000) / amounts.totalRaw) / 10000,
      decimals: input.decimals, platformFeeBps: 0, developerLocked: input.lockUntil != null, lockUntil: input.lockUntil ?? null,
      mintAuthorityRevoked: true, freezeAuthorityRevoked: true, metadataAuthorityRevoked: true, lpTokensDisposition: 'wallet',
      poolCreationFeeLamports: poolFee.toString(), estimatedRentAndNetworkFeeLamports: rentFees.toString(),
      jitoTipLamports: String(jitoTipLamports), priorityFeeLamports: String(priorityFeeLamports),
      estimatedTotalSolLamports: (amounts.liquidityLamports + feeSol + poolFee + rentFees + BigInt(jitoTipLamports) + BigInt(priorityFeeLamports)).toString(),
    },
  }
}
