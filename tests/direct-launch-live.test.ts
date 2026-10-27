import { describe, expect, it } from 'vitest'
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { STREAMFLOW_TREASURY_PUBLIC_KEY, decodeStream } from '@streamflow/stream'
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackMint, unpackAccount, getMetadataPointerState, getExtensionData, ExtensionType } from '@solana/spl-token'
import { unpack } from '@solana/spl-token-metadata'
import { buildDirectLaunchPlan } from '../src/lib/launch'
import { readFileSync } from 'node:fs'
import { LaunchLookupTableRequiredError, buildDirectLaunchInstructions, getDirectPrograms, getMetaplexMetadataAddress, type DirectInstructionContext } from '../src/lib/launch/instructions'
import { Metadata } from '@metaplex-foundation/mpl-token-metadata'

// Explicit opt-in. Only public RPC reads; no wallet signer and no send methods exist here.
describe.skipIf(process.env.RUN_DIRECT_LAUNCH_RPC !== '1')('direct launch public mainnet preparation', () => {
  it('reads actual protocol configurations and prepares bounded, unsigned-by-wallet atomic packets', async () => {
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
    const plan = await buildDirectLaunchPlan({
      connection, payer: STREAMFLOW_TREASURY_PUBLIC_KEY,
      name: 'Preparation Only', symbol: 'PREP', metadataUri: 'https://example.com/token.json',
      totalSupply: '1000000', decimals: 6, liquidityTokenPercent: 80, liquiditySol: '0.01',
      network: 'mainnet-beta',
    })
    expect(plan.transactions.length).toBeGreaterThan(1)
    expect(plan.transactions.length).toBeLessThanOrEqual(5)
    expect(plan.lockAddress).toBeNull()
    expect(plan.summary.platformFeeBps).toBe(0)
    expect(BigInt(plan.summary.estimatedTotalSolLamports)).toBeGreaterThan(BigInt('10000000'))
    expect(BigInt(plan.summary.liquidityTokenAmount) + BigInt(plan.summary.developerTokenAmount) + BigInt(plan.summary.lockFeeTokenAmount)).toBe(BigInt('1000000000000'))
    for (const tx of plan.transactions) {
      expect(tx.serialize().length).toBeLessThanOrEqual(1232)
      expect(tx.signatures[0].every(byte => byte === 0)).toBe(true)
      // Decompilation must work without any external address table lifecycle transaction.
      expect(TransactionMessage.decompile(tx.message).payerKey.equals(STREAMFLOW_TREASURY_PUBLIC_KEY)).toBe(true)
    }
    // New mint is still absent, proving preparation did not broadcast a creation.
    expect(await connection.getAccountInfo(plan.mint, 'confirmed')).toBeNull()
  }, 30000)
})

