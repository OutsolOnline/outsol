# Pump.fun verification

Run the release checks locally from the repository root with Node.js 22:

```powershell
npm ci --no-audit --no-fund
npx next typegen --webpack
npm run typecheck
npm run lint
npm run test:run
npm audit --omit=dev --audit-level=low
npm run build
```

These checks do not depend on GitHub Actions. After they pass locally, pushing the reviewed commit to the private repository's `main` branch triggers Railway's connected-source Docker build. Its builder repeats these gates automatically and then runs the application's health check; a failed gate stops the new deployment. Railway caps the regression run at two workers to bound build memory. Type generation prepares Next's ignored declarations for a clean checkout. The default regression run does not require RPC secrets, wallet exports or the excluded execution scripts, and network/local-VM suites remain opt-in. Tests are included only in the build stage, not copied into the final runtime image.

The Pump launch checks below use actual program execution. The default suite keeps network and local execution opt-in.

## Signed local execution

Start a mainnet-backed Surfpool instance on loopback, then run:

```powershell
node scripts/verify-pump-e2e.mjs local
```

The default execution RPC is `http://127.0.0.1:8899`. Set `VANITY_LOCALNET_RPC` to another loopback HTTP endpoint when needed. The harness verifies `getVersion` has `surfnet-version`, verifies Surfnet startup is ready, and calls a Surfnet-only method before funding or spending. A mainnet genesis hash is deliberately insufficient: a fork returns mainnet genesis too.

Each payer is generated in memory for the test and funded with fake local SOL. The transport checks every wallet-funded send against this set of newly generated payers. No wallet file or user key is read. The test runtime used for the recorded run was Surfpool 1.6.1, backed by a loopback read-only upstream bridge which physically rejects upstream broadcasts and airdrops.

The twelve cases cover:

- Exact maximum metadata: 32 UTF-8 bytes for the name, 10 for the symbol, and 200 for the URI. Creation runs with/without an initial buy and with zero/nonzero priority fee.
- Confirmed supply, mint/freeze authorities, immutable metadata, curve creator, and exact initial-buy balance.
- Actual three-packet atomic create/buy/tip execution when the combined packet is too large.
- Actual five-packet bundles with three distinct buyers for compact metadata, or two distinct buyers when maximum metadata requires two launch packets.
- The production configured bundler in atomic, after-confirmation, and organic timing modes, including delayed buys and browser-timed creator/wallet sells.
- Manual buy, 25% sell, and 100% sell through the production preview and send functions.
- The reviewed message remaining unchanged after signing, and a same-bank payer-cost preview matching the confirmed local debit.
- Recovery of the original confirmed signature after the send response is deliberately lost, without a duplicate send; cancellation before broadcast.
- An actual failed local atomic bundle rolling back a Pump mint creation and preserving the payer balance.
- Invalid UTF-8 metadata lengths, blank names, negative buys, and one-lamport buys.

## Unsigned mainnet bank simulation

```powershell
node scripts/verify-pump-e2e.mjs mainnet-readonly
```

This reads `RPC_URL` from the process or `.env.local` in memory. The provider must support complete-bank `simulateBundle`, including account inspection. An explicitly requested run fails when support is missing; it never reports an unsupported provider as a passed or skipped check.

The two cases simulate maximum-metadata Pump creation with zero and 0.1 SOL initial buy. They check supply, authorities, curve state, exact purchased tokens, packet sizes, and the mint remaining absent from the actual chain. The payer is a public address; its wallet signature remains empty. The transport rejects every broadcast method.

To run the same real-mainnet simulation through the application's RPC boundary:

```powershell
$env:VANITY_TEST_RPC_URL = 'http://localhost:3091/api/rpc'
$env:VANITY_TEST_RPC_ORIGIN = 'http://localhost:3091'
node scripts/verify-pump-e2e.mjs mainnet-readonly
```

Use the actual development port or deployment origin. Account inspection repeats complete bundle simulations in two-account windows, matching the proxy's request bounds. The entire dependent bundle executes in one bank on every inspection request.

## Evidence and limits

The inline launch engine's opt-in `tests/launch-bundle-localnet.live.test.ts` also covers Block-0 buy-and-transfer to a shared destination, the creator and another buyer. It verifies exact recipient balances, preservation of tokens received by a later buyer, actual per-wallet SOL costs and original public receipts. A deliberately failing transfer in the guarded loopback test checks whole-bundle rollback. These cases use freshly generated fake-funded wallets and require the same identity-verified Surfpool 1.6.1 runtime; their presence in the default suite does not mean they executed.

With that runtime ready, run the transfer cases explicitly:

```powershell
$env:RUN_LAUNCH_BUNDLE_LOCALNET = '1'
npx vitest run tests/launch-bundle-localnet.live.test.ts -t 'transfers exact Block-0|actual local buyer transfer' --maxWorkers=1
```

The normal offline tests cover composed instruction validation, amount/destination tampering, shared-account token simulation, rent requirements, preview invalidation, public persistence and unknown-submission recovery without RPC credentials or wallet files.

Each `verify-pump-e2e.mjs` command creates `work/pump-e2e-<mode>-<timestamp>/` with:

- `result.json`: outcome, counts, proof type, limitations, and named checks.
- `checks.ndjson`: individual successful checks with public local signatures where applicable.
- `vitest.json`: the test runner's full machine-readable result.
- `run.log`: sanitized runner output.

Use `VANITY_E2E_OUTPUT_DIR` to choose a different evidence directory. Provider endpoints are suppressed from saved output. No private key is included in evidence.

Surfpool 1.6.1's `simulateBundle` clones its current bank without lazy account hydration, whereas its `sendBundle` path prefetches accounts. The local harness first reads external fee destinations and all bundle account keys through local RPC. This loads unmodified public account state; the harness does not patch balances or disable rent checks. The production verified tip builder checks canonical Jito ownership/data and the active connection's rent requirement, then selects a recipient that can receive the approved tip without increasing it.

Signed local execution proves the copied programs, signing, state transitions, dependency handling, and local atomic rollback. It does not prove external Jito relay acceptance, mainnet auction/leader conditions, or funded mainnet landing. Unsigned mainnet simulation proves execution against the provider's bank; it does not prove wallet signing or funded landing. The checks upload no artwork and use an existing public-format metadata URI; artwork storage/upload has separate tests.

References: [Surfpool 1.6.1 bundle implementation](https://github.com/solana-foundation/surfpool/blob/v1.6.1/crates/core/src/rpc/jito.rs), [Jito tip payment account source](https://github.com/jito-foundation/jito-programs/blob/master/mev-programs/programs/tip-payment/src/lib.rs).
