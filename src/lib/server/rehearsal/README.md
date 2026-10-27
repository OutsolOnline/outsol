# Pump launch rehearsal service

`POST /api/rehearsals` accepts only `name`, `symbol`, `metadataUri`, `initialBuySol`, `priorityFeeSol`, and `jitoTipSol`. SOL amounts are exact decimal strings. It returns HTTP 202 and an opaque job ID; `GET /api/rehearsals/{id}` polls the public result and `DELETE` cancels it. No wallet keys, transaction packets, mint addresses, or RPC endpoints are accepted from a request.

The service generates disposable keys, verifies its loopback Surfpool 1.6.1 instance, copies the current mainnet Rent sysvar, funds fake SOL, calls the existing native Pump builder, prewarms message accounts, verifies signed simulation, and executes a single transaction or an atomic local bundle. It decodes the resulting mint/metadata/curve/token accounts and checks supply, mint/freeze/metadata authorities, purchase tokens, and creator. Costs are measured from actual fake payer before/after balances and confirmed transaction fees. Nothing is sent to a public chain.

Production uses `/usr/local/bin/surfpool`, installed by the Dockerfile from the pinned official Linux x64 release and checked against its published SHA256. The existing entrypoint drops privileges before starting Next; Surfpool inherits the unprivileged identity. The VM listens only on `127.0.0.1:18999` and `19000`; its datasource is the loopback read-only bridge on `18898`. Only the bridge holds `RPC_URL` in memory. It canonicalizes the parsed JSON and allows a fixed set of read methods; transaction submission and airdrops cannot pass upstream. Response bodies are capped while streaming.

The shared per-process queue permits one active and three pending jobs, with a 55-second active deadline including a 20-second startup deadline. It retains at most 50 public job records for ten minutes and limits anonymous submissions per client and globally. A successful job resets the VM; an interrupted or failed owned job destroys it to prevent late execution from affecting the next job. An idle VM stops after one minute. Jobs are ephemeral per application instance; use one Railway replica or route polling to the instance that accepted the job.

The simulator uses live fetched mainnet state rather than a historical snapshot. Before every job, the service validates the source Rent account's owner, exact 17-byte encoding and parameters, copies it into the VM, and verifies minimums for 0-, 8-, and 165-byte accounts against the source. This matters because Surfpool's default rent can differ from current mainnet. No fee-recipient account balances are normalized and no tip budget is increased. Surfpool's bundle sandbox does not fetch absent accounts automatically, so the service hydrates all native message keys before simulating.

The report states that it is a local execution with disposable keys. Developer escrows and creator-owned LP positions are reported as not configured. A rehearsal does not reproduce live Jito auctions, prices, validator inclusion or future fees; a fresh live preview is required before a real signature.

For local Windows development, configure `REHEARSAL_SURFPOOL_BINARY` with the official Windows executable path. A trusted `LOCAL_REHEARSAL_RPC_URL=http://127.0.0.1:18999` may attach a dedicated development VM; it is ignored in production. Port 8899 is deliberately excluded from this attachment path so independent audit forks are not reset.

Validation:

- `npm run test:run` includes DTO, queue, API, read-only method and bounded-stream tests.
- `RUN_REHEARSAL_LOCAL=1` enables `tests/rehearsal-localnet.live.test.ts`; set `RPC_URL` in the process environment and the development binary path. It proves single and atomic creation, actual public POST/poll execution, upstream submission rejection, and cancellation followed by fresh isolated work.

The Linux archive and its digest were verified on the Windows development host; the complete Docker image requires a Linux Docker engine to build. The actual service workflow was executed against the official Windows Surfpool 1.6.1 binary with real copied Pump programs.
