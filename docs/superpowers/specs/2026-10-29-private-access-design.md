# Private deployment access

The user requested deployment of the Block-0 transfer update while preventing general public access. The existing target is Railway project `3d247cf8-7fd1-47e9-b689-31f5f4f9eb70`, service `vanity`, production, at `https://outsol.online` and its existing Railway alias. Keep its RPC configuration, persistent metadata volume and deployment topology.

Implementation choice: a shared password with an eight-hour signed session. A standalone `/access` page avoids mounting wallet providers before authentication. Store a scrypt password hash and an independent random session key in server-only Railway variables. Generate the password locally for the owner, never print or commit it. Signing keys for wallets are unrelated to website access and remain local to the browser.

Protect all application pages through Next Proxy and every private API handler through a shared server guard. Production fails closed if either required setting is absent or invalid. Login/logout require trusted explicit origins; password input and attempts are bounded. Cookies are host-only, HttpOnly, Secure in production and SameSite=Lax; changing either access setting invalidates sessions. The sign-in screen uses a real password field with no client-side password constant. Authentication and private responses must not be publicly cached.

Exact read-only health and immutable metadata/image endpoints remain public so Railway readiness and existing tokens keep working. Static rendering assets may remain public. There is no blanket API, extension, RSC or image-optimizer bypass. Existing X callbacks stay protected. Public source code stays public.

Alternatives considered: HTTP Basic authentication is smaller but browser credential caching makes explicit sign-out awkward. External identity login offers individual membership and revocation but adds an account provider and setup beyond this request. Shared-password sessions fit the requested small private deployment; the owner controls who receives the password.

Verification: unit and direct-route tests, actual standalone HTTP tests for pages/APIs/cookies/CSRF/public exceptions, full existing release checks, independent review, and post-deployment anonymous/authenticated checks on both domains. No funded transaction is part of deployment verification.

Release order: complete code and tests; configure the two new variables without deploying old code; commit reviewed sources; deploy the exact commit; verify protection before handing over the URL and locally saved password. Never push the legacy history referenced in DEPLOYMENT.md. Do not remove the volume or weaken RPC/origin checks.
