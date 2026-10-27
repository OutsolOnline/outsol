# Browser capture and Pump creator workflows implementation plan

> **For agentic workers:** Use the existing shared feature checkout and independent file ownership. The user delegated design and implementation decisions and asked to proceed.

**Goal:** Ship a downloadable OutSol extension that prepares launch drafts from websites, an honest Coming soon X tracker, and working Pump.fun creator execution features.

**Architecture:** The extension uses Manifest V3 and user-gesture capture, then sends public editable suggestions in a URL fragment to an isolated review page. The existing builder remains the signing destination. Separate public preset, multi-launch and trading-session modules reuse native Pump transaction validation, exact simulation, shared submission locks and existing pending recovery. Private wallet keys remain in the encrypted library and live signer callbacks.

**Tech stack:** Existing Next.js, React, Zustand, Solana web3.js and official Pump SDK; local MV3 JavaScript/CSS, native browser APIs and Vitest. No new paid provider dependency.

**Spec:** Current user request: a downloadable extension to launch from websites; X post tracking like Rapidlaunch/Track.tech labeled Coming soon; continue adding useful deployer features within the established SOL/Pump.fun scope. Implementation choices are delegated to the agent.

## Global constraints

- Solana/Pump.fun only; 0% OutSol platform fees, with network/rent/protocol costs disclosed.
- Extension never signs, holds keys, captures form fields, requests permanent access to all sites or transfers a page until a user action.
- Page content and extension messages are untrusted. Bound and validate all text/URLs; reject private hosts and non-HTTPS URLs. Never fetch arbitrary URLs server-side.
- Captured URL fragments are cleared from browser history after reading. Saving a new draft is explicit and preserves existing designs and wallet storage.
- X tracking is unavailable in this release: no fabricated posts, live status, alert latency or connected-account claims.
- New spend paths use the existing shared Web Lock, fresh signer checks after waits, immutable reviewed messages and original-signature recovery. No automatic retries after uncertain submission.
- Use only simulated SOL in execution tests. Do not place live trades or launches.
- Keep private repository and Railway deployment workflow; no GitHub Actions requirement.

## Tasks

- [x] Extension: MV3 popup/context menus, editable capture review, fixed OutSol handoff, local-only code, icons, ZIP and installation guide; validation/capture/worker tests.
- [x] Receiver: strict fragment validation, public source/artwork suggestions, explicit browser image import or upload, explicit saved draft, existing builder continuation; malformed input/storage/size tests.
- [x] Tracker: distinctive Coming soon explanation for account/post/repost/delete monitoring, with a working manual post-to-draft path and no simulated feed.
- [x] Bundles: public preset CRUD and curated execution modes; fresh encrypted-wallet group resolution, no copied managed keys, lock/cancel/unknown regressions.
- [x] Multi-launch: two to five distinct fresh mints; per-token and whole-plan cost review; sequential signing with verified public progress and existing launch recovery.
- [x] Trading workflows: bounded browser sessions and observed-token preparation where verified integrations allow; explicit budgets, time limits, cap/interval triggers and accurate availability labels.
- [x] Integrate all tools into navigation/search, verify responsive pages and draft refresh recovery, review extension permissions and transaction boundaries.
- [ ] Run focused and full checks, simulated execution where supported, inspect the browser, package the extension, push privately and verify Railway's exact release and download.

## Review focus

- Malformed or oversized fragment, private URLs, unexpected fields, editable-field selection and malicious page markup must remain inert.
- Remote artwork is never fetched by the server. Browser import has byte/type/timeout limits, no credentials and a clear CORS fallback.
- Closing a page, locking a wallet or changing group membership during an asynchronous operation must stop future submissions.
- Multi-launch and timed operations are sequential and may partially complete. Every completed or uncertain signature remains visible and is never automatically repeated.
- Web-store installation, X access and long-lived background operation must be described according to what is actually delivered.

## Verification before release

Default regression suite: 506 passing checks; opt-in simulator checks separately executed two-token native Pump launch and two DCA purchases followed by a SOL-cap sale. Multi-launch's reviewed and actual debits matched. Browser capture-to-draft-to-builder continuation and all six new/updated workspaces passed at 390/768/1440/1920 pixels. Extension package has 12 allowlisted files and requests only activeTab, scripting and contextMenus. It was not installed into the user's browser.

A real read-only discovery check exposed RPC error -32015 for unsupported transaction versions. The feed now omits only those transactions, keeps maxSupportedTransactionVersion at zero, and states the coverage limit; other provider failures remain unavailable. The corrected path was verified against an actual unsupported mainnet sample without sending any transactions.
