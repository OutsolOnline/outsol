# Unified Vanity Workspace Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent UI tasks and inline execution for the shared draft/navigation model. The user has already delegated design and implementation decisions; continue without an additional design approval gate.

**Goal:** Make Vanity a cohesive, polished Solana launch workspace with discoverable tools, reusable launch drafts and a friendlier creation flow.

**Architecture:** Keep existing native launch, wallet, simulation and recovery engines. Add a shared typed tool catalog, safe public draft persistence, a wallet-optional design flow, and a consistent sidebar/top bar interface. UI changes have disjoint file ownership; root integrates and verifies deployed behavior.

**Tech Stack:** Existing Next 16, React 19, TypeScript, Tailwind/CSS, Zustand, Vitest. No new dependencies.

**Spec:** User's request in this chat: improve UI/site and combine useful RapidLaunch, Uxento and Proxima workflows. Builder decisions: compact mint/indigo dark interface, operation-focused dashboard, searchable actions, public drafts, visible metadata preview; Solana only and zero Vanity platform fees.

## Global Constraints

- Preserve server-only RPC credentials, encrypted keys and public-only recovery records.
- No funded transactions during implementation or verification.
- Keep current launch simulations, cost review, single-transaction direct launch and recovery gates.
- Never fabricate market data, balances, platform support or performance.
- Keep browser-local draft data explicitly public; exclude mint secrets, wallet keys, images and prepared/signed transactions.
- Respect reduced motion, keyboard navigation, focus visibility and 390px screens.
- Push the verified result to existing private GitHub main and its Railway deployment.

## Review Focus

- Untrusted/corrupt draft JSON must not restore secrets, private keys, unexpected fields, non-HTTPS links or bypass fresh review.
- Selecting a venue shortcut in the same browser session must actually set that launch venue without resetting an in-progress signed flow.
- Designing before connecting a wallet must never permit submission without an unlocked current signer.
- Search dialog must support keyboard escape, correct focus handling and navigable result links.
- Sidebar and sticky cards must not obscure content at mobile/tablet widths; no duplicate main navigation.

## Tasks

### 1. Shared tool catalog, public drafts and launch flow (root)
- [ ] Add failing behavioral tests for exact venue links, query validation, public-only draft projection and safe restore.
- [ ] Implement typed catalog, validated public draft helpers and UI draft manager.
- [ ] Add searchable/filterable `/tools`, saved `/drafts` and launch links for all supported venues/modes.
- [ ] Allow metadata and address design before wallet connection; show token preview and selected venue throughout.
- [ ] Verify targeted tests and the entire suite.

### 2. Shared interface and dashboard (UI agent)
- [ ] Redesign Header/Footer/global styles and dashboard as one coherent product.
- [ ] Add keyboard-searchable command palette using the shared catalog.
- [ ] Replace oversized marketing hero with concise welcome, launch shortcuts, real activity and useful tool links.
- [ ] Check accessibility, reduced motion, responsive layout and types/lint.

### 3. Tool-page polish (tool UI agent)
- [ ] Improve vanity studio, wallet page and bundler framing/layout/empty states.
- [ ] Keep keys and all execution logic unchanged; wire useful related-tool links.
- [ ] Verify type/lint and existing behavior tests.

### 4. Integration and delivery (root + fresh reviewer)
- [ ] Review full changes for routing, draft privacy, wallet gating and regressions.
- [ ] Run typecheck, lint, full tests, production build and runtime audit.
- [ ] Browser-check desktop/mobile search, venue shortcuts, draft save/restore, preview and vanity workers without broadcasting.
- [ ] Scan client output for credentials; commit, privately push and verify Railway deployment.
