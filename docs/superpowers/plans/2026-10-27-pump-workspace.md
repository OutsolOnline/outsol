# Pump-focused Vanity release

The user delegated the complete design and implementation, then narrowed new launches to Pump.fun. This supersedes the previous multi-launchpad UI direction.

## Design and product scope

- One clear Pump.fun creation flow, with optional first buy. Remove Bonk, LaunchLab, Meteora, direct liquidity and lock choices from new-launch navigation and controls.
- Retain historical receipt rendering, pending-transaction reconciliation and low-level legacy integration code for compatibility. Never change an already submitted operation into a different launch.
- Custom geometric Vanity V identity, outline/path SVG wordmark and light/dark assets, favicon, self-hosted typography and a restrained graphite/mint interface.
- Consistent desktop/mobile dashboard, builder, wallet, bundles, activity and utility pages; readable controls, useful loading/empty/error states, visible cost and signing status.
- Preserve encryption, key boundaries, message validation, preview expiry, Web Locks, cancellation and confirmation recovery. Vanity platform fees remain zero.
- Useful preparation improvements may include editable amount presets and persistent reusable artwork, provided they do not compromise the final UI or transaction verification.

## Implementation

1. Root: Pump-only catalog/query policy, draft migration behavior, streamlined builder and signing UI, consistent tool page framing, relevant regression tests.
2. Design agent: shared shell, complete operational dashboard, typography/spacing system and production SVG identity assets.
3. Runtime agent: official Surfpool runtime bound to localhost, upstream read-only boundary, ephemeral fake-funded wallets and reproducible startup.
4. Execution agent: actual signed Pump create/create-plus-buy and subsequent trade/bundle tests against forked real program state. No mainnet broadcast. Report limitations rather than passing unsupported checks.
5. Root/reviewer: browser verification of every affected page at desktop/mobile widths, all tests/type/lint/build/audit, credential scan, private GitHub push and Railway smoke checks. Deliver screenshots and SVG assets.

## Verification boundaries

Local fork execution proves local transaction behavior against fetched program/account state, not production network inclusion or validator ordering. Evidence must identify which checks are local execution, read-only mainnet simulation, UI-only or unavailable. No claim of perfection or funded mainnet execution without evidence.
