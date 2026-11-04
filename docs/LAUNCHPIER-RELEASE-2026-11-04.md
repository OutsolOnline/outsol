# LaunchPier public release · 4 November 2026

The owner approved the LaunchPier name, geometric identity, ink/cobalt palette, public website with no shared password, organization GitHub publication and Railway deployment.

## Delivered

- App and landing identity, SVG/PNG/icon variants, generated brand banner and an updated browser extension targeting launchpier.net.
- Simpler bundle launch with Wallets → Token → Execution → Review, a desktop review rail, mobile stacking, plain-language guidance and mounted advanced disclosures.
- Sniper session generation/reuse, safe remove/new lifecycle, fixed receiver controls and preserved encrypted wallets, drafts, legacy identifiers and original transaction recovery.
- Dedicated encrypted server-generated wallets for explicitly approved bounded native Pump.fun DCA; private owner capabilities, independent backups, spending/reserve limits, expiry, cancellation and durable original-signature recovery.
- Durable bounded history indexing with private access, persistent creation/RPC budgets and honest coverage.
- Reviewed SplitNOW manual-deposit connector, encrypted order recovery and one-time provider submission. Live funding still requires operator API credentials; Husher requires partner authorization.
- Public access is explicit through `APP_ACCESS_MODE=public`. Local vault encryption, dedicated-wallet/funding/history capabilities and X account sessions remain independent. Unknown mode values fail closed. Old `/access` bookmarks redirect to `/`.
- launchpier.net and www.launchpier.net DNS and valid HTTPS; previous OutSol and Railway addresses remain attached. New-domain workspace notices explain origin-local backups/imports.

## Verification

- Full default suite: **1,394 passed**, 102 opt-in tests skipped across 181 files (157 passed, 24 skipped), `--maxWorkers=2`.
- Whole-tree TypeScript and ESLint passed.
- Production build passed from an exact Git-listed source copy outside the active worktree; no private environment files copied.
- Production dependency audit: zero vulnerabilities at verification time; dependency manifest/lock unchanged.
- **28 actual signed execution cases** passed on the isolated official Surfpool mainnet fork with simulated SOL; upstream sends/airdrops were physically denied. The final automation cases were rerun after signer/transport/recovery fixes. See [execution evidence](LAUNCHPIER-EXECUTION-VERIFICATION-2026-11-04.md).
- Final live public browser sweep: **31 routes × 390, 768, 1440 and 1920 pixels = 124 unique checks**, with no document overflow, application error or missing heading. Enter/Escape/focus restoration, retained disclosure values, migration notice and settled service states verified. Earlier local checks covered 12 core routes at all four sizes. Actual desktop/mobile/tablet/wide screenshots are saved under `outputs/launchpier-screenshots`.
- Read-only check of the configured production RPC verified health, mainnet genesis and simulation-method availability without providing or submitting any transaction.
- Independent review found and resolved streaming-response cleanup, actual signer-buffer wiping, bounded simulation transport, final-message validation, worker-start recovery, legacy custom-palette compatibility, and anonymous history/GitHub lookup budget issues.

## Boundaries

No real SOL was spent and no mainnet launch/trade was submitted. Local execution does not prove first-block inclusion, Jito auction success, hosted uptime or profitability. Dedicated trading supports active SOL Pump.fun curves and fixed bounded schedules; the history index is sampled/address-based, not a complete market-wide index. Aged-wallet inventory and proprietary Shield routing are not represented as implemented. X OAuth and third-party funding remain dependent on their documented operator setup.

The temporary build-copy discovery issue was corrected by moving build artifacts outside the application, then rerunning the full default suite successfully. Production public settings preserve the existing RPC, storage and connected-service credentials; new independent encryption keys are held only in Railway configuration.

## Published release

Application revision `cf01f35` is pushed to the public `OutsolOnline/outsol` organization repository and deployed on Railway as `8029cff5-8ea1-4972-8b54-3ff731c9ba54` (SUCCESS). Railway independently repeated type generation, type checking, lint, the 1,394-test default suite, audit and production build. Image digest: `sha256:b915891976ebafe05e47f8cd269379630009c09b92b548a5d48d38587659a411`.

Anonymous HTTPS smoke verification at `2026-11-04T13:40:59.190Z` passed **64 page checks across launchpier.net, www.launchpier.net, outsol.online and vanity-production-2bbb.up.railway.app**. All sites expose the LaunchPier title, logo and banner, and `/access` redirects directly to `/`. No site password is required. Dedicated automation reports configured/enabled/worker running; history storage is available; external funding correctly reports setup required. Missing owner capabilities still return 404 and foreign-origin RPC calls return 403. No financial transactions were submitted. Public results: `outputs/launchpier-public-release-proof.json`.
