# OutSol workspace expansion — verification

Verified locally on 3 November 2026, from `outsol-proxima-parity` based on `deb2906`. Deployment is a separate step; this file does not assert that a pending deployment succeeded.

## Release checks

- Full regression suite: **1,241 passed, 99 skipped**, 141 passing files / 23 optional environment-dependent files skipped. Zero failures. The default run needs no private RPC or wallet files.
- Separate strictly guarded Surfpool execution: **17 passed across 5 files**. Disposable, freshly generated in-memory payers received simulated SOL. Each harness proves a loopback Surfpool runtime before any write and restricts wallet-funded sends to its fresh payers. The read-only upstream bridge rejects broadcasts and airdrops.
- Whole-repository TypeScript: passed with incremental checking disabled.
- Whole-repository ESLint: passed with no errors or warnings.
- Production dependency audit: **0 vulnerabilities** with development-only dependencies omitted.
- Production Next.js build: passed; all application/API routes compiled and prerendering completed.
- Whitespace/diff checks: passed before staging; final staged check required before commit.

## Actual program execution

The 17 execution cases cover eight reviewed wallet operations, four creator-operation cases, three canonical Streamflow escrow cases, one complete staged-launch/strategy-queue case and one consolidation case. These are simulated-fund local-fork results, not mainnet transactions or guarantees of future execution.

- Standard SPL and Token-2022 transfer, burn, cleanup, changed signer and original-signature recovery.
- Creator-only deployment followed by separately started source/receiver purchases; multi-wallet DCA and SOL-cap steps, pause and newly approved continuation. Confirmed buys are never repeated on recovery.
- Actual creator-fee accrual and wallet-wide claim, shared-fee distribution, permanent final share assignment, ten-recipient lookup setup and unknown claim recovery. The live program permanently revokes the share administrator; the approval copy and simulation require that result.
- SPL and Token-2022 immutable Streamflow escrows, exact net principal plus live protocol fees, unchanged total supply and unknown lock recovery. SDK nonce serialization was checked against actual canonical-program execution.
- Two-source consolidation, a separately reviewed sale of only the exact finalized received amount, preservation of pre-existing receiver holdings, and original transfer/sale recovery with one broadcast per signature. Incomplete finalized metadata stops sale preparation until complete evidence can be read.

## Browser acceptance

Chrome checks covered Watchlist, Settings, Funder, Projects, Library, Clone, Activity, Trading sessions, Wallets and the Launch builder, plus all eight token workspace sections. Target widths: **390, 768, 1440 and 1920 pixels**. No document-wide horizontal overflow remained in the checked layouts. The 390px builder was inspected separately through generated-mint and staged-buy settings.

Verified saved preferences/default funder after refresh, public watchlist balance inspection and chart markers, project save/archive/restore, saved buy-plan refresh without rearming, manual receipt verification with persisted observations, launch validation feedback, Escape-to-close and focus restoration. Responsive review corrected a settings input overflow and mobile chart label scaling. Screenshot and dimension evidence are task-output artifacts, outside the source repository. No production wallet library was read or modified during local acceptance.

## Independent review corrections

1. A completed explicitly selected buyer could remain the hidden review target. Display, unlock scope and review now resolve the same remaining buyer.
2. Queue approval omitted material stored configuration. Each step now exposes its exact mint, payer, receiver/reserve, timing, fee and trigger/filter settings before approval.
3. Truncated or unsupported trade logs looked like complete non-trade coverage. Structured parsing now marks unreadable coverage and stops guarded future actions.
4. Equal sampled endpoint balances falsely established acquisition continuity. Accounting no longer carries basis between sampled transactions; realized/unrealized P&L is unavailable without complete history.
5. Native exact partial sales incorrectly fell back to a full-balance quote. A canonical positive raw amount is checked against initial and fresh balances and bound to the native instruction and both simulation/review boundaries. Existing percentage behavior is preserved. An independent review found no remaining actionable P1/P2 in this fix.

## Retained limits

This is not full Proxima parity. See [the comparison](./PROXIMA-COMPARISON.md) for all 79 rows and direct sources. Private CEX/aged-wallet/Shield services are absent; layered stealth/cluster concealment is not claimed. New launches remain Pump.fun/Solana/SOL. Staged plans have 16 buyers, observed guards use bounded confirmed samples, and sessions run only while the browser is active within reviewed time/trade/spend caps. No instant-detection or automatic liquidation guarantee exists. RPC racing requires additional configured server-side providers; no new provider subscription was purchased or enabled. Streamflow escrow is not an LP lock. Account collaboration, 2FA and browser-closed signing were not invented on top of local custody.

OutSol platform fees remain **0%**. Network fees, priority fees, account rent, Jito tips and protocol/third-party charges remain separate. Production access protection and private server RPC configuration must remain enabled during deployment. No GitHub Actions are required; Railway repeats release gates inside its Docker builder.
