# OutSol continuity and finishing implementation plan

> The user delegated implementation and requested a final quality pass. Reuse the clean feature checkout; implement independent scopes concurrently and review before release.

**Goal:** Preserve unfinished work, surface preparation problems early, and finish practical keyboard, artwork and local-development flows.

**Architecture:** Add bounded, whitelisted public configuration drafts beside the existing immutable transaction engines. Restore only editable inputs and local artwork references, never approval, signers, packets or execution. Keep existing transaction locks, exact validation and original-signature recovery unchanged.

**Spec:** Current user request, “just make it perfect,” within the existing OutSol product requirements.

## Constraints

Pump.fun and Solana only; 0% OutSol fees; disclose external costs. Preserve encrypted wallet and old draft storage. No real-fund execution or browser extension installation. Keep RPC credentials server-side. No dependency additions. Private GitHub and Railway remain the authorized delivery path.

## Tasks

- [x] Multi-launch continuity: public form and local artwork references survive navigation/refresh; early validation, useful autosave errors and interruption status. Tests prove private/execution data exclusion, corruption protection and incomplete design restoration.
- [x] Trading-session continuity: hydration-safe public form storage; explicit mode URL takes precedence; no stored approval or rearm; early validation and wallet next actions. Focused behavioral tests.
- [x] Capture finishing: consistent input validation, early artwork feedback, cancellation, stale-result protection and tab-local editable review recovery. Repackage download and test boundaries.
- [x] Workspace finishing: real-browser keyboard/empty/error/responsive audit; fix concrete shell issues and broken standard local start command.
Release procedure: review diffs, run complete type/lint/test/build checks, verify browser persistence and target widths, push privately and verify the exact Railway release and ZIP. Final release evidence is recorded in `OutSol-quality-checks.json` in this task’s outputs.

## Review focus

- Hydration must not replace existing drafts with defaults.
- Restored public fields must never restore approval or restart execution.
- Corrupt/oversized storage must fail visibly and remain untouched.
- Canceled or stale artwork requests must not overwrite a newer choice.
- Missing artwork or locked wallets need a clear next action before publication/signing.

## Rulings

- Improve existing working routes without extending competitor-parity claims or first-block promises.
- Store public editable drafts separately from public transaction receipts; changing a design always invalidates its prepared session.

## Verification

554 default checks pass, plus two separately opted-in native Surfpool execution tests. Public forms survived navigation and refresh, with approval kept unchecked. Browser checks covered 390/768/1440/1920 widths. Independent review identified one capture recovery issue, fixed and re-reviewed. A fresh quiet Chrome load/reload did not reproduce earlier development-only Event logs; no blanket error suppression was added.
