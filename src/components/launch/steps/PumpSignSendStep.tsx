'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import { ArrowRight, Check, Clock3, ExternalLink, Loader2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BuyPresets } from '../BuyPresets'
import { useLaunchStore } from '@/stores/launchStore'
import { usePlatformWalletStore } from '@/stores/walletStore'
import { validatePumpCreation } from '@/lib/pumpProductPolicy'
import { buildCreateTransaction, uploadMetadataToIPFS } from '@/lib/pumpfun/api'
import { simulateAtomicBundle, submitAtomicBundle } from '@/lib/bundler/jito'
import { assertSubmissionSigner, sendAndConfirmTransaction, signedTransactionSignature } from '@/lib/transactions/send'
import { clearPendingIfMatching, readPending, saveConfirmed, savePending, type PendingLaunch } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import { assertNoPendingBundleReceipt } from '@/lib/bundler/pending'
import type { LaunchConfig } from '@/lib/launchConfig'
import {withTimeout} from '@/lib/transactions/http'
import { CreatorFeeFields } from '../CreatorFeeFields'
import { creatorFeeRoutingLabel, requireSupportedCreatorFeeSelection, type VerifiedGitHubIndividual } from '@/lib/creatorFeeRouting'
import { assertGitHubIdentityUnchanged, fetchGitHubIndividual } from '@/lib/githubRecipient'
import { verifyCreatorFeeRoutingOnChain } from '@/lib/creatorFeeRecovery'
import { validatePumpLaunchPlan, type NativePumpLaunchPlan } from '@/lib/transactions/validatePumpLaunchPlan'
import styles from '../LaunchBuilder.module.css'

type Prepared = { transactions: VersionedTransaction[]; messages: string[]; launchPlan: NativePumpLaunchPlan; reviewKey: string; payer: string; blockhash: string; metadataUri: string; debit: string; networkFee:string; tip: string; bundle: boolean; createdAt: number }
const sol = (value: string | number) => (Number(value) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 9 })
type Status = 'idle' | 'preparing' | 'ready' | 'signing' | 'sending' | 'error' | 'unknown'

