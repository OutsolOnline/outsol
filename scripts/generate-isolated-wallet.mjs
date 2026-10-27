import { writeFile } from 'node:fs/promises'
import { Keypair } from '@solana/web3.js'

const outputPath = process.argv[2]

if (!outputPath) {
  throw new Error('Usage: node scripts/generate-isolated-wallet.mjs <output-path>')
}

const wallet = Keypair.generate()
await writeFile(outputPath, JSON.stringify(Array.from(wallet.secretKey)), {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
})

process.stdout.write(`${wallet.publicKey.toBase58()}\n`)
