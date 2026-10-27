import { readFile } from 'node:fs/promises'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js'

const [payerPath, mintText, amountText, minimumBalanceText] = process.argv.slice(2)
const shouldBroadcast = process.argv.includes('--broadcast')
if (!payerPath || !mintText || !amountText || !minimumBalanceText) {
  throw new Error('Usage: node scripts/execute-capped-buy.mjs <payer> <mint> <amount-sol> <minimum-final-balance-sol> [--broadcast]')
}

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(payerPath, 'utf8'))))
const mint = new PublicKey(mintText)
const amount = Number(amountText)
const minimumBalance = Number(minimumBalanceText)
if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(minimumBalance) || minimumBalance < 0) {
  throw new Error('Invalid buy or balance limit')
}

const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed')
if (!await connection.getAccountInfo(mint, 'confirmed')) throw new Error('Mint is not confirmed on-chain')
const beforeLamports = await connection.getBalance(payer.publicKey, 'confirmed')

const response = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: payer.publicKey.toBase58(),
    action: 'buy',
    mint: mint.toBase58(),
    denominatedInSol: 'true',
    amount,
    slippage: 10,
    priorityFee: 0.00005,
    pool: 'pump',
  }),
})
if (!response.ok) throw new Error(`PumpPortal rejected buy build: ${response.status} ${await response.text()}`)

const transaction = VersionedTransaction.deserialize(new Uint8Array(await response.arrayBuffer()))
const message = transaction.message
const lookupTableAccounts = await Promise.all(message.addressTableLookups.map(async ({ accountKey }) => {
  const lookup = await connection.getAddressLookupTable(accountKey)
  if (!lookup.value) throw new Error(`Missing address lookup table: ${accountKey.toBase58()}`)
  return lookup.value
}))
const accountKeys = message.getAccountKeys({ addressLookupTableAccounts: lookupTableAccounts })
const requiredSigners = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map((key) => key.toBase58())
if (requiredSigners.length !== 1 || requiredSigners[0] !== payer.publicKey.toBase58()) {
  throw new Error(`Unexpected required signers: ${requiredSigners.join(', ')}`)
}
if (!message.staticAccountKeys[0].equals(payer.publicKey)) throw new Error('Burner wallet is not the fee payer')

const allowedPrograms = new Set([
  'ComputeBudget111111111111111111111111111111',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
])
const invokedPrograms = [...new Set(message.compiledInstructions.map(
  (instruction) => accountKeys.get(instruction.programIdIndex).toBase58()
))]
const unexpectedPrograms = invokedPrograms.filter((program) => !allowedPrograms.has(program))

transaction.sign([payer])
const simulation = await connection.simulateTransaction(transaction, {
  sigVerify: true,
  replaceRecentBlockhash: false,
  accounts: { encoding: 'base64', addresses: [payer.publicKey.toBase58()] },
})
if (simulation.value.err) throw new Error(`Buy simulation failed: ${JSON.stringify(simulation.value.err)}`)
if (unexpectedPrograms.length && shouldBroadcast) {
  throw new Error(`Broadcast blocked for unexpected invoked programs: ${unexpectedPrograms.join(', ')}`)
}
const afterLamports = simulation.value.accounts?.[0]?.lamports
if (typeof afterLamports !== 'number') throw new Error('Simulation did not return burner balance')
const minimumLamports = Math.ceil(minimumBalance * LAMPORTS_PER_SOL)
if (afterLamports < minimumLamports) {
  throw new Error(`Simulated final balance ${(afterLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL violates minimum ${minimumBalance.toFixed(9)} SOL`)
}

let signature = null
if (shouldBroadcast) {
  signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 })
  const confirmation = await connection.confirmTransaction(signature, 'confirmed')
  if (confirmation.value.err) throw new Error(`Buy failed: ${JSON.stringify(confirmation.value.err)}`)
}

process.stdout.write(JSON.stringify({
  payer: payer.publicKey.toBase58(),
  mint: mint.toBase58(),
  amountSol: amount,
  requiredSigners,
  invokedPrograms,
  unexpectedPrograms,
  simulatedSpendSol: (beforeLamports - afterLamports) / LAMPORTS_PER_SOL,
  simulatedFinalBalanceSol: afterLamports / LAMPORTS_PER_SOL,
  broadcast: shouldBroadcast,
  signature,
  simulationLogs: simulation.value.logs,
}, null, 2))
