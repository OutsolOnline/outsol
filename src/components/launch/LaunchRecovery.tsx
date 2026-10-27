'use client'
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PendingLaunch, readPending, saveConfirmed, clearPendingIfMatching, samePending, savePending } from '@/lib/launchHistory'
import { confirmSignatures } from '@/lib/transactions/send'
import { useLaunchStore } from '@/stores/launchStore'
import { lookupCacheKey } from '@/lib/launchLookup'
import { checkLaunchExpiry } from '@/lib/launchExpiry'
import { creatorFeeRoutingLabel } from '@/lib/creatorFeeRouting'
import { verifyCreatorFeeRoutingOnChain } from '@/lib/creatorFeeRecovery'

export function LaunchRecovery() {
  const { connection } = useConnection()
  const router = useRouter()
  const [pending, setPending] = useState<PendingLaunch | null>(null)
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState(false)
  useEffect(() => { try { setPending(readPending()) } catch (e) { setMessage(e instanceof Error ? e.message : 'Recovery storage is unavailable.') } }, [])
  const performCheck = async () => {
    if (!pending || checking) return
    setChecking(true)
    try {
      const latest = readPending()
      if (!samePending(latest, pending)) { setPending(latest); setMessage('The saved launch changed. Check the current submission.'); return }
      const receipt = await confirmSignatures(connection, pending.signatures, { timeoutMs: 10000, pollIntervalMs: 1500 })
      if (pending.phase === 'lookup' && pending.lookupTableAddress) {
        const table = (await connection.getAddressLookupTable(new PublicKey(pending.lookupTableAddress))).value
        if (table && table.state.authority?.toBase58() === pending.payer) {
          localStorage.setItem(lookupCacheKey(pending.payer, pending.mint), table.key.toBase58())
          clearPendingIfMatching(pending); setPending(null); setMessage('Launch setup confirmed. Prepare your launch again with the same mint keypair.'); return
        }
        const expiry = await checkLaunchExpiry(connection, pending)
        if (expiry.record.expiresAfterBlockHeight !== pending.expiresAfterBlockHeight) { savePending(expiry.record); setPending(expiry.record) }
        if (expiry.expired) { clearPendingIfMatching(pending); setPending(null); setMessage('The setup did not land. You can prepare it again.'); return }
        setMessage('Setup confirmation is pending. Check again shortly.'); return
      }
      const mint = await connection.getAccountInfo(new PublicKey(pending.mint), 'confirmed')
      if (receipt.status === 'confirmed') {
        const expected = [pending.poolAddress, pending.lockAddress].filter(Boolean).map(address => new PublicKey(address!))
        if (expected.length && (await connection.getMultipleAccountsInfo(expected, 'confirmed')).some(account => !account)) throw new Error('The pool or lock account is not available yet. Check again shortly.')
        if (!mint) throw new Error('The token account is not available yet. Check again shortly.')
        if (pending.creatorFeeRouting) await verifyCreatorFeeRoutingOnChain(connection, pending.creatorFeeRouting, pending)
        useLaunchStore.getState().setReceipt(saveConfirmed(pending))
        useLaunchStore.getState().setStep('result')
        setPending(null); router.push('/launch'); return
      }
      const expiry = await checkLaunchExpiry(connection, pending)
      if (expiry.record.expiresAfterBlockHeight !== pending.expiresAfterBlockHeight) { savePending(expiry.record); setPending(expiry.record) }
      // Only release the retry guard after expiry, no mint, and no successful packet.
      if (expiry.expired) {
        clearPendingIfMatching(pending); setPending(null)
        setMessage('The previous launch expired or failed without creating a token. You can safely prepare it again.')
      } else setMessage(receipt.error || 'Confirmation is still pending. Check again before launching another token.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Confirmation is unavailable. Your saved signatures are preserved.') }
    finally { setChecking(false) }
  }
  const check = async () => {
    if (!navigator.locks) { setMessage('Use an up-to-date browser to coordinate recovery safely.'); return }
    await navigator.locks.request('vanity-launch-submission', { ifAvailable: true }, async lock => {
      if (!lock) { setMessage('Another tab is signing or checking a launch. Finish there first.'); return }
      await performCheck()
    })
  }
  if (!pending) return message ? <p className="notice mb-6" role="status">{message}</p> : null
  return <div className="notice mb-7 space-y-3"><h2 className="text-sm text-foreground">Recover your previous launch</h2><p>A submission is waiting for a confirmation check. Its public signatures are saved on this device.</p><p>{pending.creatorFeeRouting ? `Reviewed creator fee recipient: ${creatorFeeRoutingLabel(pending.creatorFeeRouting)}. Confirmation includes checking the recorded route on chain.` : 'Legacy receipt: creator fee routing was not recorded and is unverified.'}</p><div className="flex flex-wrap gap-3">{pending.signatures.map((signature, i) => <a href={`https://solscan.io/tx/${signature}`} key={signature} target="_blank" rel="noreferrer" className="underline">Transaction {i + 1} ↗</a>)}</div>{message && <p role="status">{message}</p>}<Button onClick={check} disabled={checking} variant="secondary">{checking ? 'Checking on chain…' : 'Check confirmation'}</Button></div>
}
