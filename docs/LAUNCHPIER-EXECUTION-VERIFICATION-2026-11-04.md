# LaunchPier execution verification — 4 November 2026

Verified the release working tree on branch `outsol-session-menus`, source baseline `c9b9f2a`, using fresh generated wallets and simulated SOL only. No mainnet transaction, real funding, commit, push or deployment was performed.

## Current result

**28 execution cases passed, zero failures** in the final focused runs:

- **8 sniper / Relay / pair cases:** inline and standalone Block-0, Manual and Organic purchases forward only their newly purchased tokens. Independent pair backup restores local bindings; selected and all receiver sales leave the sources and deployer unchanged. The trading-session route preserves pre-existing source tokens and sells the exact receiver output.
- **5 targeted Block-0 cases:** exact forwarding to a shared receiver, creator and another buyer; an impossible transfer rolls back mint creation; oversized plans stop before creation. Nine unrelated creator-fee variants were intentionally deselected.
- **12 native Pump cases, 17 public evidence records:** maximum metadata with and without first buy and priority fee; exact native buy; 25% / 100% sales; complete five-packet atomic bundles; negative boundaries; original-signature recovery after response loss; cancellation before broadcast; actual atomic rollback; configured atomic, after-confirmation and organic execution.
- **3 dedicated unattended-wallet cases:** the actual service creates a separate wallet, requires its recoverable key backup, reads simulated funding, prepares a native preview and arms its exact reviewed hash. The actual worker executes two scheduled buys, survives SQLite close/reopen, then sells the exact acquired amount after another reopen. A deliberately lost response after an executed buy is reconciled by its original signature after cancellation and restart, with exactly one broadcast. Cancellation during a real signed same-bank preview leaves no durable attempt, submission, token purchase or SOL debit.

The automation fixture created one real native mint and the worker submitted four signed native trades locally. Wallet keys, owner capabilities, database encryption keys and serialized signed packets are absent from public evidence. Temporary encrypted wallet databases were closed and removed after the cases.

The three automation cases were rerun successfully at **12:44 UTC** against the final direct-buffer signing / zeroization, bounded injected simulation transport, final post-await message / signature check, and worker-startup recovery changes. The aggregate was refreshed at `2026-11-04T12:44:26.532Z`; the earlier 25 transaction-engine results were retained. This rerun exercised the service and worker paths described above; the coordinator owns the separate startup, route and UI checks.

## Isolation and runtime

The already-installed official **Surfpool 1.6.1** executable runs on `http://127.0.0.1:8899`, with a separate upstream bridge on port `18899`. Binary SHA-256: `FA6AD68AC0F01592D5620ED7114C6A2A1596816F80A1239174125DB7F56ACC82`.

The bridge forwards a fixed read-method allowlist only. An independent startup check sent `sendTransaction`, `requestAirdrop`, `sendBundle`, `surfnet_setAccount` and `surfnet_resetNetwork` to it: all five returned HTTP 403 and its forwarded-request counter stayed unchanged. The helper passes the local bridge address to Surfpool rather than its private upstream credential.

Before any test ran, the fresh VM's rent sysvar was aligned once to current confirmed upstream data after checking its owner, canonical 17-byte encoding and rent calculations. Current values were 5,080 lamports per byte-year, exemption threshold 1, burn 50%; the 165-byte minimum became 1,488,440 lamports. No reset or fee-account balance modification occurred. Every test transport separately verifies a ready Surfpool runtime, confines requests to unauthenticated loopback and restricts funded writes to its newly generated test payers. The fork remains running for coordinator UI checks.

## Reproduction and evidence

Start `node work/relay-fork-runtime/start.cjs` only while ports `8899` / `18899` are unused, verify the bridge write denials, and run `node work/relay-fork-runtime/align-rent.cjs` once before anybody uses that fresh VM. Do not reset or realign a shared running VM.

From the release worktree in PowerShell:

```powershell
$env:VANITY_LOCALNET_RPC='http://127.0.0.1:8899'
$env:RUN_BUNDLE_RELAY_LOCALNET='1'
$env:RUN_SNIPER_PAIRS_LOCALNET='1'
$env:RUN_SNIPER_RELAY_LOCALNET='1'
$env:VANITY_BUNDLE_RELAY_PROOF_FILE='work/launchpier-release-bundle-relay-proof-2026-11-04.json'
$env:VANITY_SNIPER_PAIRS_PROOF_FILE='work/launchpier-release-sniper-pairs-proof-2026-11-04.json'
node node_modules/vitest/vitest.mjs run tests/bundle-relay-localnet.live.test.ts tests/sniper-pairs-localnet.live.test.ts tests/sniper-relay-localnet.live.test.ts --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=work/launchpier-release-sniper-relay-2026-11-04.json

$env:RUN_LAUNCH_BUNDLE_LOCALNET='1'
$env:VANITY_LAUNCH_BUNDLE_EVIDENCE_FILE='work/launchpier-release-block0-proof-2026-11-04.json'
node node_modules/vitest/vitest.mjs run tests/launch-bundle-localnet.live.test.ts --testNamePattern='atomically transfers|rolls back creation|refuses three' --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=work/launchpier-release-block0-2026-11-04.json

$env:VANITY_E2E_OUTPUT_DIR='work/launchpier-release-pump-e2e-2026-11-04'
node scripts/verify-pump-e2e.mjs local

$env:RUN_AUTOMATION_WALLETS_LOCALNET='1'
$env:VANITY_AUTOMATION_EVIDENCE_FILE='work/launchpier-release-automation-wallets-2026-11-04.ndjson'
node node_modules/vitest/vitest.mjs run tests/automation-wallets-localnet.live.test.ts --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=work/launchpier-release-automation-wallets-2026-11-04.json

node node_modules/eslint/bin/eslint.js tests/automation-wallets-localnet.live.test.ts
```

Public aggregate: `work/launchpier-execution-proof-2026-11-04.json`. It references current JSON test reports, native `result.json` / `checks.ndjson` / `run.log`, receiver-sale `work/relay-session-proof.json`, bridge-denial proof and rent-alignment proof. These contain public addresses, signatures, exact raw amounts, balances, timing and results only.

## Limits

This proves signed application transaction paths and the dedicated wallet service / worker against actual programs on an isolated local mainnet fork. The automation cases invoke worker ticks with a controlled schedule clock and close/reopen the durable store; they do not prove deployed process uptime, real-time timer delivery, HTTP access controls, hosting persistence or operation after an actual hosted process crash. They do not prove external Jito acceptance, mainnet landing, first-block placement, profitability or hosted-provider availability. Coordinator owns browser UI, full-suite, build and release checks.
