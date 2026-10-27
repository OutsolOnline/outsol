import { readFile } from 'node:fs/promises'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from '@solana/web3.js'

const [payerPath, mintPath, metadataUri, initialBuyText, maxSpendText] = process.argv.slice(2)
const shouldBroadcast = process.argv.includes('--broadcast')
if (!payerPath || !mintPath || !metadataUri || !initialBuyText || !maxSpendText) {
  throw new Error('Usage: node scripts/prepare-test-launch.mjs <payer> <mint> <metadata-uri> <initial-buy-sol> <max-spend-sol>')
}

const loadKeypair = async (path) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(await readFile(path, 'utf8')))
)

const payer = await loadKeypair(payerPath)
const mint = await loadKeypair(mintPath)
const initialBuy = Number(initialBuyText)
const maxSpend = Number(maxSpendText)

if (!Number.isFinite(initialBuy) || initialBuy < 0 || !Number.isFinite(maxSpend) || maxSpend <= 0) {
  throw new Error('Invalid spend limits')
}

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com'
const connection = new Connection(rpcUrl, 'confirmed')
const beforeLamports = await connection.getBalance(payer.publicKey, 'confirmed')

const response = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: payer.publicKey.toBase58(),
    action: 'create',
    tokenMetadata: { name: 'test', symbol: 'test', uri: metadataUri },
    mint: mint.publicKey.toBase58(),
    denominatedInSol: 'true',
    amount: initialBuy,
    slippage: 10,
    priorityFee: 0.00005,
    pool: 'pump',
  }),
})

if (!response.ok) {
  throw new Error(`PumpPortal rejected transaction build: ${response.status} ${await response.text()}`)
}

const transaction = VersionedTransaction.deserialize(new Uint8Array(await response.arrayBuffer()))
const message = transaction.message
const lookupTableAccounts = await Promise.all(message.addressTableLookups.map(async ({ accountKey }) => {
  const lookup = await connection.getAddressLookupTable(accountKey)
  if (!lookup.value) throw new Error(`Missing address lookup table: ${accountKey.toBase58()}`)
  return lookup.value
}))
const accountKeys = message.getAccountKeys({ addressLookupTableAccounts: lookupTableAccounts })

const requiredSigners = message.staticAccountKeys
  .slice(0, message.header.numRequiredSignatures)
  .map((key) => key.toBase58())
const expectedSigners = [payer.publicKey.toBase58(), mint.publicKey.toBase58()]
if (requiredSigners.length !== 2 || expectedSigners.some((key) => !requiredSigners.includes(key))) {
  throw new Error(`Unexpected required signers: ${requiredSigners.join(', ')}`)
}
if (!message.staticAccountKeys[0].equals(payer.publicKey)) {
  throw new Error('Burner wallet is not the transaction fee payer')
}

const allowedPrograms = new Set([
  '11111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
])
const invokedPrograms = [...new Set(message.compiledInstructions.map(
  (instruction) => accountKeys.get(instruction.programIdIndex).toBase58()
))]
const unexpectedPrograms = invokedPrograms.filter((program) => !allowedPrograms.has(program))
if (unexpectedPrograms.length > 0) {
  throw new Error(`Unexpected invoked programs: ${unexpectedPrograms.join(', ')}`)
}

transaction.sign([payer, mint])
const simulation = await connection.simulateTransaction(transaction, {
  sigVerify: true,
  replaceRecentBlockhash: false,
  accounts: { encoding: 'base64', addresses: [payer.publicKey.toBase58()] },
})
if (simulation.value.err) {
  throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`)
}

const afterLamports = simulation.value.accounts?.[0]?.lamports
if (typeof afterLamports !== 'number') {
  throw new Error('Simulation did not return the burner post-transaction balance')
}
const spendLamports = beforeLamports - afterLamports
const maxSpendLamports = Math.floor(maxSpend * LAMPORTS_PER_SOL)
if (spendLamports < 0 || spendLamports > maxSpendLamports) {
  throw new Error(`Simulated spend ${(spendLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL exceeds cap ${maxSpend.toFixed(9)} SOL`)
}

let signature = null
if (shouldBroadcast) {
  signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  })
  const confirmation = await connection.confirmTransaction(signature, 'confirmed')
  if (confirmation.value.err) {
    throw new Error(`Broadcast transaction failed: ${JSON.stringify(confirmation.value.err)}`)
  }
}

process.stdout.write(JSON.stringify({
  payer: payer.publicKey.toBase58(),
  mint: mint.publicKey.toBase58(),
  requiredSigners,
  lookupTables: message.addressTableLookups.map(({ accountKey }) => accountKey.toBase58()),
  invokedPrograms,
  simulatedSpendSol: spendLamports / LAMPORTS_PER_SOL,
  remainingSol: afterLamports / LAMPORTS_PER_SOL,
  simulationUnits: simulation.value.unitsConsumed,
  broadcast: shouldBroadcast,
  signature,
  simulationLogs: simulation.value.logs,
}, null, 2))
