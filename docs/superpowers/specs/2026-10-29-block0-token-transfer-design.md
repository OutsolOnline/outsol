# Block-0 buy and token transfer

## Requested outcome

Extend the existing OutSol project at `C:\Users\illag\Vanity`. During the user's own Pump.fun launch, selected buyer wallets buy tokens and automatically transfer the purchased tokens to their configured receiving wallets. The user selected the existing Block-0 bundle as the execution route.

## Proposed experience

- Each additional buyer wallet in the launch builder gets an optional **Send bought tokens to** public-address field when Block-0 is selected.
- A configured recipient receives exactly the raw token amount purchased by that buyer. Previously held tokens and remaining SOL are not swept.
- Multiple buyers can use the same receiving wallet or different receiving wallets. Each sending wallet uses its existing imported, locally unlocked private key. Receiving wallets require only public addresses.
- The final review lists each buyer, recipient, exact token amount, maximum SOL purchase budget, account-creation rent and transaction costs.
- Buyer rows without a recipient keep their current buy behavior. This first change applies to additional Block-0 buyer wallets; the creator's separate first-buy configuration stays as it is.
- Switching away from Block-0 clears the optional transfer destinations and invalidates the prepared review. Non-Block-0 configurations with active transfer destinations are rejected rather than silently ignored or executed.

## Approaches

**Recommended: buy and transfer inside the existing Block-0 bundle.** Append creation of the recipient's token account, when needed, and the exact token transfer to that buyer's transaction. A successful buyer transaction includes both actions. Keep all launch packets in the existing atomic submission route. This preserves the user's selected Block-0 flow and avoids waiting for a second transaction after the purchase.

**Alternative: transfer after the buy confirms.** This reuses more of the standalone transfer workflow, but the transfer can be interrupted after the buy succeeds. It would require a separate persisted transfer stage and recovery flow. This is not the proposed implementation.

## Execution and validation

The native buy builder already chooses an exact raw token output before signing. Use that amount for `transferChecked`; do not estimate it from a percentage or sweep the source account balance.

Validate the recipient as a supported Solana wallet public address and reject the sending wallet as its own recipient. Derive the source and recipient token accounts for the actual mint and token program. Use idempotent token-account creation so an existing recipient account is supported.

Introduce explicit validation for the composed buy-and-transfer transaction. Bind the recipient, mint, source account, recipient account, raw token amount and SOL budget to the reviewed intent. Existing buy-only validation must remain strict. Do not allow arbitrary transfer instructions in ordinary Pump transactions.

Simulate the complete ordered bundle in one bank before signing and again after signing. Verify the recipient's token increase, preservation of preexisting tokens, and each payer's total SOL debit including recipient account rent. Aggregate expected changes per token account when several buyers share a recipient or a recipient is another buyer or the creator. Include all purchases and transfers when computing those expected changes; the creator can receive tokens bought by the additional wallets.

Include the creator's first buy in those aggregate expectations. Verify token-account ownership, mint, program and raw balance through a dedicated token-state inspection; keep that separate from the existing ordinary-wallet SOL debit parser. Charge account rent to the payer that actually creates the account in the simulated execution order, rather than adding a fixed rent cost to every row.

Keep the existing maximum of five bundle transactions and 1,232 bytes per transaction. A composed buyer transaction that exceeds size or compute limits fails preparation with a clear message. There is no automatic switch to a later transfer. First-block landing remains subject to the existing execution limitations.

## Persistence and recovery

Persist only the public recipient settings, transfer intent and original transaction receipts. Keep private keys in the existing local wallet facilities. Bind recipient settings to preview freshness so changing a destination invalidates the prepared plan.

Update the strict public settings and receipt serializers to explicitly preserve the selected recipient, sending wallet, mint and raw transfer amount. Legacy receipts without transfer information remain readable.

Use the existing one-broadcast submission and original-signature reconciliation. A bundle acknowledgement alone does not establish completion. If confirmation is unknown, show the original transaction status and do not automatically buy or transfer again. Cancellation continues to stop unsent actions; it cannot undo a broadcast.

## Verification

- Existing configurations without recipients still load and behave as before.
- Mode changes clear transfer destinations, invalidate previews and cannot execute hidden transfer settings.
- Invalid or self recipients are rejected before signing.
- The composed instruction sequence transfers exactly the purchase output, including when the buyer or recipient already holds tokens.
- Tampered destinations, token amounts, mint/program identities and extra instructions are rejected.
- Account rent is included in the reviewed wallet requirement; insufficient SOL and oversized packets fail before broadcast.
- Shared recipient totals and transfers to the creator or another buyer are verified across the ordered bundle.
- A failed transfer prevents its buy transaction from succeeding; cancellation, changed keys, expired previews and unknown submissions preserve existing recovery behavior.
- Run focused unit/regression checks, type checking and lint. Use an isolated local execution environment with disposable fake-SOL wallets if available to verify actual token movement. Do not use stored private keys or submit funded transactions during development.

## Implementation boundary

Expected changes are the launch-bundle settings/model, preparation and validation, bundle token-state simulation, launch review and receipt data, and buyer settings UI. Reuse the project's Pump SDK, SPL token utilities and local wallet signing. No external-launch sniper or live trade execution is included.

Status: approved and implemented locally on 2026-10-29. Offline tests, lint, production build and independent review passed. Local-chain execution remains unverified because the disposable runtime was unavailable.
