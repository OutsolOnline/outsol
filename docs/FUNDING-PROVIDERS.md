# External group funding

Implemented and checked against the official sources on **4 November 2026**. The UI brand is LaunchPier. Existing OutSol URLs and unrelated stored wallet data are unchanged by this connector.

## What is implemented

The Funder can render `FundingProvidersPanel` from `@/components/fundingProviders/FundingProvidersPanel`. Pass `{recipients: [{address, label?}], groupName?, onBusyChange?}` from an explicitly chosen wallet group. The connector accepts 1–20 distinct, canonical Solana wallet addresses, a positive exact SOL amount with at most nine decimals, and no private keys. This version allocates equal percentage shares in the UI; the server also validates explicit integer-basis-point shares totaling 10,000.

The actual SplitNOW flow is:

1. Read live SOL deposit limits and validate every allocation.
2. Create and fetch a **real floating SOL→SOL quote** using the published REST contract. The whole-amount quote is an estimate, not a guaranteed result for the individual split orders.
3. Display the exact recipients, percentages, preferred exchange, total deposit, 0% LaunchPier fee, provider fee disclosure and estimate expiry. Require separate affirmative policy consent and order confirmation.
4. Persist the receipt capability before submitting **one** provider order. Atomically consume the quoted plan; a retry cannot create a second order from it.
5. Fetch the order and verify its input asset, network and amount, every distinct recipient and allocation, order identity and deposit amount before displaying a deposit address. A changed or unverified response displays no deposit instructions.
6. The user deposits manually. This integration never transfers SOL, signs a wallet transaction, receives private keys, or stores a funded wallet on the server.
7. Refresh status using the private capability, import/export a recovery JSON, and restore the same order after navigation or a server restart. Status is attributed to SplitNOW; it is not an independent on-chain balance confirmation.

Only the quoted plan on the server determines an order's destinations. The browser cannot replace its recipients or asset/network at the order-creation step. Order lookup requires an unpredictable 256-bit capability in the `Authorization` header. Short provider order IDs cannot be used as app lookup credentials. Browser recovery files contain this capability and must stay private; they contain no wallet keys and cannot sign anything.

Unknown order-POST outcomes are intentionally **not retried**. The receipt becomes recovery-required. If the provider accepted a request but its reply was lost, the customer must use that receipt and SplitNOW support rather than create or fund a duplicate. A crash after persisting creation intent also produces this safe recovery state. There is no documented provider idempotency key in the SDK, so the connector does not invent one.

## Operator setup

No provider account, key or order was created during implementation. Live provider acceptance and funded execution remain unverified until an authorized operator completes setup and tests an order with an explicit deposit budget.

1. Create the operator's account at [SplitNOW registration](https://splitnow.io/auth/register) and obtain a key from [API keys](https://splitnow.io/account/api-keys). Review and accept the provider's current requirements yourself; no registration or policy acceptance is automated.
2. In Railway, privately set:
   - `SPLITNOW_FUNDING_ENABLED=true`
   - `SPLITNOW_API_KEY` — provider key, server only.
   - `FUNDING_STORAGE_KEY` — a newly generated, unique 32-byte random encryption key encoded as canonical base64. Keep a private backup; losing it prevents receipt recovery. Never prefix it with `NEXT_PUBLIC_` or reuse a public RPC key.
   - `FUNDING_STORAGE_DIR=/data/launchpier-funding` — a private direct child of the existing mounted volume, separate from both public assets and X credential storage.
3. Keep this deployment at **one instance**. The existing encrypted file store uses private files (`0600`), a private directory (`0700`), authenticated encryption, atomic rename and sync, symlink checks, bounded records and hashed capability filenames. Quote claims are atomic across processes, but this design is not a general multi-replica database. Back up the volume and encryption key privately. The application user must be able to create the private child directory; never serve it as static files.
4. Keep `APP_ORIGIN`/`APP_ALLOWED_ORIGINS` accurate. All provider routes retain the application's access gate, origin checks and no-store responses. Do not log `Authorization` headers or download contents.
5. The public configuration endpoint reports setup-required until all required server settings are valid. Having settings does **not** imply a successful provider connection. Do not advertise acceptance-tested funding before verifying it with the actual account.

