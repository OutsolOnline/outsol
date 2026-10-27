# Pump.fun creator fee destinations

OutSol charges 0% platform fees. The recipient setting controls the creator fees charged by Pump.fun as the token trades. It does not change Solana network fees, account rent, protocol rates or validator tips.

Choose a destination in **Launch settings** and inspect the resolved destination in the transaction review:

- **Deployer wallet:** the signing wallet receives creator fees through its Pump creator vault.
- **Another Solana wallet:** an ordinary wallet receives the fees; the deployer still signs and pays for creation and its own first buy. The recipient does not need to sign creation.
- **GitHub individual:** OutSol verifies the public individual account and its numeric user ID. Fees go to that identity's Pump social escrow through permanent 100% sharing. Organizations, bots and repository recipients are unavailable. The recipient claims through Pump.fun with the linked GitHub account; OutSol cannot perform the privileged claim.
- **Holder rewards:** creator fees go to the token's holder-reward account. This is a permanent protocol choice; Pump controls distribution to holders. Availability is checked against current protocol state before creation.
- **Cashback:** unavailable for new tokens in the current Pump program. Holder rewards are a separate option.

Changing a recipient invalidates the prepared review. GitHub identities are resolved again during preparation; a changed numeric identity requires another review. Public provider limits or unavailable verification stop preparation and preserve the selection.

The reviewed transaction plan binds the recipient, mint, signing wallet, first-buy output and spend ceiling. GitHub sharing is configured before any buy in the launch plan. Packet limits are checked before signing; routing overhead may reduce the number of immediate Block-0 buyers. OutSol never substitutes a different recipient or falls back from an atomic route to sequential submission.

After confirmation, OutSol checks the bonding curve and, for GitHub, the sharing configuration, sole recipient, numeric identity and revoked sharing administration. Saved intention and current chain data are labeled separately in the token workspace. A mismatch preserves recovery evidence instead of claiming a successful routed launch.

All implementation execution checks used disposable simulated SOL in a local Surfpool environment. They verify native program behavior, costs and account state. Mainnet landing and external Jito auction acceptance are not guaranteed by these tests.

Protocol references checked 2026-10-27: [coin creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md), [creator fee sharing](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md), [holder rewards](https://github.com/pump-fun/pump-public-docs/blob/main/docs/HOLDER_REWARDS_README.md), [cashback](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_CASHBACK_README.md).
