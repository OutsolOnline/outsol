import { PLATFORM_FEE_BPS } from './launchConfig'

export const FEE_SOURCES_CHECKED_AT = '2026-10-27'
export const FEE_SOURCES_CHECKED_LABEL = '27 October 2026'
export const VANITY_FEE_POLICY = { basisPoints: PLATFORM_FEE_BPS, headline: '0% OutSol platform fees. Forever.', detail: 'OutSol adds no launch fee, trading cut or subscription. External transaction costs remain separate.' } as const

export interface PlatformFeeReference {
  name: string
  verified: boolean
  operations: { label: string; charge: string }[]
  note: string
  sources: { label: string; href: string }[]
}

// A dated editorial snapshot, never a quote or a fee-estimation input.
// Keep operations separate: Proxima's sell rate is not a token-creation rate.
export const PLATFORM_FEE_REFERENCES: PlatformFeeReference[] = [
  {
    name: 'Uxento uDev', verified: true,
    operations: [{ label: 'Creation', charge: '1.00% + launchpad fee' }, { label: 'Buy / sell', charge: '0.75% + launchpad fee' }],
    note: 'These are the operation-specific rates listed in the uDev documentation. No all-in SOL amount or percentage calculation base is assumed here.',
    sources: [{ label: 'Official uDev docs', href: 'https://docs.uxento.io/tools/udev' }],
  },
  {
    name: 'Proxima', verified: true,
    operations: [{ label: 'Sell proceeds', charge: '5%' }, { label: 'Creator-reward claims', charge: '5%' }],
    note: 'Standard sell and claim rates. Its terms list other operation-specific fees and allow license-specific rates; the final confirmation is authoritative. These percentages do not describe token-creation fees.',
    sources: [{ label: 'Official fee docs', href: 'https://docs.proxima.tools/other/platform-fees/' }, { label: 'Current terms, §9', href: 'https://proxima.tools/terms/' }],
  },
  {
    name: 'RapidLaunch', verified: false,
    operations: [{ label: 'Current public rate', charge: 'Not verified' }],
    note: 'A current official public fee schedule could not be verified. Check the rate shown for your operation in RapidLaunch before signing.',
    sources: [{ label: 'Official website', href: 'https://rapidlaunch.io/' }],
  },
]

export const EXTERNAL_COST_REFERENCES = [
  { title: 'Solana network fees', detail: 'Base transaction fees and any selected priority fee are paid to the network.', href: 'https://solana.com/docs/core/fees', source: 'Solana fees' },
  { title: 'Account rent', detail: 'New on-chain accounts may require a minimum SOL balance. The amount depends on the accounts created.', href: 'https://solana.com/docs/core/accounts', source: 'Solana accounts' },
  { title: 'Pump.fun charges', detail: 'Buys and sells can include creator, protocol and other applicable pool fees. Use the current transaction preview.', href: 'https://pump.fun/docs/fees', source: 'Pump.fun fee schedule' },
  { title: 'Jito tips', detail: 'A Jito-routed transaction or bundle may include a separate tip. It is shown in the signing review.', href: 'https://docs.jito.wtf/lowlatencytxnsend/', source: 'Jito documentation' },
] as const
