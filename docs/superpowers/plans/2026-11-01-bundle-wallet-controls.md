# Bundle wallet controls implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Write meaningful failing behavioral tests before implementation and verify the release before integration.

**Goal:** Put Relay, wallet generation/import, per-wallet and whole-bundle sales, and explicit private-key/keypair downloads inside both Bundles and the token builder.

**Architecture:** Embed the existing Relay/sale workspace using a live, bounded bundle-wallet adapter. Include the creator, configured buyers and controlled recipients; never show unrelated library wallets. Use the existing native exact-buy transfer composition for automatic buyer Relay in all bundle modes. Keep existing encryption, transaction validation, pending protection and public recovery records.

**Stack:** Existing Next.js/React/TypeScript, Solana native builders, encrypted wallet library and Vitest.

**Spec:** User clarification in this chat on 2026-11-01: controls belong inside bundles; sell all tokens for an individual wallet or all bundle wallets; generate wallets and provide their private keys/keypairs.

## Constraints and review focus

- OutSol platform fee remains zero; network, rent, protocol and validator costs remain explicit.
- Wallet generation and backup are local. No private keys in URLs, logs, server requests, presets or public storage.
- Private exports require an explicit local action, validate every key/address and refuse partial backups when any wallet is locked or changed.
- Both manual session keys and encrypted library wallets work; readonly external recipients cannot be represented as owned.
- Automatic buyer Relay moves only the exact new purchase in the buy packet; creator first buy is unchanged. Routed buyers cannot silently schedule source-wallet sells of transferred tokens.
- Unknown signatures block subsequent spending, changing scope invalidates open reviews, and refresh never resumes a queue.
- Preserve existing budgets, timings and destinations when appending generated/imported wallets or switching launch modes.
- Use only disposable simulated funds for execution tests.

## Tasks

### 1. Private backup capability

- [x] Add privateBackup helper and PrivateWalletBackup dialog with CLI JSON keypair and base58 exports for one/all controlled wallets.
- [x] Test exact formats, public-key binding, duplicates, late locks, identity changes and no partial output.
- [x] Add inline encrypted import dialog using the existing parser and library store.

### 2. Scoped wallet controls

- [x] Add pure live-source adapters for standalone bundles and inline launch buyers/creator/recipients.
- [x] Embed RelayWorkspace without a second shell, restricted to the current bundle's wallet identities.
- [x] Add per-wallet and all-selected sale, scan, Relay, unlock and private-backup actions; controlled newly created recipients remain in scope.
- [x] Test scope mutation/removal, ownership, duplicates, library locks and source replacement.

### 3. Automatic buyer Relay

- [x] Extend standalone buyer settings with transferTo and preserve inline destinations across Manual/Organic/Block-0.
- [x] Compose exact purchased output + recipient account creation + transferChecked in the same native buy packet.
- [x] Verify signed token deltas, fee/rent ceilings and immutable pending receipt intents, including future timed buys.
- [x] Refuse conflicting routed-source auto-sells and retain legacy settings/receipts.
- [x] Simulated execution acceptance for affected modes and standalone bundles.

### 4. Bundle generation and interface integration

- [x] Create/import encrypted bundle groups inline, preserving existing buyer budgets and settings when adding wallets.
- [x] Recipient selection and local recipient generation beside every buyer's Relay setting.
- [x] Mount scoped wallet controls in both Bundles and launch preparation, with clear primary actions and accurate signing copy.
- [x] Browser-check desktop/mobile, generation, backup dialogs, route selection, locked/error/empty states and refresh behavior.

### 5. Release

- [x] Independent review and fixes; full tests, type checking, lint, production audit and build.
- [x] Push OutSol-authored commits, deploy Railway, verify health/access protection, publish screenshots and observed limitations.

## Release evidence — 2026-11-01

- Application commit: `2c4fb53ef0e13f83c6c6dd87bed546ecaee17b34`, authored by OutSol and pushed to the organization repository.
- Railway deployment: `fc31bb43-f257-4e29-b071-88cd0c260576`, status SUCCESS. Hosted health returned 200; protected launch, bundle and Relay routes still redirect unauthenticated requests to /access.
- Final suite: 973 passed, 87 opt-in or existing skips. Type checking, lint, production build and production dependency audit passed locally and in Railway's builder; audit reported zero production findings.
- Six separate fake-funded Surfpool cases passed across inline/standalone and Block-0/Manual/Organic. Cold recovery, individual sales and the remaining-wallet sale batch completed with original on-chain minimums and zero final token balances. No real SOL spent.
- Browser checks covered generation, masked bulk import, lock/unlock, empty scans, private JSON/Base58 downloads, keyboard Escape/focus restoration and responsive controls at 390, 768, 1440 and 1920 pixels. Browser file-picker automation was unavailable; local file parsing is unit-tested and the masked bulk-import path was exercised in the browser.
- Accepted edge: explicitly deleting and reimporting an extra recipient under a new local library ID requires using global Wallets/Relay to select that restored wallet. Normal refresh, named-group edits and inline-to-Bundles receipt recovery preserve attachments.
- Screenshots and sanitized simulated execution proof were saved to the chat's outputs folder. Temporary plain private-key test files were removed; encrypted disposable QA wallets remain local to the preview origin.
