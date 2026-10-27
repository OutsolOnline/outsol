import { AddressLookupTableAccount, Keypair } from '@solana/web3.js'
import { buildDirectLaunchInstructions, LaunchLookupTableRequiredError, type DirectInstructionContext } from '../src/lib/launch/instructions'

/** Offline packet-size fixture only; this synthetic table is never submitted. */
export async function buildWithSyntheticLookupTables(input: DirectInstructionContext) {
  try { return await buildDirectLaunchInstructions(input) }
  catch (error) {
    if (!(error instanceof LaunchLookupTableRequiredError)) throw error
    const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, addresses: error.addresses } })
    return buildDirectLaunchInstructions({ ...input, ...error.resumeInput, lookupTables: [table] })
  }
}
