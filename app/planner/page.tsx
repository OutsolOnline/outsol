'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, ArrowUpRight, Check, Compass, Droplets, FlaskConical, Layers3, LockKeyhole, Rocket, ShieldCheck, Wallet } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { useLaunchStore } from '@/stores/launchStore'
import { readPending } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { prepareLaunchNavigation } from '@/lib/launchNavigation'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'

const goals = [
  { id: 'create', title: 'Create a token', description: 'Pump.fun creation without an initial buy.', icon: Rocket },
  { id: 'first-buy', title: 'Create with a first buy', description: 'Add an optional developer buy at launch.', icon: Wallet },
  { id: 'bundles', title: 'Coordinate wallet buys', description: 'Configure wallets and amounts in Bundles.', icon: Layers3 },
  { id: 'locked-allocation', title: 'Lock a developer allocation', description: 'Check compatibility with the current flow.', icon: LockKeyhole },
  { id: 'direct-liquidity', title: 'Open a direct liquidity pool', description: 'Check compatibility with the current flow.', icon: Droplets },
] as const
type Goal = (typeof goals)[number]['id']
const LAMPORTS = 1_000_000_000n

function parseSol(value: string): bigint | null {
  if (!/^\d{1,12}(\.\d{1,9})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  return BigInt(whole) * LAMPORTS + BigInt(fraction.padEnd(9, '0'))
}
function sol(value: bigint): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const fraction = (magnitude % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${magnitude / LAMPORTS}${fraction ? `.${fraction}` : ''}`
}

export default function PlannerPage() {
  const router = useRouter()
  const [goal, setGoal] = useState<Goal>('create')
  const [budgetText, setBudgetText] = useState('')
  const [reserveText, setReserveText] = useState('0')
  const [buyText, setBuyText] = useState('')
  const [error, setError] = useState('')
  const compatible = goal === 'create' || goal === 'first-buy' || goal === 'bundles'
  const bundles = goal === 'bundles'
  const budget = budgetText.trim() ? parseSol(budgetText) : null
  const reserve = parseSol(reserveText.trim() || '0')
  const buy = goal === 'first-buy' ? parseSol(buyText) : 0n
  const remaining = budget !== null && reserve !== null && buy !== null ? budget - reserve - buy : null
  const invalidBudget = !!budgetText.trim() && budget === null
  const invalidReserve = reserve === null
  const invalidBuy = goal === 'first-buy' && (buy === null || buy <= 0n || buy > 1000n * LAMPORTS)
  const goalTitle = goals.find(item => item.id === goal)?.title

  const applyPlan = () => {
    setError('')
    try {
      if (!compatible) return
      if (invalidBudget || invalidReserve) throw new Error('Use positive SOL amounts with up to nine decimal places for the budget and reserve.')
      if (invalidBuy) throw new Error('Enter a first buy greater than 0 and no more than 1,000 SOL, with up to nine decimal places.')
      if (remaining !== null && remaining < 0n) throw new Error('Your first buy and reserve exceed the entered budget. Reduce one of them before continuing.')
      assertNoPendingWalletOperation()
      if (readPending() || readTradePending()) throw new Error('An operation is awaiting confirmation. Open Activity before applying another launch plan.')
      const current = useLaunchStore.getState()
      if (current.isLoading || current.currentStep === 'sign-send') throw new Error('Finish or leave the current launch review before applying a different plan.')
      if (bundles) { router.push('/bundler'); return }
      if (!prepareLaunchNavigation('/launch?new=1')) throw new Error(useLaunchStore.getState().error || 'Your current design could not be preserved. Save it before applying this plan.')
      const store = useLaunchStore.getState()
      const developerBuy = Number(buy ?? 0n) / Number(LAMPORTS)
      store.setConfig({ mode: 'standard', venue: 'pump', devBuySol: developerBuy })
      store.setDevBuyAmount(developerBuy)
      store.setMetadata({ name: '', symbol: '', description: '' })
      store.setStep('metadata')
      router.push('/launch')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This plan could not be applied. Check the current operation in Activity.') }
  }

  return <div className="min-h-screen flex flex-col"><Header /><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
    <div className="page-heading"><div className="eyebrow">LAUNCH PLANNER</div><h1>A clear plan before the first signature.</h1><p>Choose a goal, outline your SOL budget and continue with a supported Pump.fun workflow.</p></div>
    <div className="planner-layout"><div className="planner-inputs"><fieldset className="planner-goals"><legend><span>01</span> What would you like to do?</legend><p>Start with the outcome. We’ll show what this workspace can support.</p><div className="planner-goal-grid">{goals.map(item => <label className={`planner-goal${goal === item.id ? ' selected' : ''}`} key={item.id}><input type="radio" name="launch-goal" value={item.id} checked={goal === item.id} onChange={() => { setGoal(item.id); setError('') }} /><span className="planner-goal-icon"><item.icon size={20} strokeWidth={1.6} aria-hidden="true" /></span><span className="planner-goal-copy"><b>{item.title}</b><small>{item.description}</small></span>{goal === item.id && <Check size={16} className="planner-goal-check" aria-hidden="true" />}</label>)}</div></fieldset>

      {compatible ? <section className="planner-budget" aria-labelledby="planner-budget-heading"><h2 id="planner-budget-heading"><span>02</span> Outline your budget</h2><p>This is bookkeeping for the amounts you choose. A fresh transaction preview supplies the external costs.</p><div className="planner-field-grid"><div><label htmlFor="plan-budget" className="field-label">Total budget <span>Optional · SOL</span></label><input id="plan-budget" inputMode="decimal" autoComplete="off" className="input-pill" placeholder="Enter your own amount" maxLength={24} value={budgetText} aria-invalid={invalidBudget} aria-describedby="plan-budget-help" onChange={event => { setBudgetText(event.target.value); setError('') }} /><p id="plan-budget-help" className={`field-help${invalidBudget ? ' planner-field-error' : ''}`}>{invalidBudget ? 'Enter a non-negative SOL amount with up to nine decimal places.' : 'A planning amount; your wallet balance is checked in the review.'}</p></div><div><label htmlFor="plan-reserve" className="field-label">Keep unspent <span>Planning only · SOL</span></label><input id="plan-reserve" inputMode="decimal" autoComplete="off" className="input-pill" maxLength={24} value={reserveText} aria-invalid={invalidReserve} aria-describedby="plan-reserve-help" onChange={event => { setReserveText(event.target.value); setError('') }} /><p id="plan-reserve-help" className={`field-help${invalidReserve ? ' planner-field-error' : ''}`}>{invalidReserve ? 'Enter a non-negative reserve with up to nine decimal places.' : 'This reserve is a note, not an enforced transaction limit.'}</p></div></div>
        {goal === 'first-buy' && <div className="planner-buy-field"><label htmlFor="plan-buy" className="field-label">Developer first buy <span>SOL</span></label><input id="plan-buy" inputMode="decimal" autoComplete="off" className="input-pill" placeholder="Choose an amount" maxLength={24} value={buyText} aria-invalid={!!buyText && invalidBuy} aria-describedby="plan-buy-help" onChange={event => { setBuyText(event.target.value); setError('') }} /><div className="planner-amounts" aria-label="First-buy amount presets">{['0.05', '0.1', '0.25'].map(amount => <button type="button" className={buyText === amount ? 'selected' : ''} aria-pressed={buyText === amount} key={amount} onClick={() => { setBuyText(amount); setError('') }}>{amount} SOL</button>)}</div><p id="plan-buy-help" className={`field-help${buyText && invalidBuy ? ' planner-field-error' : ''}`}>{buyText && invalidBuy ? 'Choose an amount above 0 and up to 1,000 SOL, with up to nine decimal places.' : 'Your chosen buy amount carries into the builder. Token output, slippage and fees require a fresh preview.'}</p></div>}
        {bundles && <p className="notice planner-bundle-note">Enter wallet buy amounts and signing wallets in Bundles. This planner’s budget and reserve stay on this page; they are not applied as bundle limits.</p>}
      </section> : <section className="planner-compatibility" aria-labelledby="planner-compatibility-heading"><div className="planner-compatibility-icon"><Compass size={23} strokeWidth={1.6} aria-hidden="true" /></div><h2 id="planner-compatibility-heading">This goal needs a different flow.</h2><p>{goal === 'locked-allocation' ? 'Timed developer-allocation locks are not supported by the current Pump.fun builder. A token launch or developer buy does not create an escrow or lock tokens.' : 'This workspace launches into Pump.fun’s bonding curve. It does not create a custom direct liquidity pool or configure LP ownership and liquidity locks.'}</p><p>You can prepare a standard Pump.fun token, add an optional first buy, or configure wallet buys in Bundles.</p><button type="button" className="secondary-action" onClick={() => setGoal('create')}>Plan a supported launch<ArrowRight size={15} aria-hidden="true" /></button></section>}
    </div><aside className="planner-summary" aria-labelledby="planner-summary-heading"><div className="planner-summary-label"><Compass size={17} aria-hidden="true" /> YOUR RECOMMENDED PATH</div><h2 id="planner-summary-heading">{compatible ? bundles ? 'Pump.fun wallet bundle' : goal === 'first-buy' ? 'Pump.fun create + buy' : 'Pump.fun create' : goalTitle}</h2><p>{compatible ? bundles ? 'Coordinate wallet buys with the dedicated bundle review.' : 'Design first, then connect a wallet and review the complete transaction.' : 'No compatible execution plan is available for this goal in the current builder.'}</p>
      {compatible && <><dl className="planner-costs"><div><dt>{bundles ? 'Wallet buy amounts' : 'Planned first buy'}</dt><dd>{bundles ? 'Set in Bundles' : buy === null ? 'Choose an amount' : `${sol(buy)} SOL`}</dd></div><div><dt>Personal reserve</dt><dd>{reserve === null ? 'Check amount' : `${sol(reserve)} SOL`}</dd></div><div className={remaining !== null && remaining < 0n ? 'planner-over-budget' : ''}><dt>Unallocated budget</dt><dd>{remaining === null ? 'Add a total budget' : `${sol(remaining)} SOL`}</dd></div><div className="planner-zero-fee"><dt>OutSol platform fee</dt><dd>0 SOL</dd></div><div><dt>Network + account rent</dt><dd>Fresh preview</dd></div><div><dt>Pump.fun trade fees</dt><dd>{goal === 'create' ? 'No trade planned' : 'Fresh preview'}</dd></div><div><dt>Jito tip, if used</dt><dd>Fresh preview</dd></div></dl><p className="planner-cost-note">Unallocated budget is your total minus the first buy and personal reserve. External costs have not been deducted. Available SOL may still be insufficient.</p>{error && <p className="notice notice-error" role="alert">{error}</p>}<button type="button" className="primary-action planner-continue" onClick={applyPlan}>{bundles ? 'Continue to Bundles' : 'Use this plan'}<ArrowRight size={16} aria-hidden="true" /></button><p className="planner-apply-note">{bundles ? 'Configure and review every wallet amount in Bundles.' : 'Applies the route and first-buy amount to your unsigned design. Continue to the builder for wallet selection and a fresh signing review.'}</p></>}
      <Link href="/rehearse" className="planner-rehearse-link"><FlaskConical size={17} strokeWidth={1.6} aria-hidden="true" /> Explore a launch rehearsal<ArrowUpRight size={14} aria-hidden="true" /></Link><div className="planner-fee-policy"><ShieldCheck size={15} aria-hidden="true" /> 0% OutSol platform fees. Forever.</div>
    </aside></div>
  </main><Footer /></div>
}
