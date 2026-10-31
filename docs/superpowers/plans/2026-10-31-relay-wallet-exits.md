# Relay wallets and sales implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Complete meaningful failing tests before implementation and run release checks before integration.

**Goal:** Bring our Relay token migration into OutSol's sniper workflow, generate encrypted source and recipient wallets, and review token sales for one wallet or a selected group.

**Architecture:** Reuse OutSol's passphrase-encrypted wallet library and common submission lock. Adapt our existing Relay token-account checks to OutSol's Connection; keep its source-account support and SOL-preserving transfer semantics. A separate sale adapter uses native Pump.fun for active curves and Jupiter's zero-integrator-fee build route where an independently validated market exists. Every queue stops on failure or unknown confirmation and preserves original public receipts.

**Tech stack:** Existing Next.js, React, TypeScript, Solana web3 and SPL packages; Vitest; local simulated funds for execution.

**Spec:** User request in this chat, existing Relay README and chain implementation at Template/sites/token-relay, existing OutSol signing/recovery requirements.

## Global constraints

- Solana only, Pump.fun only for creation, 0% OutSol fees. Network fees, account rent, venue costs and minimum proceeds disclosed independently.
- Private keys stay in the existing encrypted browser wallet library. RPC/provider credentials stay server-side. Never copy Relay's owner wallet catalog or hosting identity.
- No live funded executions during verification.
- Local generated source and recipient wallets share the existing library; source and destination must differ.
- Unknown transactions block further spending and never automatically retry. Refresh preserves configuration and public receipts, never restarts execution.
- Existing saved wallet/draft/session formats remain readable.

## Review focus

1. A locked/replaced wallet or changed recipient during any asynchronous step must stop signing/submission.
2. Automatic Relay must move only the confirmed purchase amount, retaining unrelated holdings and source SOL except disclosed fees/rent.
3. Incomplete scans and no-route/unsupported assets must remain visible; no false 'sold all' status.
4. Every packet must match reviewed amount, recipient, minimum output and fee ceiling; altered signed messages must fail.
5. Storage, cancellation and confirmation failures preserve original signatures and partial batch outcomes.

## Tasks

### 1. Relay adapter and public routes

- [x] Add src/lib/relay/{types,scan,prepare,execute,history,routes}.ts.
- [x] Start with tests for source-account/TLV validation, exact transfers, SOL exclusion, route identity, message mutation, lock/storage failures and unknown recovery.
- [x] Implement scanRelayWallet, prepareRelayTransfer, executeRelayTransfer and conservative original-signature reconciliation. Give sessions a trusted already-locked internal adapter.
- [x] Preserve full public route wallet IDs; re-resolve their addresses from the live wallet library.
- [x] Run focused tests and independent review.

### 2. Market sale adapter

- [x] Add src/lib/sales/{market,provider}.ts and authenticated same-origin app/api/sales/build/route.ts.
- [x] Test exact payer/input/output/amount/minimum/fees, malformed or hostile instructions, LUT identity and signed balance changes first.
- [x] Native Pump sale for active supported curves; vetted Jupiter V2 build route for other markets. Expose unsupported/no-route states accurately.
- [x] Build and simulate locally; never send keys or signed packets to provider. No integrator fee or arbitrary third-party endpoint.
- [x] Run focused tests and independent review.

### 3. Wallet creation and sniper integration

- [x] Reusable CreateManagedWallets component using existing library encryption and batch limits.
- [x] Extend optional public session Relay configuration, default off. Bind chosen recipient identity.
- [x] Reserve Relay fee/rent budget before each buy and count it against the session total.
- [x] After confirmed buy, transfer exact acquired tokens. Preserve confirmed buy if the transfer fails and stop further orders.
- [x] Test legacy restoration, budget enforcement, precise amount, cancellation and pending recovery.

### 4. Relay holdings and sale batches

- [x] Add src/lib/sales/{batch,history}.ts and tests/sales-batch.test.ts. Approval binds immutable wallet identities, amount and minimum output.
- [x] Prepare all bounded selected rows; fresh execution cannot weaken sale bounds. Persist original pending trade before broadcast and stop sequentially on unknown/failure.
- [x] Add /relay with source/recipient routes, encrypted wallet creation shortcuts, accurate holdings, per-wallet and group Relay/sell reviews, explicit exclusions and recovery.
- [x] Link from sniper, wallet workspace, tools and activity. Add Relay pending guard to every existing submission boundary.

### 5. Release verification

- [x] Run type checking, lint, full tests, dependency audit and production build.
- [x] Execute native sales and Relay transfers with fresh fake-funded wallets against local Solana simulation, verify exact source/destination balances and durable receipts.
- [x] Browser-check desktop/mobile, wallet generation, route persistence, scan/review/error/empty states and keyboard dialogs without live transactions.
- [x] Independent whole-change review; fix concrete findings and rerun relevant checks.
- [ ] Commit as OutSol, integrate current main without overwriting newer work, deploy through existing Railway pipeline, verify live routes and report limits.
