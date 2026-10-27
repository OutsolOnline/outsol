# Security notes

## Keys and wallet recovery

The local wallet vault uses PBKDF2-SHA-256 with 600,000 iterations, a random 16-byte salt, AES-256-GCM and a random 12-byte IV. The wallet address is authenticated with the ciphertext. A passphrase is never persisted by the application. Unlocking restores the secret only to browser memory; reload/inactivity locks it. A lock during an in-flight unlock prevents that operation from restoring the secret afterward.

A legacy plaintext browser wallet is retained until encryption succeeds and the saved ciphertext is verified. Signing is disabled during that migration. Export its private backup before clearing browser data. A forgotten passphrase cannot be reset; an offline keypair backup can restore the wallet. Private exports contain spending authority and must never be committed or uploaded as token metadata.

Bundler keys and generated mint/temporary keys are memory-only. Export generated wallets before funding them. Public receipt persistence deliberately excludes keys, signers and complete application state. Clearing browser storage removes local backups and recovery records; it does not remove tokens or transactions from Solana.

Encryption protects a locked stored wallet, not an already compromised browser or malicious extension while the wallet is unlocked. Use a dedicated burner wallet, review the signed message and displayed outflow, and retain offline backups.

## Historical Supabase credential

The original repository committed a legacy service-role credential and included public database policies plus reversible wallet-secret obfuscation. Current source removes that credential, disables cloud wallet storage and retires public database setup. The old credential must not appear in the new repository history, CI, logs or browser bundles.

The original project’s DNS endpoint was unavailable during a read-only check. That establishes neither revocation nor the absence of historical access. No wallet rows were retrieved to test it. Before restoring/reusing that backend, its owner should:

1. Identify any remaining consumers of legacy Supabase keys. Vanity’s current app needs no Supabase replacement key.
2. Migrate those other consumers to appropriate new publishable/server-secret keys, verify them, then deactivate the legacy keys in Dashboard → Settings → API Keys. Creating a new key alone leaves legacy JWT keys valid.
3. Run the checked-in `supabase-schema.sql` against the original project. It preserves data while revoking public table access and old raw-SQL helper execution.
4. Preserve controlled recovery backups and review historical access. Treat private keys previously stored with the old obfuscation as potentially exposed.

These are owner actions against the original project, not effects of deploying new source. Follow [Supabase’s current key-retirement guidance](https://supabase.com/docs/guides/getting-started/api-keys#rotate-a-leaked-or-compromised-key).

## Dependency boundary

`vendor/bigint-buffer` is an explicit local replacement for the upstream native converter. It has no native binding or install hook and implements only `toBigIntLE`, `toBigIntBE`, `toBufferLE` and `toBufferBE`. Valid unsigned values retain their byte representation; inputs/outputs are bounded to 1024 bytes. Negative values, overflowing quantities, fractional/negative/excessive widths and non-bigint outputs are rejected rather than silently truncated. Empty buffers represent zero.

The root `bigint-buffer` file dependency and `$bigint-buffer` override keep transitive Solana consumers on that implementation. The vendor directory must be present before `npm ci`, including in Docker. Regression tests cover 64/128-bit endianness, padding, zero, nonmutation and invalid quantities. Preserve the lockfile and validate every override when updating dependencies; a zero-result package audit does not review application behavior.

## External boundaries

Server-only credentials include `RPC_URL` and optional `PINATA_JWT`. Do not put them in `NEXT_PUBLIC_` variables. Logs and upstream errors must not echo those values. Token JSON, images, addresses and signed transactions are intentionally public.

RPC and uploads use same-origin checks, bounded request/response sizes, deadlines and per-process quotas. Raw-SQL administration and remote wallet-secret storage are not application capabilities. Add shared edge limits if changing to multiple instances; a volume-backed service must keep one writer and persistent backups.

The default test suite and CI need no secrets and submit no spending transactions. Optional mainnet tests perform read-only preparation/simulation. A funded launch requires a separate reviewed user action. Cancellation stops future broadcasts, while already attempted signatures remain eligible for confirmation and recovery.
