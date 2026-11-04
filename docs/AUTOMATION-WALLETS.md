# Dedicated automation wallets

This first unattended trading slice runs a bounded DCA schedule for one active SOL-quoted Pump.fun mint. It can buy a fixed SOL amount or sell an exact whole raw token amount. It continues while the browser is closed because the server holds a **new dedicated wallet**, encrypted at rest, and signs each reviewed attempt. Browser wallets and imported local private keys never enter this system.

## User flow

1. Explicitly choose a new server-held wallet with separate funds.
2. Download the private automation recovery receipt. It contains a random owner capability, not the wallet key. The server stores only its SHA-256 hash. The shared application access password does not grant access to anyone else's dedicated wallet.
3. Deliberately consent to downloading the dedicated wallet keypair backup. This is a standard 64-byte Solana keypair JSON array. Anyone holding this file can move its funds. Keep it private and separate from the receipt. It can be imported into a compatible external Solana wallet to recover funds; there is no arbitrary-destination server withdrawal endpoint.
4. Fund only the displayed dedicated address through an external wallet or an ordinary reviewed transfer. Hold enough SOL for the full approved plan ceiling plus the minimum reserve, and enough token base units for all planned exact sells.
5. Prepare a native preview, inspect the exact mint, action, amount, count, schedule, expiry, all-in debit ceilings, reserve, slippage, priority ceiling and current simulated output. Sell review displays the token mint's verified decimals and exact human token equivalent.
6. Explicitly approve and arm the immutable reviewed plan hash. Future quotes are freshly built and simulated inside the reviewed authority. Each message contains exactly one native trade. A review does not approve a frozen future token price or guarantee profits.
7. The private receipt restores owned status and history after refresh or on another device. Capabilities remain in memory in the browser tab unless the user downloads a receipt. They never appear in URLs or logs.

Cancellation stops future preparation/submission. An original signature recorded for submission can still land and remains visible in history. Cancellation does not withdraw funds or reverse an on-chain transaction.

## Fixed bounds

- One wallet has at most one reviewed or armed policy, and at most one pending original signature.
- A plan has 1–10 attempts, 60–3,600 seconds between attempts, starts within one hour of review, and expires within 24 hours. Confirmation delays move the next interval forward; the worker never catches up with a burst of overdue trades.
- Maximum total SOL debit is 1 SOL per approved policy. Every attempt reserves its complete reviewed per-attempt ceiling before submission, including failed transactions and their fees. Reserved budget is never replenished from sale proceeds.
- The minimum wallet reserve is at least 0.005 SOL. The worker verifies wallet balance covers the **full per-attempt ceiling plus reserve**, not merely the optimistic simulated debit.
- The per-attempt ceiling must cover the encoded buy ceiling, a conservative 0.01 SOL native account-rent envelope, a 5,000-lamport base fee, and the reviewed priority fee ceiling. The exact signed same-bank simulation must independently fit the debit/rent/fee ceilings. Sale account rent and fees count inside the same ceiling.
- Slippage is at most 10%; priority fees are at most 0.001 SOL. Only active native SOL Pump.fun curves are allowed. Unsupported curves, graduated tokens, changed intent, unreadable balances, expired original blockhashes, unavailable simulation and on-chain failures stop fresh trading.
- Server-wide wallet quota: 100. Server-wide policy history quota: 10,000. Each policy has at most 10 transaction attempts. Generation is limited to two wallets per client per hour and ten per server per hour. API requests are bounded by body size, client/server rate limits and in-flight limits.

## Deployment

Run Node 22 with built-in `node:sqlite`, a persistent volume, and:

```text
AUTOMATION_WALLET_ENCRYPTION_KEY=<32 random bytes encoded as canonical padded base64>
AUTOMATION_STORAGE_DIR=/data/launchpier-automation
AUTOMATION_TRADING_ENABLED=true
RPC_URL=<server-only HTTPS mainnet Solana RPC supporting simulateBundle account snapshots>
```

`AUTOMATION_STORAGE_DIR` must be a direct child of the mounted persistent volume (`RAILWAY_VOLUME_MOUNT_PATH`, default `/data`) and cannot overlap public assets, X credentials, funding receipts or background jobs. The configuration rejects malformed keys, symlinked storage roots, production loopback RPC endpoints, endpoint credentials and non-HTTP protocols. A key change requires a server restart. Preserve the encryption key alongside private operational backups; losing it makes stored wallet keys unrecoverable by the server. Users' downloaded keypair backups remain independently usable.

