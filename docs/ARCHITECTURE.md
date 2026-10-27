# Architecture and execution gates

Vanity is a Next.js App Router application. Browser components hold transient launch plans and signing keys; server routes provide a bounded RPC proxy and public metadata storage. The server never signs transactions or stores wallet secrets.

## Launch routes

New creation uses Pump.fun through its official SDK. Product navigation, query seeding and the final creation boundary allow only this route. Existing non-Pump receipts and pending operations retain their original meaning; archived low-level builders are kept for compatibility and independent tests.

Pump creation uses one packet when it fits. Maximum-length metadata combined with a first buy can instead use an explicit native create/buy/tip bundle. The total priority budget is divided without increasing it; the validator tip uses the reviewed budget and a canonical recipient with verified ownership, discriminator and rent eligibility. Every packet is simulated in order against one bank before signing and again with signatures before bundle submission. Cost review reads the payer before the first and after the last packet in that same bank.

Both direct liquidity modes create a fixed-supply SPL mint with immutable Metaplex metadata and a Raydium CPMM pool in one final transaction. The selected token percentage and SOL seed the pool; the remaining allocation belongs to the creator. Lock mode places the net developer allocation into a noncancelable Streamflow escrow at the selected time. Escrow token charges reduce the net developer allocation and are shown separately. Mint and freeze authorities are revoked by the direct builder. LP tokens remain in the creator wallet: a developer-token lock does not lock the LP position. The internal multi-packet builder retains Token-2022 support, but the direct launch UI requires the single-transaction route.

The application fee constant is zero. Native builders do not add a Vanity referral account or receiver. External venue/creator/protocol fees, network fees, account rent, escrow charges and optional Jito tips remain payable and appear in preparation summaries.

## Prepare, review, sign, reconcile

1. Validate metadata, SOL amounts, supply/allocation bounds, wallet identities and selected venue. Private keys are never sent to a remote transaction-building API.
2. Read canonical program/configuration accounts, current balances, rents, fees, blockhash and chain time as needed. Build versioned transactions with pinned SDKs and reject oversized packets.
3. Simulate the complete proposed execution. Independent transaction simulation is insufficient when later packets depend on accounts created by earlier packets; multi-packet routes require a provider supporting sequential `simulateBundle`.
4. Present public metadata, allocations and total outflow for explicit review. Wallet-returned messages must match the reviewed messages. Restore only the required local signatures, verify required signatures are present, and reject an expired preview.
5. Save public recovery fields before the broadcast boundary. Submit once; never treat a signature or bundle acknowledgement as a confirmation. Reconcile the original signatures and expected accounts before success or retry.

Both direct liquidity modes have an additional release gate: **all launch effects must be in one final transaction**. A missing address lookup table can require a separately disclosed setup transaction with its own public pending/recovery record. Setup confirmation does not mean a token was launched. The lookup table must be confirmed, checked and active before the final single transaction is rebuilt and simulated. Oversized or unverifiable plans fail closed. No sequential fallback may create an unlocked intermediate developer allocation.

Other multi-packet routes use bounded Jito bundles with a real disclosed tip and signed simulation before submission. The application verifies every signature after acknowledgement. This coordination is not a guarantee that packets cannot be rebroadcast after an uncled block; do not infer that guarantee from a bundle ID.

## Persistence and cancellation

The wallet vault persists authenticated ciphertext only. Unlocked keys, imported bundler keys, mint keys, generated temporary signers and prepared plans stay in browser memory. Root launch records select only public mode/venue, addresses, signatures, payer/blockhash and timestamps; bundler persistence also selects public receipt fields. No plan or signer object belongs in local/session storage.

Root signing and recovery coordinate through a shared browser Web Lock. Compare-and-clear recovery removes only the matching pending record, preserving a newer launch from another tab. Storage failure before submission stops the launch; storage failure after confirmation does not change chain truth.

Submission helpers accept an optional AbortSignal. They check after prerequisite build/simulation work and immediately before broadcasting. A cancelled unsent transaction is reported as unsent; once a broadcast was attempted, its signature remains available and confirmation may be unknown. Cancelling future buys/sells cannot undo earlier actions. Browser timers are not durable jobs.

## Server boundaries

`/api/rpc` accepts allowlisted Solana reads, bounded simulation and already-signed transaction submission. It enforces origin checks, byte limits, per-process quotas and upstream deadlines; provider errors are sanitized. Credentials come from server-only `RPC_URL`. `/api/health` is a lightweight process check.

`/api/ipfs` validates raster images and public text fields, then chooses Pinata, an explicit compatible upload backend, or the configured local public-asset store. The local store uses SHA-256 names, immutable writes, integrity checks, quotas and a single mounted directory. `/api/assets/[file]` rejects noncanonical names and traversal. Its links use trusted `PUBLIC_APP_URL`.

The legacy Supabase modules remain only as compatibility/public-receipt helpers; cloud wallet storage is disabled and the old DB setup route returns 410. Operational retirement of the old credentials remains separate from source cleanup.
