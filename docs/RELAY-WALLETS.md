# Relay wallets and token sales

Open **Bundles → Launch & sniper pairs** for the simple session workflow. The same pair setup is available during token-builder preparation. **Advanced wallet tools**, **Wallets → Relay & sell** and **Tools → Relay wallets** retain the general wallet controls. Relay moves tokens between your wallets; it is not a transaction-submission relay.

## Sniper → Token Receiver sessions

**Generate sniper session** creates all selected pairs in one action, with an optional separate deployer. A pair is named **A Sniper → A Token Receiver**, then B, C and onward. Generate up to 16 pairs for a launch; encryption happens in batches of at most 20 keys. The library supports 100 wallets in total. No funds are sent by generation. The deployer creates the token and is never automatically used as a sniper or receiver.

**Download session backup** saves every selected sniper, receiver and selected local deployer in one unencrypted JSON file, with their names and pair roles. Keys must be unlocked. **Unlock session** unlocks the complete selected session together when its wallets share a passphrase; mixed-passphrase wallets can be unlocked separately. Keep this file private: it grants full spending access. **Import session backup** verifies every private key and public address, restores missing wallets into the encrypted library in batches and rebuilds the pair roles. Existing wallets keep their original encryption. Interruptions preserve already-saved encrypted wallets rather than deleting them.

Fund the displayed addresses yourself: each sniper needs its buy allocation plus fees and any recipient-account rent; each receiver needs SOL for later sale fees. **Use these pairs for launch** attaches only the sniper wallets as buyers and fixes their paired receiver destinations. Set the buy amounts in each card. The existing launch review and signature steps still apply. Exact new purchases forward to the receiver in the buy transaction; existing source tokens remain in the source.

**Sell A receiver** reviews supported holdings in A's receiver only. **Sell all receivers** reviews the selected session's receiver wallets only. Snipers and deployer are excluded at quote, review and signing boundaries. These actions refresh balances before opening the review. **Send tokens to receiver** separately scans and reviews existing source holdings for the fixed pair destination. Sales and transfers remain sequential reviewed queues, with pending/recovery protection and no automatic restart.

Saved pairs and public session names/deployer addresses survive refresh and can be reused for another token. Keys lock after refresh; nothing automatically buys or sells. A restored wallet with a new local ID binds to a pair only by its exact public address. Existing manual creator/buyer secrets block pair assignment until the user backs them up and explicitly changes the wallet source, so the new flow cannot silently discard their only copy.

## Wallet controls inside Bundles

Use **Generate bundle wallets** or **Import bundle wallets** to create an encrypted named group without leaving the launch. The first wallet in a new standalone group is the creator; the others are buyers. Adding wallets preserves existing buy budgets, timings and Relay destinations. New buyer budgets start at zero. The inline builder also lets you choose whether the first new wallet becomes the creator.

**Wallet controls** includes configured wallets even before they buy, plus known controlled recipients. Select all or individual wallets, scan their balances, then choose **Sell all tokens in this wallet** or **Sell all selected wallets**. Every sale still requires a review and signature. Sell-all includes all eligible tokens in those wallets; unsupported or unavailable markets are identified rather than silently sold. Proceeds return to each signing wallet. An external recipient is read-only until its matching private key is imported.

**Export key / keypair** backs up one wallet; **Export selected keys** backs up the selected set. Choose Solana keypair JSON or Base58. A single keypair is a standard 64-byte Solana CLI JSON array; a single Base58 key is plain text. Multi-wallet backups are JSON containing public names, addresses and the selected private-key format. The files are unencrypted and grant full spending access. Exports stay local, require explicit acknowledgement, validate every key against its public address and refuse partial backups if a selected wallet locks or changes. Restore at most 20 wallets per import; larger exports can be restored in batches.

In **Launch setup**, each buyer can forward exactly its newly purchased tokens to a distinct recipient in the same buy transaction. This works with Atomic / block zero, After confirmation and Organic intervals. Existing buyer holdings remain unchanged. Recipient-account rent and network charges are included in the execution checks. A routed buyer cannot schedule a source-wallet sale of those forwarded tokens; sell from the recipient in Wallet controls instead. Creator first buys are unchanged.

After a completed bundle refresh, public receipts recover the actual signing wallets and automatic recipients. Added recipient selections and saved routes follow the named group before launch and the mint after launch, including moving from the inline builder to Bundles. Import the matching keys or unlock the encrypted library to regain control. The inline builder does not reopen a completed result screen after a full reload; use **Bundles → Wallet controls** for its saved bundle receipt. Refresh never resumes unfinished timed buys or sales automatically.

An extra recipient attachment uses its local library identity. If you explicitly delete that wallet and later reimport it under a new identity, use **Wallets → Relay & sell** to control the restored wallet. Its key is available in the library, but the old bundle attachment is not automatically reassigned. A new unlaunched bundle can select the restored wallet as its buyer's Relay destination.

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

On 2026-11-01, six additional fake-funded Surfpool cases exercised both launch surfaces across all three bundle modes. They verified exact new-purchase forwarding, preservation of incoming/pre-existing tokens, cold public-receipt recovery, an individual wallet sale and selling the remaining wallet group to zero token balances. Native Pump group sales retain each original reviewed minimum in the signed on-chain instruction, including price changes caused by the preceding group sale. No real SOL was spent.