export function PumpSignSendStep() {
  const { connection } = useConnection(), wallet = useWallet(), platform = usePlatformWalletStore(), store = useLaunchStore()
  const { metadata, metadataUri, imageFile, bannerFile, config, usePlatformWallet } = store
  const mint = store.getMintKeypair()
  const payer = usePlatformWallet ? platform.getPublicKey() : wallet.publicKey?.toBase58()
  const [status, setStatus] = useState<Status>('idle'), [error, setError] = useState(''), [approved, setApproved] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null), [uploadedUri, setUploadedUri] = useState('')
  const [reviewedGitHub, setReviewedGitHub] = useState<VerifiedGitHubIndividual | null>(null)
  const githubIdentity = useRef<VerifiedGitHubIndividual | null>(null), currentWallet = useRef(wallet)
  useEffect(() => { currentWallet.current = wallet }, [wallet])
  const operation = useRef(false), controller = useRef(new AbortController())
  useEffect(() => { controller.current = new AbortController(); return () => {controller.current.abort();useLaunchStore.getState().setIsLoading(false)} }, [])
  const busy = ['preparing','signing','sending'].includes(status), blocked = busy || status === 'unknown'
  const errors = validatePumpCreation(config)
  const signerNow = () => useLaunchStore.getState().usePlatformWallet ? usePlatformWalletStore.getState().getPublicKey() : currentWallet.current.wallet?.adapter.publicKey?.toBase58()
  const readReviewKey = () => {
    const state = useLaunchStore.getState()
    return JSON.stringify({ config: state.config, metadata: state.metadata, metadataUri: state.metadataUri, mint: state.getMintKeypair()?.publicKey.toBase58(), payer: signerNow(), usePlatformWallet: state.usePlatformWallet })
  }
  const reviewKey = JSON.stringify({ config, metadata, metadataUri, mint: mint?.publicKey.toBase58(), payer, usePlatformWallet })
  useEffect(() => { setPrepared(null); setApproved(false); setError(''); setStatus(value => ['signing', 'sending', 'unknown'].includes(value) ? value : 'idle') }, [reviewKey])
  useEffect(() => {
    if (config.creatorFeeSelection.kind !== 'github' || githubIdentity.current?.username.toLowerCase() !== config.creatorFeeSelection.username.toLowerCase()) { githubIdentity.current = null; setReviewedGitHub(null) }
  }, [config.creatorFeeSelection])
  const assertReview = (expected: string) => { if (controller.current.signal.aborted || readReviewKey() !== expected) throw new Error('The launch details, fee recipient or signing wallet changed. Prepare a fresh preview.') }
  const available = () => {
    if (readPending()) throw new Error('A previous launch needs a confirmation check. Open Activity before starting another.')
    if (readTradePending()) throw new Error('A previous trade needs a confirmation check in Manage token.')
    assertNoPendingWalletOperation()
    assertNoPendingGroupOperation()
    assertNoPendingBundleReceipt()
    const invalid = validatePumpCreation(useLaunchStore.getState().config)
    if (invalid.length) throw new Error(invalid.join(' '))
    if (controller.current.signal.aborted) throw new Error('The launch screen was closed. Nothing was sent.')
  }
  const update = (patch: Partial<LaunchConfig>) => { store.setConfig(patch); setPrepared(null); setApproved(false); setError(''); setStatus('idle') }
  const prepare = async () => {
    if (operation.current) return
    operation.current = true;store.setIsLoading(true); setStatus('preparing'); setError(''); setApproved(false); setPrepared(null)
    const expectedReview = readReviewKey()
    try {
      available()
      if (!payer || !mint || !metadata) throw new Error('Choose your token details, a fresh mint address and an unlocked signing wallet.')
      const selection = requireSupportedCreatorFeeSelection(config.creatorFeeSelection)
      let githubRecipient: VerifiedGitHubIndividual | undefined
      if (selection.kind === 'github') {
        githubRecipient = await fetchGitHubIndividual(selection.username, controller.current.signal)
        assertReview(expectedReview)
        const previous = githubIdentity.current
        githubIdentity.current = githubRecipient; setReviewedGitHub(githubRecipient)
        assertGitHubIdentityUnchanged(previous, githubRecipient)
      }
      let uri = metadataUri || uploadedUri
      if (!uri) {
        if (!imageFile) throw new Error('Add your token artwork or an existing public metadata URI in Token details.')
        const result = await uploadMetadataToIPFS({ ...metadata, image: imageFile }, bannerFile || undefined)
        if (!result.success || !result.metadataUri) throw new Error(result.error || 'Metadata upload did not complete.')
        uri = result.metadataUri
      }
      if (!/^(https:\/\/|ipfs:\/\/)/.test(uri) || new TextEncoder().encode(uri).length > 200) throw new Error('Use an HTTPS or IPFS metadata URI up to 200 bytes.')
      setUploadedUri(uri)
      assertReview(expectedReview)
      const built = await buildCreateTransaction({ connection, metadata: { ...metadata, image: imageFile || undefined }, mintKeypair: mint, userPublicKey: payer, metadataUri: uri, initialBuyAmount: config.devBuySol, slippage: config.slippage, priorityFee: config.priorityFeeSol, jitoTipLamports: Math.round(config.jitoTipSol * 1e9), creatorFeeSelection: selection, ...(githubRecipient ? { githubRecipient } : {}) })
      if (!built.success || !built.launchPlan) throw new Error(built.error || 'The native Pump.fun launch plan could not be verified.')
      assertReview(expectedReview)
      validatePumpLaunchPlan(built.launchPlan)
      const transactions = built.launchPlan.packets.map(tx => VersionedTransaction.deserialize(tx.serialize()))
      const launchPlan = { ...built.launchPlan, packets: transactions }
      const messages = transactions.map(tx => Buffer.from(tx.message.serialize()).toString('base64'))
      const simulation = await simulateAtomicBundle(connection, transactions.map(tx => VersionedTransaction.deserialize(tx.serialize())), { payer, signal: controller.current.signal })
      if (!simulation.success || simulation.payerDebitLamports === undefined) throw new Error(simulation.error || 'The complete launch cost could not be verified. Nothing was sent.')
      const fees=await Promise.all(transactions.map(tx=>withTimeout(connection.getFeeForMessage(tx.message,'confirmed'))))
      if(fees.some(fee=>fee.value===null||!Number.isSafeInteger(fee.value)||fee.value!<0))throw new Error('The network fee could not be quoted. Refresh the preview.')
      const networkFee=fees.reduce((sum,fee)=>sum+BigInt(fee.value!),0n).toString()
      assertReview(expectedReview)
      validatePumpLaunchPlan(launchPlan)
      setPrepared({ transactions, messages, launchPlan, reviewKey: expectedReview, payer, blockhash: transactions[0].message.recentBlockhash, metadataUri: uri, debit: simulation.payerDebitLamports, networkFee, tip: built.jitoTipLamports || '0', bundle: launchPlan.requiresAtomicBundle, createdAt: Date.now() }); setStatus('ready')
    } catch (e) { setError(e instanceof Error ? e.message : 'Launch preparation failed.'); setStatus('error') }
    finally { operation.current = false;store.setIsLoading(false) }
  }
  const sign = async () => {
    if (!prepared || !approved || !mint || operation.current) return
    if (!navigator.locks) { setError('Use a current browser that supports secure transaction coordination.'); return }
    await navigator.locks.request('vanity-launch-submission', { ifAvailable: true }, async lock => {
      if (!lock) { setError('Another tab is signing or checking a transaction. Finish it there first.'); return }
      operation.current = true;store.setIsLoading(true)
      let submitted = false, ownPending: PendingLaunch | null = null
      try {
        available()
        assertReview(prepared.reviewKey)
        validatePumpLaunchPlan(prepared.launchPlan)
        assertSubmissionSigner(prepared.payer, signerNow, controller.current.signal)
        if (Date.now() - prepared.createdAt > 60_000 || !(await connection.isBlockhashValid(prepared.blockhash, { commitment: 'confirmed' })).value) throw new Error('This preview expired. Refresh it for a new blockhash and current costs.')
        assertReview(prepared.reviewKey)
        setStatus('signing'); setError('')
        const messages = prepared.messages
        prepared.transactions.forEach((tx, index) => { if (Buffer.from(tx.message.serialize()).toString('base64') !== messages[index]) throw new Error('The reviewed launch packet changed. Prepare again.') })
        const copies = prepared.transactions.map(tx => VersionedTransaction.deserialize(tx.serialize()))
        let signed: VersionedTransaction[]
        if (usePlatformWallet) {
          const key = usePlatformWalletStore.getState().getKeypair()
          if (!key) throw new Error('Unlock your signing wallet to continue.')
          signed = copies.map(tx => { tx.sign([key]); return tx })
        } else if (wallet.signAllTransactions) signed = await wallet.signAllTransactions(copies)
        else if (wallet.signTransaction) { signed = []; for (const tx of copies) { assertReview(prepared.reviewKey); signed.push(await wallet.signTransaction(tx)) } }
        else throw new Error('This wallet cannot sign the prepared launch.')
        if (signed.length !== messages.length) throw new Error('The wallet did not sign every transaction. Nothing was sent.')
        signed.forEach((tx, index) => {
          if (Buffer.from(tx.message.serialize()).toString('base64') !== messages[index]) throw new Error('The wallet changed the reviewed transaction. Nothing was sent.')
          const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures)
          if (signers.some(key => key.equals(mint.publicKey))) tx.sign([mint])
        })
        assertReview(prepared.reviewKey)
        validatePumpLaunchPlan({ ...prepared.launchPlan, packets: signed })
        const signatures = signed.map(signedTransactionSignature)
        const pending: PendingLaunch = { mode: 'standard', venue: 'pump', mint: mint.publicKey.toBase58(), payer: prepared.payer, blockhash: prepared.blockhash, signatures, submittedAt: new Date().toISOString(), expiresAfterBlockHeight: await connection.getBlockHeight('confirmed') + 160, creatorFeeRouting: prepared.launchPlan.routing }
        assertReview(prepared.reviewKey)
        assertSubmissionSigner(prepared.payer, signerNow, controller.current.signal)
        savePending(pending); ownPending = pending; setStatus('sending')
        const submissionPackets = signed.map(tx => VersionedTransaction.deserialize(tx.serialize()))
        const options = { signal: controller.current.signal, onBroadcast: () => { assertSubmissionSigner(prepared.payer, signerNow, controller.current.signal); assertReview(prepared.reviewKey); submissionPackets.forEach((tx, index) => { if (Buffer.from(tx.message.serialize()).toString('base64') !== messages[index]) throw new Error('The signed launch changed before broadcast. Nothing was sent.') }); validatePumpLaunchPlan({ ...prepared.launchPlan, packets: submissionPackets }); submitted = true } }
        const result = prepared.bundle ? await submitAtomicBundle(connection, submissionPackets, options) : await sendAndConfirmTransaction(connection, submissionPackets[0], options)
        if (result.status !== 'confirmed') {
          if (result.submitted === false) { clearPendingIfMatching(pending); setStatus('error'); setError(result.error || 'Nothing was submitted. Refresh the preview before trying again.'); return }
          setStatus('unknown'); setError(result.error || 'Check your saved signatures before starting another launch.'); return
        }
        if (!await connection.getAccountInfo(mint.publicKey, 'confirmed')) throw new Error('The signatures confirmed but the mint account could not be verified. Check the saved launch in Activity.')
        await verifyCreatorFeeRoutingOnChain(connection, prepared.launchPlan.routing, pending)
        store.setMetadataUri(prepared.metadataUri); store.setReceipt(saveConfirmed(pending)); store.setStep('result')
      } catch (e) { if (!submitted && ownPending) clearPendingIfMatching(ownPending); setError(e instanceof Error ? e.message : 'The launch did not complete.'); setStatus(submitted ? 'unknown' : 'error'); setPrepared(null) }
      finally { operation.current = false;store.setIsLoading(false) }
    })
  }
  const label = status === 'preparing' ? 'Preparing your launch' : status === 'signing' ? 'Waiting for your signature' : status === 'sending' ? 'Confirming on Solana' : status === 'ready' ? 'Ready for your review' : status === 'unknown' ? 'Confirmation needs a check' : 'Review your commitment'
  return <div className={styles.reviewGrid}><div className="space-y-5"><section className="form-section"><div className={styles.sectionHeading}><span className={styles.sectionIcon}><ShieldCheck size={18} /></span><div><h2>Launch settings</h2><p>Native Pump.fun creation on Solana mainnet.</p></div></div><fieldset disabled={blocked} className="space-y-5"><div><label className="field-label" htmlFor="dev-buy">Optional first buy <span className="text-muted">· SOL</span></label><Input id="dev-buy" type="number" min="0" max="1000" step="0.01" value={Number.isNaN(config.devBuySol) ? '' : config.devBuySol} onChange={e => update({ devBuySol: e.target.valueAsNumber })} /><p className="field-help">Maximum trade spend. Set 0 to create without buying.</p></div><BuyPresets value={config.devBuySol} onChange={amount => update({ devBuySol: amount })} disabled={blocked} /></fieldset><div className="mt-6 border-t border-border pt-6"><CreatorFeeFields value={config.creatorFeeSelection} onChange={value => update({ creatorFeeSelection: value })} disabled={blocked} idPrefix="single-launch-creator" /></div>{reviewedGitHub && config.creatorFeeSelection.kind === 'github' && <div className="notice mt-5"><p>Verified GitHub individual: <a className="underline" href={reviewedGitHub.profileUrl} target="_blank" rel="noreferrer">@{reviewedGitHub.username} ↗</a></p><p className="font-mono text-xs mt-2">Immutable numeric user ID: {reviewedGitHub.userId}</p><p className="field-help">Creator fees accrue to this identity’s social escrow. Claim on Pump’s website or mobile app using the linked GitHub account.</p></div>}</section>
    <details className="form-section"><summary className="flex items-center gap-2 cursor-pointer text-sm"><SlidersHorizontal size={15} />Advanced execution settings<span className="ml-auto text-xs text-muted">{config.slippage}% slippage · {config.priorityFeeSol} SOL priority</span></summary><fieldset disabled={blocked} className="grid sm:grid-cols-2 gap-5 mt-6"><div><label className="field-label" htmlFor="slippage">Slippage · %</label><Input id="slippage" type="number" min="0.1" max="50" step="0.1" value={Number.isNaN(config.slippage) ? '' : config.slippage} onChange={e => update({ slippage: e.target.valueAsNumber })} /></div><div><label className="field-label" htmlFor="priority-fee">Priority fee budget · SOL</label><Input id="priority-fee" type="number" min="0" max="0.01" step="0.00001" value={Number.isNaN(config.priorityFeeSol) ? '' : config.priorityFeeSol} onChange={e => update({ priorityFeeSol: e.target.valueAsNumber })} /></div><div className="sm:col-span-2"><label className="field-label" htmlFor="jito-tip">Bundle validator tip · SOL</label><Input id="jito-tip" type="number" min="0.000001" max="0.1" step="0.000001" value={Number.isNaN(config.jitoTipSol) ? '' : config.jitoTipSol} onChange={e => update({ jitoTipSol: e.target.valueAsNumber })} /><p className="field-help">Only used when long token details require a multi-transaction launch. Single-transaction launches pay no bundle tip.</p></div></fieldset></details>
    {(error || errors.length > 0) && <div className="notice notice-error" role="alert">{error || errors.join(' ')}{status === 'unknown' && <p className="mt-3"><Link href="/activity" className="underline">Open Activity to check your saved launch</Link></p>}</div>}
    <div className="flex flex-wrap justify-between gap-3"><Button variant="ghost" disabled={blocked} onClick={store.prevStep}>Back to signing wallet</Button><Button disabled={blocked || errors.length > 0} onClick={prepare}>{status === 'preparing' ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}{prepared ? 'Refresh preview' : 'Prepare launch'}</Button></div></div>
    <aside className={styles.launchReview}><div className={styles.reviewStatus}>{busy ? <Loader2 size={15} className="animate-spin" /> : prepared ? <Check size={15} /> : <Clock3 size={15} />}{label}</div><div className={styles.reviewToken}>{store.imagePreview ? <img src={store.imagePreview} alt="Token artwork" /> : <img src="/favicon.svg" alt="" />}<div><h2>{metadata?.name || 'Your token'}</h2><span>${metadata?.symbol || 'TOKEN'}</span></div></div><dl className={styles.costList}><div><dt>Destination</dt><dd>Pump.fun · Solana</dd></div><div><dt>Signing wallet</dt><dd className="font-mono break-all max-w-[160px]">{payer?`${payer.slice(0,6)}…${payer.slice(-6)}`:'Not selected'}</dd></div><div><dt>Creator fee recipient</dt><dd className="break-all max-w-[190px]">{creatorFeeRoutingLabel(prepared?.launchPlan.routing || config.creatorFeeSelection)}</dd></div><div><dt>First-buy budget</dt><dd>{config.devBuySol || 0} SOL</dd></div><div><dt>OutSol platform fee</dt><dd className="text-accent">0 SOL · forever</dd></div>{prepared && <><div><dt>Network + priority fees</dt><dd>{sol(prepared.networkFee)} SOL</dd></div><div><dt>Account creation / rent</dt><dd>Included in total</dd></div><div><dt>Protocol charges</dt><dd>Included in buy spend</dd></div><div><dt>Validator tip</dt><dd>{sol(prepared.tip)} SOL</dd></div><div><dt>Execution</dt><dd>{prepared.transactions.length === 1 ? 'One transaction' : `${prepared.transactions.length}-transaction bundle`}</dd></div></>}<div className={styles.costTotal}><dt>Estimated total outflow</dt><dd>{prepared ? `${sol(prepared.debit)} SOL` : 'Prepare for a live quote'}</dd></div></dl><p className="field-help">Total is the complete simulated wallet debit, including actual buy spend, account rent and protocol charges. The first-buy budget is a ceiling, not a fee. Rent and protocol charges are included but not individually itemized by this preview.</p>{prepared && <div className="space-y-4 mt-5"><a className="text-sm inline-flex items-center gap-1.5 text-accent" href={prepared.metadataUri.replace('ipfs://','https://ipfs.io/ipfs/')} target="_blank" rel="noreferrer">Review public metadata<ExternalLink size={13} /></a>{prepared.bundle && <p className="field-help">This route uses a Jito bundle. Rare network rebroadcasts may cause partial execution; every signature is checked.</p>}<label className="flex items-start gap-3 text-sm leading-relaxed text-muted"><input className="mt-1 accent-[#9bd8c2]" type="checkbox" checked={approved} disabled={blocked} onChange={e => setApproved(e.target.checked)} />I reviewed the token details, creator fee recipient, first-buy budget and total costs.</label><Button className="w-full" disabled={!approved || blocked} onClick={sign}>{busy && <Loader2 size={15} className="animate-spin" />}{status === 'signing' ? 'Approve in your wallet' : status === 'sending' ? 'Waiting for confirmation' : 'Sign & launch'}</Button></div>}</aside></div>
}
