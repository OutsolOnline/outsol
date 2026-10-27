'use client'
import type { CreatorFeeSelection } from '@/lib/creatorFeeRouting'
import { Input } from '@/components/ui/input'

export interface CreatorFeeFieldsProps {
  value: CreatorFeeSelection
  onChange: (value: CreatorFeeSelection) => void
  disabled?: boolean
  idPrefix: string
  error?: string
}

export function CreatorFeeFields({ value, onChange, disabled, idPrefix, error }: CreatorFeeFieldsProps) {
  return <fieldset disabled={disabled} className="space-y-4"><legend className="field-label mb-3">Creator fee recipient</legend>
    <label className="field-label" htmlFor={`${idPrefix}-mode`}>Where Pump creator fees accrue</label>
    <select id={`${idPrefix}-mode`} className="w-full rounded-lg border border-border bg-background px-3 py-3 text-sm" value={value.kind} onChange={event => {
      switch (event.target.value) {
        case 'deployer': onChange({ kind: 'deployer' }); break
        case 'wallet': onChange({ kind: 'wallet', address: '' }); break
        case 'github': onChange({ kind: 'github', username: '' }); break
        case 'holder-rewards': onChange({ kind: 'holder-rewards' }); break
      }
    }}>
      <option value="deployer">Deployer wallet</option><option value="wallet">Another Solana wallet</option><option value="github">GitHub individual</option><option value="holder-rewards">Holder rewards</option><option value="cashback" disabled>Cashback · unavailable</option>
    </select>
    {value.kind === 'wallet' && <div><label className="field-label" htmlFor={`${idPrefix}-wallet`}>Recipient Solana wallet</label><Input id={`${idPrefix}-wallet`} value={value.address} onChange={event => onChange({ kind: 'wallet', address: event.target.value.trim() })} autoComplete="off" spellCheck={false}/><p className="field-help">Use an ordinary Solana wallet address. Its owner collects accrued creator fees through Pump.</p></div>}
    {value.kind === 'github' && <div><label className="field-label" htmlFor={`${idPrefix}-github`}>GitHub individual username</label><Input id={`${idPrefix}-github`} value={value.username} onChange={event => onChange({ kind: 'github', username: event.target.value.trim() })} placeholder="username" maxLength={39} autoComplete="off" spellCheck={false}/><p className="field-help">Individual accounts only. Organization, bot, and repository payouts are unavailable. Preview verifies the numeric GitHub user ID. Fees accrue to that identity’s Pump social escrow through permanent 100% fee sharing. The recipient claims on the Pump website or mobile app with their linked GitHub account. OutSol cannot claim or sign for them.</p></div>}
    {value.kind === 'holder-rewards' && <p className="field-help">All creator fees route to this coin’s holder rewards account. This choice is permanent. Pump’s external distribution authority controls payouts to holders; OutSol does not control distribution or promise a payout schedule.</p>}
    {value.kind === 'deployer' && <p className="field-help">Creator fees accrue to the signing deployer wallet’s creator vault. Collect them through Pump.</p>}
    <p className="field-help">Pump no longer permits new cashback tokens. Holder rewards are a separate option.</p>
    <p className="field-help">This changes the creator fee recipient, not Pump’s fee rate. OutSol’s platform fee remains 0.</p>
    {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
  </fieldset>
}
