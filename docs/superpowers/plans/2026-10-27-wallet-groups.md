# Multi-wallet groups implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let creators create or bulk import multiple encrypted Solana wallets, organize them into named groups, and review and execute whole-group SOL funding or withdrawals with safe recovery.

**Architecture:** Add an encrypted multi-wallet collection beside the existing single-wallet storage. Keep private keys only in unlocked module memory and expose public wallet/group summaries to the interface. Reuse the existing transaction builders and exact-integer simulation checks, while a dedicated public group journal records each attempted signature under the shared browser submission lock.

**Tech Stack:** Existing Next.js/React/Zustand application, Solana web3.js, AES-GCM with the existing 600,000-round PBKDF2 implementation, native browser Web Locks and storage, Vitest, and the official local Surfpool runtime.

**Spec:** The current user request in this chat: “let people create and bulk import multiple wallets, organize them into named groups, and easily fund or withdraw from the whole group. test the whole flow end to end too”. The user has delegated design and implementation choices. This is an extension of the implemented OutSol workspace, not a new project.

## Global constraints

- Solana-only support and 0% OutSol platform fees; separately disclose network and third-party costs.
- Up to 100 stored wallets; creation/import batches up to 20; named managed groups up to 20 members.
- Existing encrypted wallet and recovery records remain recoverable. Do not overwrite or silently delete old browser data.
- Private keys and passphrases never enter URLs, public journals, logs, server requests or public exports.
- Creation/import encrypts each wallet before one verified collection write. A malformed or duplicate batch must not partially save.
- Use the existing `vanity-launch-submission` lock for the full reviewed group operation; never automatically resend an uncertain signature.
- Only fresh disposable keys and simulated SOL may be used for execution tests. Mainnet reads are allowed; real mainnet submissions require separate explicit authorization.
- GitHub Actions is not required. Railway runs the release checks in its Docker builder before deployment.

## Review focus

- A second tab edits the collection while encryption or unlock is in progress: preserve both the previous collection and signer boundaries, rejecting stale writes.
- A wallet locks, the selected signer changes or the screen closes during an RPC/signature wait: stop future broadcasts and retain evidence for any prior submission.
- A group contains the withdrawal destination, zero balances or insufficient fee funds: explicitly report exclusions and exact remaining balances; do not invent a transfer amount.
- A response is lost after a transfer: stop the batch, retain its original signature, and reconcile before starting more spending.
- An existing single-wallet vault or plaintext legacy wallet is found: retain its original storage until a verified compatible adoption or explicit migration succeeds.

---

### Task 1: Encrypted wallet collection and named groups

**Owner:** `multi_wallet_vault` agent.

**Files:** New `src/lib/walletLibrary/*`, new `src/stores/walletLibraryStore.ts`, and focused tests. Do not modify the legacy wallet store or interface in this task.

**Interfaces:** `useWalletLibraryStore` exposes public `wallets`, `groups`, `activeId`, `hydrated`, `busy`, `error`, `storageUnavailable`, `legacyMigrationNeeded`, `unlockedIds` and `revision`. Public summaries contain IDs, names, addresses and timestamps only. Methods include `hydrate`, `createWallets`, `importWallets`, `unlockWallets`, `lockAll`, `selectWallet`, `getKeypair`, `getActiveWallet`, `createGroup`, `updateGroup`, `renameWallet`, `removeGroup`, and explicit private `exportWallets`.

- [x] Write and observe failing tests for batch creation/import, duplicate rejection, malformed input, failed storage, stale cross-tab writes and wrong passphrases.
- [x] Implement bounded import formats: one Base58 key per line, standard keypair JSON and supported arrays/backup containers.
- [x] Encrypt each new key using the existing vault format; verify ciphertext writes before reporting success.
- [x] Add atomic unlock, in-flight operation epochs, explicit locking and storage-change invalidation.
- [x] Adopt an existing encrypted single-wallet vault without decrypting or deleting its original record; preserve explicit plaintext migration behavior.
- [x] Run focused tests and inspect that persisted/public state contains no plaintext secrets.

### Task 2: Reviewed group funding, withdrawals and recovery

**Owner:** `group_transactions` agent.