The SDK documents a default API limit of 60 requests/minute. This connector allows at most six new quotes per minute and at most 40 upstream calls/minute per service process, with six-second request deadlines, fixed HTTPS provider URLs, redirect refusal, and bounded streamed responses. These are shared capacity limits for this deployment. Higher traffic requires a suitable provider quota and a durable shared rate limiter rather than more replicas using the same key.

Private server receipts expire after 90 days. The latest 20 recovery references are retained on a browser when storage is available. Blocked browser storage requires a recovery download before the app will initiate an order. Recovery never overwrites or migrates the encrypted wallet vault. A provider outage or invalid upstream order returns a verification-required state without a deposit address.

## Costs and provider routing

LaunchPier's platform fee is **0%**. SplitNOW's [published Terms, section 5.3](https://splitnow.io/terms) currently state a maximum **1.00% service fee** for multi-leg orders, with partner-exchange charges and network fees potentially additional. Their terms were last updated 26 November 2025 and checked on the date above. The SDK quote response does not itemize those costs, so the UI does not invent exact fee lines or treat the difference between input and output as an exact service fee. The sender also pays their own Solana deposit transaction fee.

The SDK explicitly says a chosen exchange may fall back to another available exchange. No fixed CEX source, completion time, rate, unlinkability, cluster prevention or anonymity is promised. Current provider terms, privacy policy, AML policy and restricted regions are linked in the review step. Orders may be delayed, halted, refunded or rejected by the provider.

## Husher

[Husher's current official API Terms](https://www.husher.io/api-terms), last modified 20 July 2026, distinguish Personal and Partner Access. Personal keys cannot power a website or service offered to other people, including a free application. Written Partner Access is required before a third-party integration. The terms also require explicit policy consent/disclosure, records and other partner obligations; an operator must evaluate and meet these requirements before enabling a connector.

The app therefore offers a normal [external Husher link](https://www.husher.io/) with an honest Partner Access dependency. It does not guess Husher endpoints, reuse a personal key, scrape private request formats, claim a partnership or quote Proxima's prices as Husher's direct prices. Proxima's [fund-wallets documentation](https://docs.proxima.tools/wallets/fund-wallets/) identifies Husher as its fixed CEX-funding provider, but this does not grant our app access.

## Endpoints and source contract

- `GET /api/funding-providers`: public configuration flags only; no credentials.
- `POST /api/funding-providers/quote`: `{amountSol, recipients: [{address, shareBps?}]}`. Returns the immutable public review and a private capability.
- `POST /api/funding-providers/order`: bearer capability plus `{exchangeId, policiesAccepted: true, reviewConfirmed: true}`. Creates an external order after explicit user review, never a deposit transaction.
- `POST /api/funding-providers/status`: bearer capability, no provider-order-ID lookup.

The adapter follows the official SDK's `x-api-key` header, `https://splitnow.io/api` base, SOL identifiers, quote envelope, order-output schema and status structure. Primary references:

- [Official TypeScript SDK](https://github.com/splitnow/typescript-sdk)
- [REST implementation and order schema](https://github.com/splitnow/typescript-sdk/blob/master/src/sdk.ts)
- [Official response types](https://github.com/splitnow/typescript-sdk/blob/master/src/types.ts)
- [Provider API documentation](https://splitnow.io/api/docs)
- [Terms](https://splitnow.io/terms), [privacy](https://splitnow.io/privacy-policy), [AML](https://splitnow.io/aml-policy), [restricted regions](https://splitnow.io/restricted-regions)

Focused tests use synthetic fixtures matching those published schemas. They verify request routing, private key isolation, exact allocations and deposit identity, stale-quote refusal, policy consent, one-time order creation, ambiguous outcomes, foreign/guessable handles, bounded provider payloads, encrypted restart recovery, API origin/body controls and browser recovery import. They do **not** assert that a real provider accepted an order or that funds arrived.
