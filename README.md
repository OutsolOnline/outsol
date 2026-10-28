# OutSol

A focused Pump.fun workspace for Solana: token design, native creation, an optional first buy, wallet bundles, encrypted local wallets and transaction recovery.

[Open OutSol](https://outsol.online)

**OutSol’s platform fee is zero, forever.** OutSol takes no launch fee, trading cut, referral payment, or subscription. Solana transaction fees, account rent, venue/creator fees, escrow charges, and optional validator tips remain separate costs. The launch configuration exposes `PLATFORM_FEE_BPS = 0`; it does not redirect protocol fees to an OutSol receiver.

## What is supported

- An animated product homepage, grouped tools menu and a separate Launches workspace with the approved OutSol identity.
- Block-0, Organic and Manual wallet buys inside launch preparation, with reviewed budgets and exact native transaction plans.
- Optional **Send bought tokens to** destinations for additional Block-0 buyers. Each configured buyer transfers its exact purchase output in the same transaction; the review includes recipient-account rent and full receiving addresses. Switching away from Block-0 clears these destinations.
- Private hosted access through a shared-password sign-in, with expiring server-verified sessions protecting pages and private APIs. Public token metadata stays readable; see [private deployment access](DEPLOYMENT.md#private-access).
- Verified creator fee destinations: deployer, another Solana wallet, GitHub individual or holder rewards. See [creator fee routing](docs/CREATOR-FEE-ROUTING.md).
- Public X post imports and reviewed launch announcements. Optional account connection requires the owner setup in [X connection](docs/X-CONNECTION.md).
- Complete local Pump.fun rehearsal with disposable fake-SOL wallets, actual program execution and a downloadable post-state report.
- Persistent per-token workspaces, chain-read verification pages, private local notes and saved public history.
- Reviewed SOL distribution, named recipient groups, SPL/Token-2022 transfers and eligible empty-account cleanup.
- Public design autosave and refresh recovery, preserving the existing browser storage formats and encryption.


- One responsive workspace with sidebar navigation, keyboard tool search, venue shortcuts and a searchable public activity feed.
- Public launch designs with import/export and duplicate/resume. Local artwork references restore images on the same device; JSON exports contain no images or keys. Design before connecting a signing wallet.
- A live token preview, local artwork studio with square cropping and PNG export, and a searchable reusable image library.
- A read-only wallet inspector for exact SOL/token balances, empty accounts and conservative potential account rent.

- Native Pump.fun creation and optional initial buys through the official Pump SDK.
- Pump-only new-launch navigation and validation, with reusable first-buy and manual-buy amount presets.
- Browser vanity mint generation with prefix, suffix, or substring matching and real parallel Web Workers. Unsupported browsers visibly fall back to one cooperative task; search time is probabilistic.
- Phantom/Solflare connection or a passphrase-encrypted local burner wallet, with explicit legacy-wallet migration and private backup export.
- A Pump-focused wallet bundler with bounded atomic submissions or sequential buys, browser-only timed actions, cancellation, and signature reconciliation.
- Manual native Pump buy/sell management with exact spend limits, balances, simulation, public receipts and safe expiry recovery.

A prepared launch must pass validation, packet-size checks, same-bank cost review and simulation before signing. Creation with long metadata and an initial buy can require an explicitly reviewed create/buy/validator-tip bundle. There is no sequential fallback. See [architecture and execution gates](docs/ARCHITECTURE.md) and the [actual local execution checks](docs/TESTING.md).

New launches use Pump.fun only. Historical non-Pump receipts and pending recovery remain readable; their low-level builders are retained for compatibility and tests, without new-launch UI routes. Bags splitting, wash-volume tools, stealth guarantees and guaranteed trading profits are not supported.

## Run locally

Use **Node.js 22.14 or later within the 22.x series** and npm. The app currently uses Next.js 16.4.3, React 19.3.1, and TypeScript.

```sh
git clone https://github.com/OutsolOnline/outsol.git
cd outsol
npm ci
cp .env.example .env.local
npm run dev
```

The organization repository is public. Set `RPC_URL` in `.env.local` to a Solana mainnet RPC endpoint. It is a server secret; never rename it to `NEXT_PUBLIC_RPC_URL`. Development can use the rate-limited public endpoint when `RPC_URL` is absent. Production RPC requests fail closed until it is configured.

Open [localhost:3000](http://localhost:3000). For local launch previews, supply an existing public metadata JSON URI or configure a supported upload provider. The volume uploader requires a trusted public HTTPS origin and persistent storage; its deployed setup is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Check a change

```sh
npx next typegen --webpack
npm run typecheck
npm run lint
npm run test:run
npm run build
npm audit --omit=dev
```

Run these checks locally after a clean `npm ci`, using Node 22 and no provider secrets, before pushing a release. GitHub Actions is not used. Railway watches the organization repository's `main` branch directly and repeats type generation, type checking, lint, regression tests, dependency audit and production build inside its Docker builder before checking application health. A failed gate stops that deployment; test files are not copied into the runtime image. Opt-in mainnet preparation/simulation tests are separate from the default suite and never submit spending transactions. Passing unit tests or a build is not evidence of a successful funded mainnet launch.

The local `vendor/bigint-buffer` dependency replaces the upstream native binding with four bounded unsigned JavaScript conversions. Keep the checked-in overrides and lockfile together; [security notes](docs/SECURITY.md) explain the compatibility boundary.

## Operation and recovery

Review the prepared allocations, public metadata, and total outflow before signing. A transaction signature or Jito bundle ID means submission, not confirmed execution. Unknown submissions retain their original public signatures for reconciliation; recovery checks do not resend a launch.

Wallet keys, generated mint keys, and private exports stay local. Token metadata and signed transactions are intentionally public. Browser timers require the page to stay open: cancelling pending actions or leaving the bundler prevents future broadcasts and does not undo earlier submissions. Export wallet backups before depositing funds or clearing browser storage.

Use [DEPLOYMENT.md](DEPLOYMENT.md) for the private GitHub → Railway route, persistent metadata hosting, and release checks. The historical Supabase credential incident requires explicit retirement of the old backend keys; current source no longer uses Supabase.

## License

No application `LICENSE` file is currently included. Third-party dependencies retain their own licenses. The zero-platform-fee pledge above describes OutSol’s product policy and does not replace a source license.
