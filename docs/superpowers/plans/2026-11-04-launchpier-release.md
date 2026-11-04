# LaunchPier release implementation plan

> **For agentic workers:** Use the existing isolated worktree and assigned file ownership. The user approved LaunchPier, delegated implementation decisions, and authorized GitHub and Railway publication after verification.

**Goal:** Ship the approved LaunchPier identity, simpler sniper sessions, reviewed external funding and durable server work while preserving wallet and transaction safeguards.

**Architecture:** Keep Next.js and the existing native Pump.fun engines. Brand changes preserve storage keys, backup schemas, routes and domains. External funding uses server-only credentials and reviewed orders. Durable jobs use private persistent storage and per-owner capabilities. Any hosted signer uses new dedicated wallets, explicit bounded approval and original-signature recovery.

**Tech stack:** Next.js, React, TypeScript, Node 22, SQLite, existing Solana/Pump SDKs, Vitest, isolated Surfpool.

**Spec:** The user's approved LaunchPier name/logo and full existing OutSol product requirements in this conversation; brand geometry and tokens in `docs/LAUNCHPIER-BRAND.md`.

## Global constraints

- Pump.fun / Solana / SOL new launches; 0% LaunchPier platform fees.
- Network, rent, protocol, Jito and provider costs stay visible and separate.
- No live transactions or funded financial testing without explicit authorization.
- Do not upload existing local vault keys or change compatibility identifiers.
- Public organization source repository; organization commit identity; no GitHub Actions.
- Publish with explicit APP_ACCESS_MODE=public at the owner’s request; preserve wallet/capability protections, private RPC configuration and pending recovery.
- Missing provider authorization, inventory or credentials must appear as unavailable; no fabricated marketplace, Shield route or quote.

## Review focus

- A rebrand must not strand old encrypted wallets, drafts or exports.
- Closing a disclosure must not unmount an operation or bypass its busy guards.
- Removing a session must detach only its exact matching buyers and keep keys and receipts.
- A lost provider response or signed transaction must not lead to duplicate deposits or trades.
- A shared access password is not ownership of private jobs, orders or hosted wallets.

## Work ledger

- [x] Create and inspect vector identity and banner. Save project-bound assets locally.
- [x] Implement session dropdowns and transactional clear/new lifecycle with rollback/stale-view tests.
- [x] Execute native launch, Block-0, relay and receiver-sale tests on strict local Surfpool: 25 signed cases passed; harness packet assumptions corrected.
- [x] Finish shared and feature palette, landing, visible copy, extension and access-page identity. Preserve legacy backup and URL contracts.
- [x] Integrate reviewed SplitNOW quotes/orders/status into Funder. Test consent, allocations, capability isolation, encrypted receipts and uncertain submissions. Keep Husher authorization dependency explicit.
- [x] Integrate durable history panel, startup worker and isolated volume directories. Test restart, cancellation, ownership and original-signature checkpoints.
- [x] Implement and independently review the bounded dedicated-wallet automation slice. No existing-key imports; encrypted server keys; explicit mint/action/budgets/expiry; same-bank signed simulation; persisted original signatures before submission; fail closed on uncertain outcomes.
- [x] Inspect all affected pages at 390, 768, 1440 and 1920px; verify session create/attach/remove/reuse, keyboard dialogs and refresh recovery. Save desktop/mobile screenshots.
- [x] Run whole-tree type, lint, unit/behavioral suite, dependency audit and production build after review fixes.
- [x] Record honest capability and provider setup limits; refresh the source archive.
- [x] Commit with organization identity, push public organization repository, deploy Railway, verify protected production pages and health/release identity.

## Dependency rulings

- SplitNOW supports documented multi-wallet SOL funding but needs an account API key and provider consent. No key is configured; development may prove the contract and recovery without claiming a funded provider execution.
- Husher requires written third-party partner access. Do not use a personal API key to power this public application.
- An aged-wallet marketplace needs authorized inventory and custody/delivery contracts. Shield is a named competitor service, not a public protocol to impersonate. Show these dependencies honestly and retain the existing safer transaction submission controls.
- RPC address history is bounded coverage, not complete token-wide market history. Display cursor, limits and missing/unsupported records explicitly.

## Verification and publication

Use failing behavioral tests before new financial/storage behavior, then focused green tests. Root runs the complete release gates once all file owners hand off. A fresh reviewer audits the combined branch, including hosted key access and replay behavior. Publish only the verified release and smoke-test both application domains without changing the password gate.

Final evidence: application cf01f35; Railway SUCCESS 8029cff5-8ea1-4972-8b54-3ff731c9ba54; 1,394 default tests + 28 signed local-fork cases + 124 live browser checks + 64 anonymous HTTPS page checks. Provider credentials/partner access and complete market-wide indexing remain honestly bounded as documented.
