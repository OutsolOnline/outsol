# OutSol Proxima Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the independently supportable Proxima comparison gaps inside OutSol and keep a truthful evidence inventory for dependencies.

**Architecture:** Reuse native Pump transactions, encrypted local managed wallets, reviewed operation engines and exact public records. Independent subsystems have separate owners; the coordinator integrates the token workspace and navigation, reviews boundaries and verifies the whole release.

**Tech Stack:** Existing Next.js/React/TypeScript, official Pump SDK 4.3.1, Solana web3/SPL, Streamflow SDK, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-proxima-parity-design.md`

## Global Constraints

- Pump.fun-only new launches; Solana-only; 0% OutSol fees.
- Private keys remain locally encrypted; no keys/RPC credentials in public state or logs.
- Exact transaction validation, signed simulation, explicit review, pending protection, original-signature recovery and cancellation remain mandatory.
- No mainnet spending; simulated execution only.
- Preserve existing stored data and legacy automatic Manual semantics.
- Do not label placeholders, provider dependencies, estimates or partial observations as executed capability.

## Review Focus

- A locked or changed signer during asynchronous preparation must stop before broadcast.
- Lost submission responses must retain original signatures and prevent a second spend.
- Imported/corrupt/stale public records must fail closed without overwriting existing work.
- Wallet-wide claims, unknown cost basis, incomplete trade coverage and token-account concentration must not be misrepresented.
- Pair receivers/deployer roles and existing manual private inputs must remain protected across all new UI paths.

## Tasks

### Task 1: Creator operations
Files: create `src/lib/creatorOperations/*`, `src/components/creatorOperations/*`, relevant behavior tests; minimally extend `src/lib/tokenFacts.ts` for verified sharing authority. Parent owns token-page integration.
- [x] Tests first for shares, claims scope, exact messages, simulation, stale signer and pending recovery.
- [x] Implement native inspection and reviewed claims/distribution/fee-share updates with official SDK instructions.
- [x] Deliver `CreatorOperationsPanel({mint:string})`, focused verification and scoped review.

### Task 2: Staged and multi-wallet buy plans
Files: new `src/lib/buyPlans/*`, `src/components/buyPlans/*`, relevant tests; preserve existing launch engine by adding explicit integration hooks after coordinator review.
- [x] Tests first for public plan parsing, target allocation quote math, wallet order, budget and transaction recovery.
- [x] Implement persisted public staged plans and reviewed native multi-wallet buys, fresh quote/signature checks and exact receiver forwarding.
- [x] Deliver plan panel supporting existing mint and pre-launch plan handoff; integrate explicit start after confirmed launch.
- [x] Add precise real external-buy guard support only when coverage contract is proven.

### Task 3: Live market and actual-fill accounting
Files: new `src/lib/market/*`, `src/lib/server/tokenMarket.ts`, `app/api/token-market/route.ts`, `src/components/market/*`, `src/lib/accounting/*`, relevant tests. Parent owns token page.
- [x] Tests first for official event frame parsing, duplicates/failed frames, limits, holder coverage, actual fill deltas and unknown basis.
- [x] Implement bounded confirmed snapshots, chart/feed/holder distribution/wallet markers.
- [x] Implement confirmed-fill accounting and exports; distinguish local receipt coverage from complete chain history.
- [x] Deliver `TokenMarketPanel({mint:string})` and `TokenPerformancePanel({mint:string})` with source/age/retry states.

### Task 4: Workspace, tracker and library operations
Files: `src/lib/watchlist.ts`, `app/watchlist/page.tsx`, `src/lib/tokenProjects.ts`, `app/projects/page.tsx`, `src/lib/workspaceActivity.ts`, `src/lib/workspaceCatalog.ts`, public preference modules/panels, related tests.
- [x] Test watchlist public projection/roundtrip/storage failure and project archive compatibility first.
- [x] Implement wallet watchlist, project archives/public handoff and complete receipt discovery.
- [x] Add verified mint-design import, default funding selection, group visual/archive metadata, theme/hotkey settings and recovery links.
- [x] Integrate panels into premium responsive token workspace with clear costs/status/next actions.

### Task 5: Supply management
Files: new supply-operation modules/panels and tests, reuse existing transaction history/recovery patterns.
- [x] Test exact burn intent and simulated supply delta; amount/percentage distribution precision.
- [x] Implement reviewed burn/distribution and verified supported Streamflow lock flows.
- [x] Preserve third-party fee disclosures and never equate developer escrow to LP lock.

### Task 6: Trading-session expansion
Files: extend existing `src/lib/tradingSessions/*`, corresponding UI and tests after Task 2 owner completes.
- [x] Test multiple-wallet/strategy budgets, pause/edit/resume, counter and cap ladder rules, stale observations and cancellation.
- [x] Implement supported bounded reviewed browser sessions without unattended server custody.
- [x] Preserve pending records and require explicit fresh approval after edits/reload.

### Task 7: Inventory, full verification and release
- [x] Independently review transaction/storage/custody boundaries and fix material findings.
- [x] Run focused behavior tests, full suite, typecheck, lint, production dependency audit and build.
- [x] Use simulated funds for feasible transaction acceptance; inspect browser at 390/768/1440/1920.
- [x] Update feature inventory with evidence, remaining external dependencies and exact limitations; remove stale competitor fee assertions unless primary sources resolve them.
- [x] Commit as OutSol, push public organization source and deploy verified release to Railway; verify actual live build.

## Execution ledger

- Baseline: `deb2906` (application `9a6d487`). Existing linked worktree reused; branch `outsol-proxima-parity`.
- Initial baseline run: 1,019 passed, 88 skipped, ten timeout-related failures across extension packaging, IPFS, X auth/storage. Investigate in isolation before code changes affect them.
- Ruling: independent file-owned implementation tasks may run concurrently under the active developer delegation instruction; shared token-page/navigation mutations stay with coordinator.
- Ruling: full feature parity cannot include unavailable licensed providers or a new server-custody design. Build native equivalents where possible and preserve explicit dependency status.

- 2026-11-03 implementation checkpoint: native creator claims/distribution and permanent final shares, staged buys/forwarding, bounded multi-wallet strategy queues/observed stop rules, market chart/receipts, saved accounting evidence, watchlist, project archives/public handoffs, default funder, group appearance/archive, preferences/shortcuts, clean mint-design import and role-scrubbed kits implemented. Supply includes exact transfers/percentage allocations, SPL/Token2022 burns, canonical Streamflow escrow and two-phase consolidation. All new panels integrated into token workspace.
- Fake-SOL acceptance: 8 wallet-operation cases (including both burn programs), staged launch + two receiver buys + two queued strategies with original recovery, 2 creator cases (real fee accrual/claims/permanent shares/distribution + unknown recovery), 3 Streamflow cases (both token programs + unknown recovery). Production funds untouched.
- Independent review: first pass found stale completed buyer selection and insufficient stored queue scope review; assigned owner fixes. Second pass found incomplete-log guard coverage and falsely inferred cost continuity in receipt samples. Accounting now never carries basis across sampled transactions; market coverage fix in progress. No further P1/P2 established in creator/lock/consolidation/clone/kit scan.
- Integration: new original-signature histories discovered in Activity with dedicated recovery links, unresolved creator/supply records block existing spend boundaries. Streamflow SDK removed from synchronous activity/model import path by agent.

- Final regression:1,241 passed/99 skipped; whole-tree typecheck and lint passed without warnings; production audit zero vulnerabilities. Separate root-run strict Surfpool acceptance:17passed/5files, including actual exact partial consolidation sale with baseline holdings preserved. Native exact partial sale independently reviewed; no actionable findings. Browser71checks across10routes/eighttoken panels and4widths; 390builder additional manual validation check. Productionbuild inprogress; commit/deploymentpending.

- Production build passed all routes/static generation. Release integration authorized earlier; existing worktree preserved.

- Final release: application b0bb7a1, public organization main pushed, Railway 7c01e39f-b547-4906-a6d0-b735a92e4e5d SUCCESS. Authenticated new-page/API checks passed both domains at12:17:46UTC; fresh sessions redirect to access. No production secrets or gate configuration changed. Local VM stopped.