describe.skipIf(process.env.RUN_DIRECT_LAUNCH_SIMULATION !== '1')('direct launch complete-bank simulation', () => {
  it.each([{ locking: false, single: false }, { locking: false, single: true }, { locking: true, single: true }])('simulates canonical instructions against one bank without broadcasting (lock=$locking, single=$single)', async ({ locking, single }) => {
    const env = readFileSync('.env.local', 'utf8')
    const configured = env.match(/^\s*RPC_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '')
    if (!configured) throw new Error('Configure a private RPC with complete bundle simulation support')
    const connection = new Connection(configured, 'confirmed')
    let plan: Awaited<ReturnType<typeof buildDirectLaunchPlan>>
    let simulationTransactions: VersionedTransaction[]
    try {
      plan = await buildDirectLaunchPlan({
        connection, payer: new PublicKey('ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u'), name: single ? 'N'.repeat(32) : 'Simulation Only', symbol: single ? 'S'.repeat(10) : 'SIM',
        metadataUri: single ? ('https://vanity-production-2bbb.up.railway.app/api/assets/' + 'a'.repeat(64) + '.json').padEnd(126, 'a') : 'https://example.com/vanity-test.json', totalSupply: locking ? '0.001' : '1000000', decimals: 6,
        liquidityTokenPercent: 80, liquiditySol: '0.01', network: 'mainnet-beta',
        lockUntil: locking ? Math.floor(Date.now() / 1000) + 7 * 86400 : null, singleTransactionRequired: single,
        jitoTipLamports: 10000, priorityFeeSol: 0.00003,
      })
      simulationTransactions = plan.transactions
    } catch (error) {
      if (!(error instanceof LaunchLookupTableRequiredError)) throw new Error('Read-only preparation failed; RPC credentials were suppressed')
      // A fresh mint's ALT does not exist on chain yet. Measure the exact single packet
      // offline, then verify the same compact canonical instructions against one bank.
      // Actual one-packet simulation remains mandatory after wallet-created ALT setup.
      const lookup = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, addresses: error.addresses } })
      const prepared = await buildDirectLaunchInstructions({ ...(error.resumeInput as DirectInstructionContext), lookupTables: [lookup] })
      plan = prepared
      expect(prepared.transactions).toHaveLength(1)
      expect(prepared.transactions[0].serialize().length).toBeLessThanOrEqual(1232)
      simulationTransactions = prepared.instructionGroups.map(instructions => new VersionedTransaction(new TransactionMessage({
        payerKey: prepared.transactions[0].message.staticAccountKeys[0], recentBlockhash: prepared.blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), ...instructions],
      }).compileToV0Message()))
    }
    const payer = new PublicKey('ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u')
    const tokenProgram = single ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
    const tokenAccount = getAssociatedTokenAddressSync(plan.mint, payer, false, tokenProgram)
    const wrappedSolAddress = getAssociatedTokenAddressSync(NATIVE_MINT, payer)
    const poolInstruction = simulationTransactions.flatMap(tx => TransactionMessage.decompile(tx.message).instructions).find(ix => ix.programId.equals(getDirectPrograms('mainnet-beta').cpmm))!
    const poolResultAddresses = [poolInstruction.keys[10].pubkey, poolInstruction.keys[11].pubkey, poolInstruction.keys[9].pubkey, plan.poolAddress]
    const postAddresses = [plan.mint.toBase58(), tokenAccount.toBase58(), ...(plan.lockAddress ? [plan.lockAddress.toBase58()] : []), ...(single ? [getMetaplexMetadataAddress(plan.mint).toBase58(), wrappedSolAddress.toBase58()] : []), ...poolResultAddresses.map(address => address.toBase58())]
    let response: Record<string, any>
    try {
      const request = await fetch(configured, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'simulateBundle', params: [
          { encodedTransactions: simulationTransactions.map(tx => Buffer.from(tx.serialize()).toString('base64')) },
          { preExecutionAccountsConfigs: simulationTransactions.map((_, index) => single && index === 0 ? { encoding: 'base64', addresses: [wrappedSolAddress.toBase58()] } : null), postExecutionAccountsConfigs: simulationTransactions.map((_, index) => index === simulationTransactions.length - 1 ? { encoding: 'base64', addresses: postAddresses } : null), transactionEncoding: 'base64', skipSigVerify: true, replaceRecentBlockhash: true },
        ],
      }) })
      response = await request.json()
    } catch { throw new Error('Read-only complete-bundle simulation failed; RPC credentials were suppressed') }
    if (response.error) throw new Error(`Bundle simulation RPC returned error code ${response.error.code}`)
    const value = response.result?.value
    if (value?.summary !== 'succeeded') {
      const errors = value?.transactionResults?.map((tx: { err: unknown }) => tx.err)
      const logs = value?.transactionResults?.flatMap((tx: { logs?: string[] }) => tx.logs ?? []).slice(-20)
      throw new Error(`Bundle simulation did not succeed: ${JSON.stringify(value?.summary)}. Transaction errors: ${JSON.stringify(errors)}. Program logs: ${JSON.stringify(logs)}`)
    }
    expect(value.transactionResults.length).toBe(simulationTransactions.length)
    expect(value.transactionResults.every((tx: { err: unknown }) => tx.err === null)).toBe(true)
    const accounts = value.transactionResults[value.transactionResults.length - 1].postExecutionAccounts
    const accountInfo = (account: any) => ({ ...account, owner: new PublicKey(account.owner), data: Buffer.from(account.data[0], 'base64') })
    const poolResults = accounts.slice(-4)
    const vaultA = unpackAccount(poolResultAddresses[0], accountInfo(poolResults[0]), new PublicKey(poolResults[0].owner))
    const vaultB = unpackAccount(poolResultAddresses[1], accountInfo(poolResults[1]), new PublicKey(poolResults[1].owner))
    const tokenVault = vaultA.mint.equals(plan.mint) ? vaultA : vaultB
    const solVault = vaultA.mint.equals(NATIVE_MINT) ? vaultA : vaultB
    expect(tokenVault.amount.toString()).toBe(plan.summary.liquidityTokenAmount)
    expect(solVault.amount.toString()).toBe(plan.summary.liquiditySolLamports)
    const lpAccount = unpackAccount(poolResultAddresses[2], accountInfo(poolResults[2]), TOKEN_PROGRAM_ID)
    expect(lpAccount.owner.equals(payer)).toBe(true)
    expect(lpAccount.amount > BigInt(0)).toBe(true)
    expect(poolResults[3].owner).toBe(getDirectPrograms('mainnet-beta').cpmm.toBase58())
    const mint = unpackMint(plan.mint, accountInfo(accounts[0]), tokenProgram)
    expect(mint.supply.toString()).toBe(locking ? '1000' : '1000000000000')
    expect(mint.mintAuthority).toBeNull()
    expect(mint.freezeAuthority).toBeNull()
    if (!single) {
      expect(getMetadataPointerState(mint)?.authority).toBeNull()
      expect(unpack(getExtensionData(ExtensionType.TokenMetadata, mint.tlvData)!).updateAuthority).toBeUndefined()
    }
    const remaining = unpackAccount(tokenAccount, accountInfo(accounts[1]), tokenProgram)
    expect(remaining.amount.toString()).toBe(locking ? '0' : plan.summary.developerTokenAmount)
    if (locking) {
      const lock = decodeStream(accountInfo(accounts[2]).data)
      expect(lock.depositedAmount.toString()).toBe(plan.summary.developerTokenAmount)
      expect(lock.cancelableBySender).toBe(false)
      expect(lock.cancelableByRecipient).toBe(false)
      expect(lock.transferableBySender).toBe(false)
      expect(lock.transferableByRecipient).toBe(false)
      expect(lock.cliff.toString()).toBe(String(plan.summary.lockUntil))
    }
    if (single) {
      const metadataIndex = locking ? 3 : 2
      const wrappedIndex = locking ? 4 : 3
      const [metadata] = Metadata.deserialize(accountInfo(accounts[metadataIndex]).data)
      expect(metadata.data.name.replace(/\0/g, '')).toBe('N'.repeat(32))
      expect(metadata.data.symbol.replace(/\0/g, '')).toBe('S'.repeat(10))
      expect(metadata.data.uri.replace(/\0/g, '')).toBe(plan.metadataUri)
      expect(metadata.isMutable).toBe(false)
      expect(metadata.updateAuthority.equals(PublicKey.default)).toBe(true)
      const beforeWrappedSol = value.transactionResults[0].preExecutionAccounts?.[0]
      if (beforeWrappedSol) expect(accounts[wrappedIndex].lamports).toBe(beforeWrappedSol.lamports)
      else expect(unpackAccount(wrappedSolAddress, accountInfo(accounts[wrappedIndex]), TOKEN_PROGRAM_ID).amount.toString()).toBe('0')
      const units = value.transactionResults.reduce((sum: number, tx: { unitsConsumed?: number }) => sum + (tx.unitsConsumed ?? 0), 0)
      expect(units).toBeLessThan(1400000)
      console.log(JSON.stringify({ compactSingleCanonicalUnits: units, locking, equivalentSimulationPackets: simulationTransactions.length, singlePacketBytes: plan.transactions[0].serialize().length }))
    }
    expect(await connection.getAccountInfo(plan.mint, 'confirmed')).toBeNull()
  }, 45000)
})