Start `startAutomationWalletWorker()` from server startup/instrumentation. It uses a 15-second polling interval and returns a `stop()` handle. Persistent SQLite leases fence parallel processes. SIGTERM/SIGINT stop new work; startup resumes read-only reconciliation of stored original signatures. The worker must run in an always-on process with persistent storage; a request-only/serverless deployment does not provide this execution model.

If startup temporarily fails, readiness and owned status requests retry worker startup, and arm independently requires a running worker before committing the approved state. Readiness includes a safe `workerRunning` flag. A startup failure leaves a reviewed plan unarmed; a later arm can succeed after storage recovers without requiring an application restart.

`AUTOMATION_TRADING_ENABLED=false` prevents new wallet creation, reviews, arms and worker execution. Owned status, cancellation and backup remain accessible when key/storage/RPC settings are valid. Public readiness contains only configuration/enablement and fixed limits, never keys, capabilities, paths or provider URLs. Disabling the worker does not undo a previously submitted transaction.

For isolated local fork tests only, a non-production process may set `AUTOMATION_ALLOW_LOCAL_TEST_RPC=true` and explicitly use a loopback HTTP RPC. Production ignores that exception. The tests below never request existing wallet keys or mainnet funding.

## Transaction and recovery guarantees

The worker reuses `preparePumpTrade`, `inspectTradeIntent` and `simulateSignedTrade`. It verifies mainnet genesis; one native active curve; exact payer/mint/action/token sale amount; unchanged serialized native message; bounded base/priority fee and total debit; minimum wallet reserve; and the original signed blockhash lifetime. Signed simulation uses `skipSigVerify: false` and `replaceRecentBlockhash: false`. RPC and both simulation paths share a fixed endpoint, a 20-second deadline, a 2 MiB response ceiling, redirect refusal, response cancellation and generic errors.

Wallet secrets use AES-256-GCM with fresh IVs and wallet ID/address as authenticated context. Decrypted secret bytes are held only in synchronous signing/backup scopes; the exact owned backing buffers and intermediate decrypted buffers are erased before any signed-simulation await. Backup deliberately returns a separate JSON array to the user. JavaScript and native cryptographic libraries can create transient internal copies; this is not a guarantee against full live-process compromise. Dedicated funds and recoverable user backups remain necessary to this custody model.

SQLite uses WAL, `synchronous=FULL`, a unique pending-signature constraint, one active-policy constraint, and `BEGIN IMMEDIATE` mutations. Before the only send call, the exact original signature and signed packet are durably stored, and the full attempt ceiling/count are reserved. A preparation lease expires after three minutes and can be reclaimed only when there is no recorded pending original.

- **Crash before durable signature storage:** no transaction has been sent; a later worker may prepare again after the lease expires.
- **Crash after storage but before the send call:** the original remains pending and is never sent on recovery. This intentionally sacrifices liveness when submission cannot be proved.
- **Lost send response / crash after send:** only the original signature is checked with transaction-history search. The worker never replaces the blockhash, rebuilds a spending packet, races alternate submission providers or re-sends the stored packet.
- **Confirmed original:** the next interval can proceed if the approved count, budget and expiry allow it.
- **Confirmed failure:** the plan blocks further fresh trading, retaining the full attempt ceiling, including fees.
- **Unknown original:** no new plan or wallet spending is permitted through this system. There is no manual “assume failed and retry” control. Keep the original signature and recover externally with the dedicated backup when appropriate.

## API and verification

`GET /api/automation-wallets` returns safe readiness. `POST` accepts a narrowly selected `action`: `create`, `status`, `backup`, `review`, `arm`, or `cancel`. Owned actions require `Authorization: Bearer <private receipt capability>`. App access, an actual allowed Origin, an 8 KiB request-body ceiling, no query strings, request deadlines, `no-store`, and generic error responses protect this boundary. Existing key arrays and unknown fields are rejected.

Focused verification:

```text
npx vitest run tests/automation-wallets.test.ts tests/automation-wallet-worker.test.ts tests/automation-wallet-service.test.ts tests/automation-wallet-handlers.test.ts tests/automation-wallet-config.test.ts tests/automation-wallet-rpc.test.ts tests/automation-wallet-simulation-transport.test.ts
```

The optional `tests/automation-wallets-localnet.live.test.ts` suite uses fresh generated dedicated wallets, a private temporary encrypted SQLite database, simulated SOL, and an isolated Surfpool mainnet fork whose upstream denies writes. It proves real native preview, arm, scheduled buy, exact sell, database reopen, lost send response, original-signature recovery and cancellation before submission. Live-mainnet trading/funding is outside these checks.