**Files:** New `src/lib/walletGroups/*`, unit and signed local-runtime tests.

**Interfaces:** `GroupWallet` is `{ id, name, address }`. `prepareGroupOperation(connection, input)` accepts group wallets plus either funding `{ payer, amountSol, priorityFeeSol }` or withdrawal `{ destination, amountMode: 'available' | 'fixed', amountSol?, reserveSol, priorityFeeSol }` settings, and returns public rows/summary plus prepared unsigned transactions. `submitReviewedGroupOperation` accepts explicit `canSign(payer)` and `signTransaction(payer, transaction)` callbacks and owns the single shared lock and public journal. `reconcilePendingGroupOperation` checks existing signatures only. History exports include `readPendingGroupOperation`, `assertNoPendingGroupOperation` and `readGroupOperationHistory`.

- [x] Write and observe failing tests for exact amounts, duplicate/self recipients, preview expiry, insufficient balances and changed signers.
- [x] Implement full group funding previews with every recipient and aggregate costs. If transactions are sequential, disclose partial execution and preserve each completed step.
- [x] Implement fixed-amount and available-SOL withdrawals to one reviewed destination, subtracting exact fees and any explicit retained reserve.
- [x] Hold the shared lock throughout signing and sending, revalidate signed messages and balances, and save public pending evidence before each broadcast.
- [x] Stop after cancellation, failure or unknown confirmation. Reconciliation checks the original signatures and never resends uncertain transfers.
- [x] Execute signed tests against a verified loopback Surfpool runtime using only fresh disposable keys and simulated SOL.

### Task 3: Wallet manager and compatibility integration

**Owner:** Root agent.

**Files:** Wallet manager/group operation UI, `/wallet` and `/wallet-operations`, legacy wallet compatibility accessors, `ClientProviders`, spend/reset entrypoints, and Activity projection as appropriate.

- [x] Build readable wallet/group rows with create, bulk import, rename, select, unlock, lock and explicit backup controls.
- [x] Add group creation and membership editing; preserve wallets when removing a group.
- [x] Add funding/withdrawal inputs, complete reviews, progress, cancellation and recovery actions.
- [x] Connect the selected managed wallet to existing launch, trade and transfer signers without falling back to a different legacy signer while the selected wallet is locked.
- [x] Subscribe existing wallet views to collection changes. Use the selected public address in locked views and the wallet inspector.
- [x] Hydrate both storage systems and lock all unlocked keys using the existing inactivity timer.
- [x] Add pending-group gates to Pump launch, manual trade, standalone wallet operations, bundles and unsafe design resets. Do not block read-only recovery checks.

### Task 4: Independent review and full-flow verification

**Owner:** Review agent and root.

- [x] Review ciphertext/public projections, legacy compatibility, stale async operations and final signer checks.
- [x] Test create → group → fund → withdraw → lock/reload/unlock → recovery with simulated funds.
- [x] Test bulk import formats, duplicate/malformed batch rejection and membership editing without data loss.
- [x] Inspect desktop and mobile forms, status announcements, empty/error states and preview amounts in a real browser.
- [x] Run type generation, typecheck, lint, default regression tests, runtime audit and production build.
- [x] Push the verified implementation to the existing private repository, confirm Railway's independent checks and live deployment, then report actual verification scope and any remaining limitations.

## Verification evidence

The wallet-group release `45ebe2657ec3d1109e75f6e1eb8ff3af9675db22` passed Railway's Docker release gates and was verified live on the configured Railway domain. Local checks passed 375 default tests and four separately enabled Surfpool execution tests using simulated SOL. Browser checks covered creation, JSON bulk import, group editing, encrypted reload, five-wallet funding and withdrawals, Activity receipts, keyboard focus and 390/768/1440/1920px layouts. File chooser automation was unavailable in the browser extension; pasted JSON import passed.

A final deployment check found the already-linked `outsol.online` domain was rejected by the old single-origin server configuration. The follow-up adds a bounded, explicit `APP_ALLOWED_ORIGINS` setting, preserving the canonical Railway address while allowing only the verified custom domain. Malformed entries, wildcard hosts, non-HTTPS production aliases, lookalike domains and cross-site requests remain rejected.
