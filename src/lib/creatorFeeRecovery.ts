import { Connection, PublicKey } from '@solana/web3.js'
import { NATIVE_MINT } from '@solana/spl-token'
import { bondingCurvePda, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_SDK, Platform } from '@pump-fun/pump-sdk'
import { parseResolvedCreatorFeeRouting, type ResolvedCreatorFeeRouting } from './creatorFeeRouting'
import { withTimeout } from './transactions/http'

/** Read-only recovery. A mismatch preserves the caller's recovery record. */
export async function verifyCreatorFeeRoutingOnChain(connection: Connection, value: ResolvedCreatorFeeRouting, binding: { payer: string; mint: string }): Promise<void> {
  const routing = parseResolvedCreatorFeeRouting(value)
  if (routing.payer !== binding.payer || routing.mint !== binding.mint) throw new Error('Recorded creator fee routing does not match this launch payer and mint. Recovery information is preserved.')
  const mint = new PublicKey(routing.mint)
  const addresses = [bondingCurvePda(mint), ...(routing.selection.kind === 'github' ? [new PublicKey(routing.sharingConfig!), new PublicKey(routing.socialRecipient!)] : [])]
  const [curveInfo, sharingInfo, socialInfo] = await withTimeout(connection.getMultipleAccountsInfo(addresses, 'confirmed'))
  if (!curveInfo?.owner.equals(PUMP_PROGRAM_ID)) throw new Error('The Pump bonding curve could not be verified. Recovery information is preserved.')
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo)
  if (!(curve.quoteMint.equals(PublicKey.default) || curve.quoteMint.equals(NATIVE_MINT)) || curve.creator.toBase58() !== routing.effectiveCreator || curve.isHolderReward !== routing.holderReward || curve.isCashbackCoin !== false) throw new Error('On-chain creator fee recipient or flags differ from the reviewed launch. Recovery information is preserved.')
  if (routing.selection.kind === 'github') {
    if (!sharingInfo?.owner.equals(PUMP_FEE_PROGRAM_ID) || !socialInfo?.owner.equals(PUMP_FEE_PROGRAM_ID)) throw new Error('GitHub fee sharing accounts could not be verified. Recovery information is preserved.')
    const sharing = PUMP_SDK.decodeSharingConfig(sharingInfo), social = PUMP_SDK.decodeSocialFeePda(socialInfo)
    if (!sharing.mint.equals(mint) || sharing.adminRevoked !== true || sharing.shareholders.length !== 1 || sharing.shareholders[0].address.toBase58() !== routing.socialRecipient || sharing.shareholders[0].shareBps !== 10000 || social.platform !== Platform.GitHub || social.userId !== routing.github!.userId) throw new Error('On-chain GitHub identity, 100% fee share, or permanent configuration differs from the reviewed launch. Recovery information is preserved.')
  }
}
