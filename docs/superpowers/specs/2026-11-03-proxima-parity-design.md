# OutSol creator workspace expansion

The user asked to implement the feature gaps in the previously delivered 79-item Proxima comparison. They have delegated design and implementation decisions. This is an execution request, not another design approval round.

## Product contract

Extend the existing Next.js OutSol application into a coherent prepare, launch and operate workspace. Preserve Pump.fun-only new launches, Solana-only support, 0% OutSol fees, server-only RPC credentials, local encrypted keys, exact transaction validation, signed simulation, explicit reviews, cancellation and durable original-signature recovery. No mainnet spending is authorized. Keep existing browser records and legacy timing behavior compatible.

Work from current official documentation and the existing comparison. A provider's private implementation, custody model or advertised execution guarantees are not reusable APIs. Implement independently, disclose actual coverage, and never count a link, placeholder or a planning-only calculator as executable parity.

## Approach

Build on the proven wallet library, native Pump SDK, transaction engines and public local storage. Extend each execution path with validation and recovery rather than introduce a parallel signing stack. Keep the premium graphite OutSol shell. Add useful focused panels and sensible defaults; advanced controls stay secondary.

An external licensed-service wrapper would depend on unavailable provider access and fees. Replacing local keys with server custody would violate the established key contract. The chosen independent native implementation retains user control and makes dependencies visible.

## Deliverables

1. Native creator-fee inspection, review, collect/distribute, and editable supported on-chain shares. Clearly show wallet-wide vault claims, irreversible authority consequences, and unsupported social/holder-authority claims. A split supports up to ten distinct positive recipients totaling 10,000 bps, including ordinary charity wallet addresses without pretending to verify a charity.
2. A persistent staged buy plan, explicit deploy-now/start-buys-later flow, reviewed multi-wallet subsequent purchases, budget/order/timing controls, supply-target funding estimates, and guard configuration grounded in actual confirmed external trade data. Never rename legacy automatic Manual execution silently.
3. A live mint workspace with bounded confirmed trade history, price chart, controlled/watched wallet markers, top account distribution with coverage limits, actual-fill accounting, and export. Unknown acquisition basis remains unknown. No invented price history, balances, fills or P&L.
4. Arbitrary public-address watchlists, public import/export, project association and wallet inspections, separate from coming-soon X monitoring.
5. Project archive/restore, safe portable public handoff, mint-address design cloning, complete local receipt discovery, account-level recovery entry points, dedicated default funding selection, group colors/archive, and user theme/hotkey preferences where compatible with reviewed signing.
6. Safe supply actions: burn with exact supply decrease, percentage distributions, and supported Streamflow locks only with official SDK verification and clear third-party costs. Developer supply locks remain distinct from LP locks.
7. Richer bounded local trading sessions: multiple wallet scope/strategies, pause/edit/resume with fresh approval, cap ladders and counter rules where real market data coverage suffices. Stop on uncertain submissions and stale/incomplete observations. No automatic rearm after reload.

## External and architectural boundaries

Husher/CEX funding, purchased aged-wallet inventory, a proprietary Shield router, and guaranteed first-block/cluster-concealment behavior need documented provider/program access that is not available. Mark those as unimplemented dependencies in the delivery inventory, not working features. Do not add a volume-inflation workflow or fabricated activity. Durable unattended execution and writable multi-user collaboration require a separately approved secure signer/account/storage design; public project handoff is useful but is not equivalent to server-enforced collaboration. Existing explicit reviews and local key custody stay in place.

## Verification

Meaningful behavior tests cover malformed public data, precision, stale configuration, signer locks, pending protection and recovery. Run full type/lint/build and test gates. Browser-review desktop and mobile panels with disposable keys only. Execute feasible transaction paths using simulated SOL; list any route that lacks execution evidence. Deployment and GitHub publishing are already authorized, but only publish verified code and accurate status.
