# Deployment

The deployment target is the public [OutsolOnline/outsol repository](https://github.com/OutsolOnline/outsol) and Railway project `3d247cf8-7fd1-47e9-b689-31f5f4f9eb70`. The public domain is [OutSol](https://outsol.online). Source is published from a clean history so retired credentials from the legacy checkout are excluded.

GitHub Actions is not required or configured. Railway watches `main` through its GitHub integration and builds a pushed commit directly from the repository. Run release checks locally before the push; Railway's Docker builder repeats type generation, type checking, lint, regression tests, dependency audit and production build, then checks application health before the deployment becomes available.

Infrastructure is managed by `.railway/railway.ts` using Railway IaC. Its environment values use `preserve()` so secret values stay in Railway. Preview changes with `railway config plan` before applying them; do not apply a plan that removes the RPC configuration or metadata volume. The deprecated `railway.json` format is not used.

## Prepare the source

The original Git history contains a legacy Supabase service-role credential. **Do not push that history.** Publish a clean root/orphan history containing only the reviewed current source and lockfile, while retaining the original checkout and baseline locally for recovery. Exclude `.env.local`, private wallet/mint exports, build output, and temporary work files. Never print the old credential or copy it into a workflow.

Current source no longer connects to Supabase. The original project failed DNS resolution during a read-only check; this does not prove that the credential was revoked. The owner should retire legacy keys in the original project’s Dashboard → Settings → API Keys, migrating any other consumers first, and run `supabase-schema.sql` there if the project is available or restored. The SQL preserves rows, removes public policies/privileges, and disables public execution of an old `exec_sql` helper. See [security notes](docs/SECURITY.md) and [Supabase’s retirement procedure](https://supabase.com/docs/guides/getting-started/api-keys#rotate-a-leaked-or-compromised-key).

## Configure Railway

1. Create/connect a service from the organization GitHub repository and select its reviewed `main` branch. Grant the Railway GitHub integration access to that repository. Keep the Docker start command unset: the checked-in image supplies its own bootstrap.
2. Attach a persistent volume at `/data`. Set `ASSET_STORAGE_DIR=/data/vanity-assets` and `ASSET_STORAGE_QUOTA_MB=512`. Use a single service instance with this volume. The startup helper prepares only that direct child directory, rejects symbolic links/outside paths, and drops to uid/gid 1001 before starting Next.js. It never recursively changes volume contents.
3. Generate the public HTTPS domain, then set `APP_ORIGIN` and `PUBLIC_APP_URL` to that exact origin without a trailing slash. `APP_ORIGIN` protects same-origin API requests; `PUBLIC_APP_URL` is the trusted base of permanently published metadata links. Neither value comes from a client-supplied Host header.
4. Store `RPC_URL` as a server-only Railway variable for Solana mainnet. Choose a provider supporting the reads and simulations used by the selected launch mode. Multi-transaction plans require `simulateBundle`; unsupported simulation stops submission. Do not create a public RPC credential variable.
5. Push the locally verified commit to `main`. Railway's connected source deploys it using Node 22 and the Dockerfile, runs the standalone server on `0.0.0.0:$PORT`, and checks `/api/health`. This endpoint checks process availability, not external protocol health or funded transaction success.

No secret is needed for `npm run build`; provider settings are runtime configuration. The `.env.example` lists the supported variable names. The Docker dependency stage includes `vendor/` so `npm ci` can resolve the local BigInt replacement.

## Private access

The deployed application requires a shared password. Configure `APP_ACCESS_PASSWORD_HASH` and an independent `APP_ACCESS_SESSION_SECRET` as server-only runtime variables before releasing this version. The password hash uses `scrypt$32768$8$1$<salt>$<hash>` with a random 16-byte salt and 32-byte derived key, both base64url encoded. The session secret is 32 independently generated random bytes encoded as base64url. Keep the password in a password manager; never commit the password or either runtime variable. Railway IaC preserves both variables.

Visitors sign in at `/access`. Successful sign-in creates a host-only HttpOnly Secure production cookie with an eight-hour lifetime and SameSite=Lax. Rotating either access variable invalidates existing sessions. Sign out from `/access` to clear the current browser session. Missing or malformed production configuration denies access instead of exposing the application. Local development/test bypasses access only when neither access variable is configured.

Both pages and private API handlers enforce access, including RPC, uploads, rehearsal and X account operations. Only the process health check and exact immutable public metadata/image GET/HEAD routes stay public; static build assets needed for rendering contain no credentials. Login/logout require a configured trusted Origin and login attempts are bounded and rate-limited. Limits are per process and assume the existing single-instance deployment. The public repository remains public: the password restricts this hosted instance, not copies of its source.

Before release, verify anonymous pages redirect to `/access`, private APIs reject requests without a valid session, a valid login opens the app, logout clears the browser cookie, and public health/metadata still work. Repeat checks on the custom domain and the Railway service domain. Do not submit transactions as an access-control test.

## Keep public metadata available

The default upload path needs only the configured RPC and Railway volume: validated image bytes and public JSON are stored under SHA-256 filenames and served from `/api/assets/[file]` with immutable cache headers. Uploads accept PNG, JPEG, WebP or GIF up to 5 MB; SVG, mismatched basic file signatures, duplicate fields and oversized text are rejected.

The default quota is 512 MB, with a 10,000-file cap; the configurable byte quota permits up to 8192 MB. Full disks or unavailable storage reject new uploads while retaining existing files. Configure volume backups, monitor usage, and keep the metadata domain and service available for existing tokens. Moving or deleting that volume or domain breaks token metadata links; hosting on a volume is not decentralized IPFS persistence.

For optional decentralized uploads, configure server-only `PINATA_JWT` with public-upload permissions. Pinata takes precedence. An explicit HTTPS `IPFS_API_URL` can instead provide a compatible upload backend. Otherwise the app accepts an existing public metadata URI. Public images and token JSON intentionally leave the browser; third-party storage services may charge their account owner. Vanity adds no charge.

## Release checks

Run the local release gates: clean `npm ci`, `npx next typegen --webpack`, typecheck, lint, tests, production build, and `npm audit --omit=dev`. Railway's Docker builder repeats those gates automatically, without an Actions workflow. It receives the regression tests but no excluded environment files, private exports or scratch data; the runtime stage copies only the standalone app and public assets. Investigate failures instead of suppressing them. A zero-vulnerability audit is a registry snapshot, not a permanent security guarantee. SDK/override changes require instruction and integer-encoding regression tests.

Before advertising a launch route, test its deployed flow with a disposable wallet: wallet create/import/export, encrypt/lock/unlock, legacy migration, vanity generation, synthetic public metadata upload/retrieval, balances, fresh cost review and complete simulation. Check that browser calls use `/api/rpc` without provider credentials or private keys. Verify origin rejection, upload limits, missing-provider failure, submission cancellation and signature recovery.

Lock mode additionally requires a single final mint + allocation + pool + escrow transaction within Solana’s packet limit. If an address lookup table is needed, its separate setup must be disclosed, confirmed, verified and warmed before the final launch is rebuilt. A planner or simulation failure must not fall back to an unlocked sequential launch. Treat the route as gated until its tests and deployed preparation satisfy this condition.

Submit only after the user reviews the concrete transactions and their costs. Confirm signatures and expected on-chain accounts before reporting success. A lost response retains the original signatures; reconcile them before retrying. The default regression suite and opt-in read-only simulation checks do not create tokens or spend SOL.

## Runtime limits

RPC/upload quotas are per process; add shared edge limits if the deployment topology changes. The RPC proxy is HTTP only; confirmations use polling. Acknowledged Jito bundles still require signature confirmation, and their acknowledgement does not guarantee execution. No blanket protection against uncled-block rebroadcast is claimed for multi-transaction submissions.

Timed bundler actions are browser tasks. Cancelling, navigating away, closing the page or losing connectivity can stop future work; cancellation does not reverse transactions already attempted. Public receipts persist locally for recovery. The encrypted wallet locks after inactivity/reload, and unlocked memory remains accessible to a compromised browser. Keep offline private backups and only the funds intended for the session.
