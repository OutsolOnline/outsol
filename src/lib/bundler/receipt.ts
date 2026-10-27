import type {BundleResult} from './types'
import {parseResolvedCreatorFeeRouting} from '@/lib/creatorFeeRouting'

/** Deliberately pick public fields; do not persist the surrounding store. */
export function publicBundleReceipt(receipt:BundleResult|null):BundleResult|null {
  if(!receipt) return null
  const routing=receipt.creatorFeeRouting===undefined?undefined:parseResolvedCreatorFeeRouting(receipt.creatorFeeRouting)
  if(routing&&routing.mint!==receipt.mintAddress)throw new Error('Bundle creator fee routing does not match the saved mint. Preserve the recovery record.')
  return {
    success:receipt.success,status:receipt.status,mintAddress:receipt.mintAddress,
    createSignature:receipt.createSignature,bundleId:receipt.bundleId,
    buySignatures:receipt.buySignatures,sellSignature:receipt.sellSignature,
    bundleSellSignatures:receipt.bundleSellSignatures,submittedSignatures:receipt.submittedSignatures,error:receipt.error,
    ...(receipt.submissions?{submissions:receipt.submissions.map(item=>({signature:item.signature,payer:item.payer,blockhash:item.blockhash,expiresAfterBlockHeight:item.expiresAfterBlockHeight,submittedAt:item.submittedAt}))}:{}),
    ...(routing?{creatorFeeRouting:routing}:{}),
  }
}
