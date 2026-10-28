# Block-0 token transfer implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track completed steps below.

**Goal:** Transfer each configured additional buyer's exact purchase output within its existing Block-0 transaction.

**Architecture:** Add a public optional destination to buyer settings. Compose and strictly validate the buy/recipient-account/transfer transaction, verify aggregate token deltas in the same bundle simulation, and preserve public transfer intent through review and original-signature recovery.

**Tech Stack:** Existing Next.js, React, TypeScript, Solana web3/SPL, Pump SDK and Vitest. Node 22.14.0; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-block0-token-transfer-design.md` (approved by user on 2026-10-29).

## Global Constraints

- Additional Block-0 buyers only; creator first buy remains unchanged.
- Exactly the purchased raw amount moves. No sweep of earlier tokens or remaining SOL.
- Receiving wallets need public addresses only. Existing local private-key signing stays local.
- Maximum five bundle packets, 1,232 bytes per packet. No sequential transfer fallback.
- Same recipient, creator recipient and other-buyer recipient are supported; sender equals recipient is rejected.
- Leaving Block-0 clears destinations; previews invalidate; foreign-mode saved destinations fail validation.
- Persist only selected public fields, original signatures and recovery context. Unknown results never automatically resend.
- No secrets, funded transactions or deployment during development. Safe offline tests and disposable local execution only.

## Review Focus

1. Cross-participant recipients require net token deltas including creator purchases, incoming transfers and outgoing transfers (Task 1 simulation tests).
2. ATA creation order changes which wallet pays rent; use actual simulated payer costs (Task 1 engine tests).
3. Signed data and public review objects must not let callbacks substitute recipient/amount before broadcast (Task 1 mutation tests).
4. Strict serializers must preserve transfer intent while excluding keys and handling old records (Tasks 1/2 persistence tests).
5. A changed mode or destination invalidates a preview and never runs hidden transfer data (Task 2 store tests).

## Shared interfaces

- `LaunchBundleWallet.transferTo?: string` in `src/lib/launchBundle/types.ts`.
- `LaunchBundleTransfer` exported from `src/lib/launchBundle/receipt.ts`: `{walletId:string; payer:string; recipient:string; mint:string; tokenProgram:string; rawAmount:string; decimals:number}`. Validate/copy explicitly when storing public records.
- `LaunchBundleReview.transfers?: LaunchBundleTransfer[]`; unset or empty means no composed transfers.
- `BundleResult.tokenTransfers?: LaunchBundleTransfer[]`; `LaunchBundleOutcome.transfers?: LaunchBundleTransfer[]`.
- UI uses these public fields. Transaction implementation owns settings/model validation and receipt serialization; UI implementation owns the launch store and components.

### Task 1: Composed transactions, simulation, execution and persistence

**Own files:** `src/lib/launchBundle/{types,model,prepare,internal,execute,receipt}.ts`, new `src/lib/launchBundle/transfers.ts` (or narrowly factored equivalent), `src/lib/bundler/{jito,types,pending}.ts`, related strict history serializers if needed; focused tests under `tests/` excluding `launch-bundle-settings.test.ts` and `launch-bundle-library.test.ts`.

**Interfaces:** Consume the existing exact raw native buy output. Produce the shared interfaces above. Keep ordinary buy validation unchanged; implement a dedicated composed policy that binds source/destination/mint/program/amount and reconstructs the approved full instruction sequence.

- [x] Write failing tests for valid composition, changed recipient/amount/program, extra instructions, self/malformed recipient, non-Block-0 destinations and legacy parsing.
- [x] Append idempotent recipient ATA creation and transferChecked after the native buy; reject oversize before signing. Verify the buy's encoded output equals the transfer amount.
- [x] Extend complete-bank simulation with distinct token-account expectations. Validate missing/present accounts, owner/mint/program/raw amount and expected net deltas independently of SOL debit parsing. Fail closed on incomplete evidence, unsigned and signed.
- [x] Integrate composition and exact output capture into prepare; aggregate all participant token deltas (including creator first buy); bind canonical transfer intent to the runtime plan; execute and checkpoint public fields defensively.
- [x] Add signed engine tests for shared and cross-participant recipients, tampering, size/cost rejection, cancellation, unknown receipt preservation and no duplicate submission. Preserve no-transfer behavior.
- [x] Add public receipt round-trip tests, ensuring only allowlisted fields survive and old records remain readable.
- [x] Run focused native/bundle/receipt tests and report exact results. Keep commits scoped; coordinate with parent before committing shared working tree.

### Task 2: Buyer fields, mode transitions, review and public outcome UI

**Own files:** `src/components/launch/steps/{LaunchSettingsStep,PumpBundleSignSendStep,ResultStep}.tsx`, their CSS, `src/stores/launchStore.ts`, `tests/{launch-bundle-settings,launch-bundle-library}.test.ts`, focused new UI tests if useful.

**Interfaces:** Consume shared fields above; do not implement transaction composition. `setBundleSettings` removes transferTo when leaving Block-0 and retains normal preview invalidation. Preserve optional fields when editing/selecting existing wallets.

- [x] Add failing tests for destination changes invalidating previews, clearing on mode switch, and public round-trip persistence.
- [x] Add optional **Send bought tokens to** to included Block-0 buyer rows with a visible label, public-address-only help and existing validation/error flow.
- [x] Show exact transfer amount and recipient from the prepared review, with fee/rent costs already reflected in reviewed payer amounts. Show the full public recipient in review.
- [x] Carry `tokenTransfers` from execution into `bundleExecution.transfers` and display/export public outcomes without marking unconfirmed transfers successful.
- [x] Run settings/library tests. Check responsive layout and accessibility in the browser once integrated.

### Task 3: Integration, verification and review

**Own files:** plan/progress/docs, opt-in `tests/launch-bundle-localnet.live.test.ts` as needed. Resolve interface mismatches with task owners.

- [x] Verify clean baseline focused tests before feature assertions.
- [x] Run integrated focused tests, type generation/typecheck, lint, full default regression suite and production build in an environment without provider secrets.
- [x] Inspect an actual Block-0 buyer UI at desktop/mobile size without importing any private keys. Verify mode switching removes transfer fields.
- [x] Add/run disposable local execution cases if the verified local runtime is available; prove exact recipient credits and atomic failure. Clearly report any unavailable local execution instead of claiming live proof.
- [x] Have an independent reviewer inspect the complete diff for spec compliance and correctness. Fix substantiated issues, rerun affected checks.
- [x] Update feature docs and approved spec status. Commit only intended code/docs/tests; retain the local branch for user review, without pushing or deploying.

## Verification result — 2026-10-29

Implemented on codex/block0-token-transfer. The default suite passed 844 tests with 77 optional tests skipped; lint and the production build passed. The browser check verified desktop/mobile layout and mode-switch cleanup using a public-only disposable fixture. Independent review found no actionable issues. The new exact-credit and rollback localnet cases were added but could not execute because the verified local runtime was unavailable. No funded transactions were submitted; deployment and live execution remain outside this change.
