import { AddressLookupTableProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
export const lookupCacheKey = (payer: string, mint: string) => `vanity-lookup-${payer}-${mint}`
export function buildLookupSetup(input: { payer: PublicKey; recentSlot: number; blockhash: string; addresses: PublicKey[]; existingTable?: PublicKey }) {
  const addresses = [...new Map(input.addresses.map(key => [key.toBase58(), key])).values()]
  if (!addresses.length || addresses.length > 20) throw new Error('Launch setup requires 1–20 new account addresses.')
  const [create, newAddress] = AddressLookupTableProgram.createLookupTable({ authority: input.payer, payer: input.payer, recentSlot: input.recentSlot })
  const address = input.existingTable || newAddress
  const instructions = [...(input.existingTable ? [] : [create]), AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: input.payer, payer: input.payer, addresses })]
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: input.payer, recentBlockhash: input.blockhash, instructions }).compileToV0Message())
  if (transaction.serialize().length > 1232) throw new Error('The launch setup transaction exceeds the network packet size.')
  return { transaction, address }
}
