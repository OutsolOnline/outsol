# Inline launch bundles implementation plan

> The user has delegated implementation and requested that bundle modes be part of the launch process while preserving OutSol's distinctive design. Continue in the existing shared feature checkout with explicit file ownership.

**Goal:** Prepare, review and execute optional wallet buys in the same token builder, using Block-0, Organic or Manual timing.

**Architecture:** Add a Launch settings screen within Prepare, before signer selection. A strict public configuration and a new prepared execution engine share native Pump builders; existing standalone Bundles remains available. One immutable simulated preview covers launch packets and actual atomic buyer debits, while later timed buys use disclosed budgets and fresh quotes after creation confirms.

**Tech stack:** Existing Next/React, Zustand, encrypted wallet library, official Pump SDK and Solana/Jito transaction safeguards.

**Spec:** User's Proxima reference describes functional placement; OutSol layout, typography, brand and accurate execution behavior remain authoritative.

## Global constraints

- Pump.fun only, Solana only, 0% OutSol fees. No live funds used for execution tests.
- Existing external and local creator signers remain supported. Additional buyers use selected unlocked encrypted-library wallets, with no private keys in drafts or receipts.
- Three mode choices preserve budgets. No claims of stealth, cluster avoidance, guaranteed first-block inclusion or guaranteed sniper protection.
- Block-0 fails closed when its full atomic plan exceeds five packets. Metadata may reduce the three-buyer ceiling. Manual and Organic support up to sixteen buyer rows, with browser-only scheduling clearly disclosed.
- Missing legacy bundle settings migrate to the empty Manual plan. Malformed explicit settings fail without overwriting browser data.
- Keep cancellation, signature/message validation, spend ceilings, pending records, global submission lock and interrupted transaction recovery.

## Review focus

- Editing a plan, signer, selected group or wallet invalidates its approval and prepared transactions.
- Locking/removing a selected wallet during an await stops new broadcasts.
- Atomic rejection or ambiguity never falls back to sequential sends.
- Refresh cannot cause timed actions to resume or resubmit; saved signatures remain available.
- Review distinguishes simulated initial debit from future buy ceilings, fees, rent and tip.

## Tasks

- [x] Add strict public mode/config parsing, safe legacy defaults, unique group members, budgets and limits. Write behavioral tests before implementation.
- [x] Add prepared native engine with all atomic wallets simulated, immutable message checks, external signer adapter, fresh sequential quotes and per-broadcast recovery checkpoints. Test cancellation, locked/changed wallets, overspend, expiry and no fallback.
- [x] Add OutSol-styled Launch settings screen, wallet-group selection and editable buys/timing; keep existing token preview and step progression. Add safe saved-draft roundtrip and navigation preservation tests.
- [x] Integrate reviewed preparation/signing and results into existing builder, without copying token metadata or mint into another workspace.
- [x] Run relevant checks, full suite and production build. Exercise real browser desktop/mobile settings and draft recovery, and execute all modes using disposable simulated SOL. Review before private GitHub/Railway release.

Verification: all five actual production-engine local Surfpool cases passed with simulated SOL, including both timed modes, max-metadata Block-0 and pre-sign capacity refusal. All wallet costs, mint ownership and original submission contexts were checked. Repository suite 672 passed / 50 opt-in skipped; production build, typecheck and lint passed. Browser settings and homepage checked at 390, 768, 1440 and 1920 pixels. Release verification follows commit.
