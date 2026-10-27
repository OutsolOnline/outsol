# Connect X to OutSol

The X page supports public post import without a connected account. Connecting an account is optional and remains unavailable until the owner supplies the server configuration below. No placeholder credentials, shared account, or browser token fallback is used.

## Owner setup

1. Open the [X Developer Console](https://developer.x.com/) and select the application that should authorize OutSol. Enable OAuth 2.0 user authentication with **Web App** as the confidential client type. Select read permissions; the integration requests only `tweet.read`, `users.read`, and `offline.access`.
2. Register this callback URL exactly: `https://outsol.online/api/x/callback`. Set the website URL to `https://outsol.online`. A similar URL, trailing slash, alternate domain, or different path will not match.
3. In the existing Railway `vanity` service's production variables, enter `X_CLIENT_ID` and `X_CLIENT_SECRET` from that application's OAuth 2.0 Keys and Tokens section. Enter them privately in Railway, never in chat, source files, a `NEXT_PUBLIC_` variable, or a browser form.
4. Set `X_CALLBACK_URL=https://outsol.online/api/x/callback` and `X_STORAGE_DIR=/data/vanity-x`. Keep the existing `/data` volume and `/data/vanity-assets` public metadata directory. Keep this service at one instance. The application prepares the private directory as UID/GID 1001 with mode `0700`; encrypted credential files use mode `0600`.
5. If `X_TOKEN_ENCRYPTION_KEY` has not already been provisioned, privately generate 32 cryptographically random bytes, encode them using standard base64, and save the result as that server variable. The application deliberately does not generate or replace this key. Preserve a secure backup and keep it unchanged across deploys. It must be independent of RPC credentials and wallet passphrases.
6. Deploy the reviewed integration with those runtime variables. Missing or malformed configuration returns an unavailable connection state; building the application needs no X credentials. Open `https://outsol.online/x`, choose **Connect X**, review X's requested read access, and authorize using your own account. Connection from the Railway domain first continues to the canonical OutSol domain so its host-only cookie returns to the same host.

X API access and the X developer account's billing/access settings remain the owner's responsibility. X currently uses prepaid, pay-per-usage credits; choose an explicit spending limit in the developer console before enabling account reads. This does not change OutSol’s 0% platform fee. See the [official X pricing](https://docs.x.com/x-api/getting-started/pricing), checked 27 October 2026. OutSol does not buy credits or enable automatic recharge. This implementation makes one authenticated profile request after a user explicitly connects; it does not poll profiles. Authenticated post retrieval happens only when requested in the product. No real-account login, paid API request, or external configuration change is part of automated tests.

## What persists

The browser receives only opaque, random, `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookies. OAuth state and PKCE verifiers expire after ten minutes and are consumed once. The pending cookie expires naturally or is cleared by disconnect; callbacks leave it alone so an older response cannot erase a newer authorization's cookie. Starting a new authorization cancels the previous flow, and matching callback errors cancel their flow before returning. Successful authorization rotates the session handle. Sessions expire absolutely after seven days; expired access tokens refresh on demand without extending that deadline. Closing/reopening the browser or restarting the service can retain the connection while the cookie, private volume, and encryption key remain available.

Access/refresh tokens and pending verifiers persist only in the separate private directory, authenticated and encrypted with AES-256-GCM and a fresh nonce for every write. They never enter token metadata, public asset routes, browser storage, wallet storage, RPC requests, or frontend responses. Profile identity retains X's protected-account flag; later public post import still enforces the public-content policy.

Writes use private temporary files and atomic replacement. State claims and refresh operations are serialized across this process's route modules; Linux state claims also use atomic rename. Encrypted flow-control records last up to ten minutes after completion/cancellation, so disconnect can cancel an outstanding callback or remove its newly committed session before the new cookie arrives. These control records contain no provider tokens or PKCE verifier. Storage is capped at 2,000 files and 32 MiB, including those records. Expired entries are reclaimed during reads/writes. Existing deployment limits assume one Node process and one Railway replica. Scaling requires a transactional shared store and shared quotas first.

All authentication routes return `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The callback validates the original cookie, single-use state, expiry, and S256 PKCE rather than rejecting X's legitimate cross-site navigation. It immediately redirects to a fixed `/x?connection=connected`, `cancelled`, or `error` URL, removing code and state from the displayed address.

## Disconnect and recovery

Disconnect deletes local stored credentials and clears both cookies, then attempts to revoke both tokens with X. `providerRevoked: true` means both revoke requests succeeded; `false` means remote revocation was not confirmed. If X is unavailable, revoke the application independently under [X connected apps](https://x.com/settings/connected_apps).

A lost encryption key cannot decrypt existing connections; changing the key requires disconnecting/reconnecting users and securely retiring the former private connection files. Do not remove or alter the public asset directory while handling auth recovery. This does not affect browser wallets or their offline backups. Back up the private volume and key separately under appropriate access controls.

For connection errors, check privately that all five `X_` variables exist, the callback exactly matches X's registration, the app is a confidential Web App, requested read scopes are enabled, and the private directory is writable by UID 1001. Do not copy variable values or raw OAuth responses into logs or support messages. Provider errors are intentionally sanitized; callback errors ask the user to reconnect.

Protocol references: [X authorization code and PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [confidential clients, refresh, and revocation](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token).

## This deployment

Confirmed launches also include an editable announcement and **Review & post on X**. That opens X's own composer, where the user reviews the message and chooses Post. It does not publish automatically, require API write permissions or depend on this OAuth setup. Nothing is posted during OutSol's launch transaction.

The canonical callback URL, isolated private storage directory and a new server encryption key have been provisioned privately for the existing Railway service. No client ID or client secret has been supplied, so customer account connection remains accurately unavailable. Create the developer app, register the exact callback and add those two credentials privately in Railway to activate it. Do not replace the prepared encryption key. Public post import works independently. Live account authorization and paid authenticated endpoint compatibility must be verified after setup; mocked protocol tests do not replace that check.
