# Reusable sniper pairs implementation plan

> Use subagent-driven development for independent catalog, launch binding and reviewed operations tasks. The user has delegated implementation decisions; this plan records the clarified workflow without another design approval gate.

**Goal:** Make a named Sniper → Token Receiver pair the primary wallet unit inside Bundles and launch preparation. Generate, back up, manually fund and reuse pairs; source buys forward exact purchased tokens; pair sale actions sell from receivers only.

**Architecture:** Keep pair records public and local, with private keys in the proven encrypted wallet library. Keep the deployer separate. Bind selected source wallets to existing buy rows and transferTo destinations. Reuse the existing reviewed Relay/sale engines with an enforced receiver-only sale allowlist and fixed source-to-receiver routes.

**Constraints:** Solana/Pump.fun, zero OutSol platform fees, no real funded tests, no key-bearing public storage or logs. Preserve signing, pending protection, cancellation, recovery and legacy wallet data. Never put receiver wallets into launch buyers or pair sell actions onto sniper/deployer wallets. Receivers need their own SOL for sales.

## Tasks

- [x] Public reusable pair catalog and exact-address restoration: `src/lib/sniperPairs/catalog.ts`, `src/stores/sniperPairStore.ts`, meaningful catalog tests. Canonical fields: id, name, sniperWalletId, sniperAddress, receiverWalletId, receiverAddress, createdAt. Resolve matching imported wallets by public address when local IDs change.
- [x] Launch binding and live pair scope: `src/lib/sniperPairs/launch.ts`, tests. Select at most 16 pairs, deployer distinct from all pair wallets, dedicated source group contains deployer and selected sources only; preserve source buy budgets, forward to each exact receiver. Inline creator stays separate. Refuse edits while launch/pending guards apply.
- [x] Pair actions presentation over existing RelayWorkspace: paired cards, copy addresses, per-side/both/all private backups, fresh balance scans, immutable pair transfer routes. Receiver sales use a hard allowlist at review and execution, with one receiver or selected receivers only. No generic source sale buttons in this view.
- [x] Generate-pairs and reuse UI: count pairs rather than wallets, two encrypted wallets per pair, clear names, save all encrypted wallets even if public pairing fails. Pair existing library wallets and import via existing encrypted importer. Explicit separate deployer and launch-use controls; budgets and destination visible together. Preserve advanced legacy tools behind disclosure.
- [x] Browser checks generation/export/refresh/reuse, receiver-only sale selection and desktop/mobile; meaningful unit/behavior checks, simulated execution acceptance, independent review, lint/type/build/audit.
- [ ] OutSol-authored organization push, Railway deployment, health/access checks and final screenshots.

## Review focus

- Selected sources, receiver addresses or local imported IDs change during an open review: invalidate approval and never switch signers.
- Pair wallets collide across roles or with deployer: refuse launch assignment and recipient-only execution.
- Source has old token balances: launch forwards only its exact new purchase; manual transfer separately reviews existing balances.
- Pair save fails after generating encrypted wallets: preserve the wallets and explain recovery from the library.
- Refresh or a new token launch: reusable pair records persist independently of launch result and never automatically submit another buy or sale.
