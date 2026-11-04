# Durable background history jobs

LaunchPier can run bounded, **read-only token history indexing** after the browser closes. The queue, original signature pages, receipt checkpoints, cancellation state and worker leases live in a private SQLite database. Restarting the application resumes queued work and recovers a running job after its lease expires.

This is not unattended trading. Existing browser trading sessions still require an open browser and an unlocked local signer. No existing wallet key is uploaded, decrypted or used by the background service. The server's fixed RPC method allowlist contains only `getAccountInfo`, `getSignaturesForAddress` and `getTransaction`.

## Application integration

- Render `BackgroundJobsPanel` from `@/components/backgroundJobs/BackgroundJobsPanel` in the automations page. Its optional `mint` prop sets the initial mint field.
- In Next's `instrumentation.ts`, dynamically import `@/lib/server/backgroundJobs/service` and call `startBackgroundJobWorker()` when `process.env.NEXT_RUNTIME === 'nodejs'`.
- Add `BACKGROUND_JOBS_STORAGE_DIR` to the storage directories prepared by `docker-entrypoint.mjs`, using the same direct-volume-child and no-symlink safeguards as the private X directory. Do not use the asset directory or expose this directory as static files.
- Keep the deployment on Node 22.14+ and a single persistent-volume service. The built-in `node:sqlite` module currently emits Node's experimental-module warning. SQLite WAL needs a local persistent filesystem; it is not a distributed database or a supported network filesystem deployment.

Required server configuration:

```dotenv
BACKGROUND_JOBS_STORAGE_DIR=/data/background-jobs
RAILWAY_VOLUME_MOUNT_PATH=/data
RPC_URL=<private server-side Solana RPC URL>
```

The directory must be absolute. In production it must be a direct child of the mounted volume, and it cannot equal, contain or sit inside `ASSET_STORAGE_DIR` or `X_STORAGE_DIR`. The store rejects a symlink directory or database file. The directory is created with mode `0700` and the database with `0600`. The worker safely stays disabled if required configuration is absent; the private readiness endpoint explains this state without returning configuration values. Unwritable storage is reported as unavailable.

Do not set an RPC key in a public/browser environment variable. No production configuration or live funds are changed by this implementation.

## Private API and ownership

All routes use the application's existing access gate and reject cross-origin requests. The shared invite password is **not** treated as a user identity. Every job additionally needs an independently generated random 256-bit read-only capability in the `x-launchpier-job-key` request header. Only its SHA-256 hash is persisted. A wrong or missing capability returns the same not-found response. There is no global listing endpoint.

- `GET /api/background-jobs`: service readiness and truthful feature limits only; never other users' jobs.
- `POST /api/background-jobs`: accepts exactly `{version: 1, kind: "token-history", mint, maxTransactions, idempotencyKey}`. The mint must be a canonical Solana address; the transaction limit must be an integer from 25 to 500. Unknown fields, including private-key or signing fields, are rejected. The body is bounded to 2 KiB with a five-second read window.
- `GET /api/background-jobs/:id?offset=0&limit=25`: summary plus up to 25 stored receipts, only with the matching capability.
- `DELETE /api/background-jobs/:id`: idempotent cancellation, only with the matching capability. Completed receipts remain readable until expiration.

Browser-generated access is stored before request creation. The job ID is deterministically derived from the capability and request identifier. Retrying the exact same request returns the original job; changing approved input while reusing that request identifier is rejected. Clearing browser site data removes access to saved results. The capability grants no access to wallets and cannot sign anything, but should still be kept private and excluded from logs, URLs and analytics.

## Execution and recovery guarantees

The store uses SQLite `BEGIN IMMEDIATE` transactions, WAL journaling and `synchronous=FULL`. Each running lease has a fresh random fencing token and a 30-second expiry. Every checkpoint verifies both the state and the live lease. Cancellation invalidates the lease immediately; a completed in-flight RPC read cannot commit after cancellation. Requests are never signed or submitted.

The worker persists each signature page **before** reading its receipts. Receipt writes and cursor advancement are atomic and deduplicated by `(job ID, signature)`. After a crash, an RPC read may be repeated, but a completed receipt cannot be counted twice. Expired leases can be recovered by another worker. RPC failures retry up to five times with bounded backoff. A one-hour job window prevents indefinite work.

Bounds:

- At most 500 scanned transactions per job, 25 signatures per page.
- At most 10 active jobs and 100 retained jobs for this application instance/database.
- At most 600 RPC reads per ten-minute database-backed budget, shared across workers using that database.
- Four-second timeout and 1 MiB response limit on each RPC read; redirects are rejected.
- At most 16 decoded trade events and 32 balance-change observations per stored receipt; larger evidence is classified unsupported.
- Seven-day result access. Expired terminal jobs are garbage-collected when another job is created. Physical backup deletion and volume retention remain the deployment owner's responsibility.

The interval is process-local and unreferenced; it does not keep a stopped server alive. Recovery after restart depends on the Node instrumentation startup hook and the same persistent volume. An API creation request also starts the worker. There is no public worker-tick endpoint. No system can continue executing while its hosting service is stopped; queued work resumes when the service returns, subject to the one-hour job window.

## Honest history coverage

The index reads signatures referencing the **mint address**. It is not an exhaustive scan of all token accounts, transfers, holders, venues or wallets. Reading an empty RPC page sets `rpcAddressExhausted: true`; reaching the requested cap does not. Neither condition proves complete token history. `fullTokenHistory` is always `false`.

Stored receipts distinguish confirmed decoded evidence, on-chain failures, missing RPC receipts, unsupported formats and invalid evidence. Official Pump event decoding and confirmed balance observations reuse the existing verified parsers. Unreadable data is not silently represented as a successful trade. A decoded receipt with zero trade events does not establish complete balance coverage. No acquisition basis or complete profit and loss is inferred from this sampled history.

## Dedicated automation is separate

This history service is read-only and never imports or signs with wallet keys. Browser sessions still require an open tab. The separately implemented [dedicated automation service](AUTOMATION-WALLETS.md) uses its own server-generated wallet, encrypted storage, private recovery capability and exact approved spending policy. Read-only history capabilities grant no wallet authority.

Public history creation is persistently limited to three new jobs per client per ten minutes and ten jobs per server per hour. Idempotent retries consume no additional allocation. Up to 100 actual retained receipts remain available for seven days; empty cancelled jobs have a ten-minute recovery grace period in a separate bounded pool, with at most 200 rows overall. This prevents empty cancellations from locking the retained receipt pool. RPC reads keep their separate persistent budget.

## Verification

Focused tests cover persisted restarts, original signature recovery, idempotency, competing/stale leases, cancellation during a request, owner capability isolation, request/response bounds, private storage isolation, fixed read-only RPC methods and coverage labels. Run:

```text
node node_modules/vitest/vitest.mjs run tests/background-jobs-store.test.ts tests/background-jobs-worker.test.ts tests/background-jobs-api.test.ts tests/background-jobs-rpc.test.ts --maxWorkers=1
```

These tests use temporary databases and mocked RPC responses. They do not submit mainnet transactions, upload existing wallet keys or prove uninterrupted production availability.
