# Relay wallets and token sales

Open **Wallets → Relay & sell**, **Tools → Relay wallets**, or the Relay link beside launch discovery. This is our existing wallet-to-wallet token migration workflow integrated into OutSol; it is not a transaction-submission relay.

## Create and organize wallets

Create a source and recipient from Relay wallets, or create a signing and recipient wallet inside Trading sessions. Creation uses the existing OutSol wallet library: fresh Solana keypairs are generated locally and encrypted with a passphrase of at least 12 characters. Keep a private backup and the passphrase; OutSol cannot recover them. Existing import and named-group funding/withdrawal controls remain in Wallets.

Wallets are shared across these OutSol screens on the same browser and origin. Refresh locks the keys, preserves public routes and settings, and clears execution approval. The standalone Relay website's private browser storage is not imported automatically. Import its wallets through OutSol's existing encrypted wallet importer if needed; never paste a key into a route, URL or message.

## Relay existing balances

1. Save a named source → recipient route. A source has one recipient. A recipient cannot also be a source in the same saved route set; use a separate rescan for a later hop.
2. Select a wallet group or individual wallets and **Scan selected**. Every selected wallet must scan successfully before a group review. Unsupported accounts remain visible with reasons.
3. Choose token accounts, then **Review selected relays** or **Relay this wallet**. Review exact raw token amounts, complete addresses, network/priority fees and destination account rent.
4. Approve and sign the displayed queue. Transactions execute sequentially, not atomically across wallets. Failure, rejection, cancellation or uncertain confirmation stops the remaining queue.

SOL and wrapped SOL are not relayed. Source SOL pays the disclosed network fees and recipient token-account rent. Recipient wallets need their own SOL to pay fees when later selling or transferring. Existing funding controls can fund an entire wallet group.

Ordinary SPL Token and supported Token-2022 accounts work, including non-associated source accounts. Relay accepts metadata mint extensions and ImmutableOwner accounts; fee-on-transfer, frozen, confidential, hook, nontransferable, unknown-extension and malformed accounts are excluded. A scan refuses oversized/incomplete inventories rather than pretending they were fully checked. At most 200 accounts per token program are scanned and 100 transfers reviewed per queue.

## Relay after sniper buys

In **Trading sessions → Confirmed launch watch**, choose or create a signing wallet. Enable **Relay after confirmed buys**, choose/create a distinct recipient, and set a maximum Relay debit reserve. The public configuration records the recipient and reserve; it stores no private keys.

The complete worst-case purchase plus Relay fee/rent reserve counts against the session ceiling before buying. After a confirmed purchase, OutSol relays exactly that purchase's encoded token output, preserving pre-existing source holdings. A failed or interrupted Relay does not undo the confirmed buy. The receipt states when tokens remain in the source, and the session stops without retrying automatically. The browser must remain open. Confirmed-launch watching is not a promise of first-block inclusion or sniper protection.

## Sell tokens from one wallet or a group

Select token balances after scanning, then **Sell this wallet** or **Review selected sales**. The review identifies each wallet/mint, exact amount, route, estimated net SOL change, minimum gross proceeds, included network/priority fees and the maximum fee/rent reserve. **0 SOL OutSol platform fee** is separate from venue costs. Sales return SOL to the signing wallet.

Active SOL Pump.fun curves use OutSol's native route. Other supported markets use [Jupiter's V2 build route](https://developers.jup.ag/docs/swap/build) with zero integrator fees and no automatic submission service. A fresh execution quote must meet or improve the approved minimum output and cannot increase the cost ceiling. Every signed packet receives another same-bank balance simulation before broadcast.

Unavailable markets remain visible and are excluded explicitly in the review. A market candidate is not a guaranteed available quote. Market sales currently accept canonical associated token-account inputs, validated `route_v2` instructions, supported metadata and transfer-fee Token-2022 extensions. Relay non-associated balances into a recipient account before selling them. Unknown/shared/ledger instruction variants, hooks, malformed extensions and unrelated existing wrapped-SOL balances fail safely. No liquid market means no executable sale. Reviews are bounded to 100 token sales and expire after two minutes before execution; each fresh packet has its own short lifetime.

Keyless market routing is supported with the provider's request allowance and may be rate limited. An optional server-only `JUPITER_API_KEY` can increase the allowance. The browser never receives this credential, an RPC key, an arbitrary provider endpoint or a remotely signed packet. No OutSol fee receiver is configured.

## Recovery

Public transaction identities and pending records are saved before broadcast. All established OutSol spending paths remain blocked by unresolved Relay records even if a generic wallet status check has finished. **Check saved transactions** checks the original signatures; it never rebuilds a spending packet or resumes remaining rows. Relay requires finalized confirmation and preserves unknown receipts when history cannot establish the outcome. Sales reuse the existing trade recovery safeguards and update their batch context only from matching original receipts.

Configuration, encrypted wallets and receipts are local to the current browser/origin. Do not clear browser data while a transaction remains unresolved.

## Verification

On 2026-10-31, disposable fake-funded Surfpool tests executed SPL and Token-2022 transfers with exact amounts above JavaScript's safe integer range. The complete product path also executed launch → sniper buy → exact automatic Relay → recipient 100% native sale, preserving pre-existing source holdings and original receipts. A separate unsigned mainnet USDC → SOL preview verified the real Jupiter provider and same-bank balance checks while every spending method was blocked. This does not establish funded Jupiter/mainnet landing, auction priority or universal token support.
