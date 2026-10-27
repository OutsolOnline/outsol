# Launch from X and account connection implementation plan

> The user delegated design and implementation and requested: launch with a tweet and connect an X account. They confirmed there is no X Developer app yet and asked for the finished integration plus setup steps. Continue in the existing feature checkout with independent file ownership.

**Goal:** Import a public X post into the existing reviewed Pump.fun launch flow, and add secure optional read-only X account connection and own-post selection.

**Architecture:** Public post import calls only the documented fixed X oEmbed endpoint and returns bounded inert text/attribution. The /x workspace previews the original source separately from editable token suggestions and hands off to the existing fragment receiver/builder. Optional confidential-client OAuth2/PKCE uses opaque host-only cookies and a separately encrypted private Railway-volume store; tokens never enter client JSON or wallet storage.

**Spec:** Current user request and established OutSol constraints; implementation choices are delegated. Default interpretation is an existing post becomes a reviewed token draft; no automatic on-chain execution or posting to X.

## Constraints and decisions

- Pump.fun and Solana only; 0% OutSol platform fee. Network, rent and protocol charges remain distinct.
- Preparing a post never publishes metadata, signs, launches or posts an announcement automatically.
- OAuth scopes are tweet.read, users.read, offline.access only. No posting/DM/follow permissions.
- No user X Developer app exists. Account connection must be accurately unavailable until owner app credentials and exact callback are configured. Public imports remain independent.
- X API reads are paid according to the official pricing checked 2026-10-27; operator setup docs disclose credit/spending-limit requirements. No paid live API or account authorization tests without credentials and authorization.
- Official public oEmbed host publish.x.com only; no scraping, credential reuse or arbitrary URL fetch. No raw provider HTML/scripts in the application.
- Retain source link, author and date when available; show derived editable draft separately. Missing/removed/protected content fails with an actionable fallback.
- Private X storage stays separate from public assets and browser wallet encryption. Server configuration fixes the canonical callback; request headers never choose it.
- Test real public import and mocked OAuth/refresh/replay/storage boundaries. No real SOL transactions.

## Tasks and interfaces

- [x] Shared XPost schema, strict status URL parser, media URL normalization and postToWebCapture projection; test bounds, untrusted fields and draft compatibility.
- [x] Bounded public POST /api/x/post via oEmbed and authenticated GET /api/x/posts (latest five original public posts, explicit fetch, 60-second cache); test fixed endpoints, quotas, malformed/partial/provider failures.
- [x] xAuth/service.ts exports XAuthError, XPublicIdentity and withXAccessToken(request, operation). Implement connect/callback/session/disconnect routes, encrypted durable store, cookie/state/PKCE/refresh/cancellation and honest missing-config behavior. Integrate private storage bootstrap and owner docs.
- [x] /x workspace: post import/source preview/explicit handoff, optional account and own-post choice, loading/error/retry/expiry/disconnect states, keyboard/mobile behavior. Link Tools and existing Coming soon tracker without claiming live monitoring.
- [x] Review security boundaries and errors, run type/lint/full tests/build, verify browser public-post-to-builder flow and responsive states; push privately and verify exact Railway release. Record credential-dependent tests as unavailable, not passed.

## Review focus

- OAuth callback is cross-site by design; authenticate state/PKCE/browser cookie, not ordinary same-origin POST rules.
- Consume pending state once, rotate sessions, serialize refresh and preserve refreshed token replacements. No tokens in responses, logs or client storage.
- Invalid provider replies, private posts, attacker URLs and oversized HTML must never become trusted launch input.
- Stale requests/cancellation cannot overwrite a newer selected post or redirect the user unexpectedly.
- A connection is optional and distinct from both live X tracking and a wallet signature.

Verification: 2026-10-27 local production build, typecheck and lint passed; repository suite 672 passed / 50 opt-in skipped. Real official public X import and browser source-to-draft flow passed. OAuth requires the owner Client ID/Secret; no authenticated live account claim is made. Launch announcements use a reviewed X composer without write scopes. Railway release is verified separately after commit.
