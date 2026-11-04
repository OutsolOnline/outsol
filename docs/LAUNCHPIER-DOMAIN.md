# LaunchPier domain connection

Prepared on 2026-11-04 against the existing Railway `vanity` production service. Both new custom domains target its existing port `3000`. No deployment, runtime-variable change, old-domain deletion, or nameserver change was performed during this preparation.

## Exact Namecheap DNS records

For `launchpier.net` on Namecheap BasicDNS, FreeDNS, or PremiumDNS, create these four host records:

- **ALIAS** — Host: `@`; Value: `ulf2a22w.up.railway.app`; TTL: 5 minutes.
- **TXT** — Host: `_railway-verify`; Value: `railway-verify=f115b16f2eb01193e5c2e713955b3a5e9b40b11cc540e184db74879dec85c2b2`; TTL: Automatic.
- **CNAME** — Host: `www`; Value: `mhek4sja.up.railway.app`; TTL: Automatic.
- **TXT** — Host: `_railway-verify.www`; Value: `railway-verify=8e023e5b840fd9366bd42e8ddcea51453d1bcc4e7c6018d7345a7061aff62ae4`; TTL: Automatic.

The TXT values are public domain-ownership verification records, not application credentials. Railway describes the apex traffic record as CNAME; Namecheap's ALIAS provides the supported root-domain equivalent. Replace only conflicting parking, A, AAAA, CNAME, or URL Redirect records for the same `@`/`www` host. Preserve unrelated email, verification, and other host records. The existing `www` value observed by Railway was `parkingpage.namecheap.com`.

Railway created `launchpier.net` as custom-domain ID `6280cb7d-72b1-4b8f-95ab-f6dd6d05dede` and `www.launchpier.net` as `278240eb-c14f-4395-9963-44a2e121cdd3`. Initial domain status: traffic records require update, ownership unverified, certificate validating ownership. A Railway `ACTIVE` sync status means its service configuration is synchronized; it does not prove DNS or HTTPS is ready. Recheck domain status and HTTPS after saving DNS.

Existing `outsol.online` and `vanity-production-2bbb.up.railway.app` remain attached to the service on port `3000` with `ACTIVE` sync status. Keep both working.

Public DNS verification on 2026-11-04: Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`) both returned the correct two verification TXT values and the correct `www` CNAME. The apex resolved to `69.46.46.67`, matching `ulf2a22w.up.railway.app`; the `www` Railway target resolved to `69.46.46.58`.

At **12:54:34 UTC on 2026-11-04**, strict HTTPS checks returned **200** for both `/api/health` and `/access` on all four domains: `launchpier.net`, `www.launchpier.net`, `outsol.online`, and `vanity-production-2bbb.up.railway.app`. Railway reported ownership verified and certificate status `VALID`/`COMPLETE` for both new domains. Its traffic-record display still showed stale parking/record status despite correct public DNS and successful HTTPS; no further DNS replacement is needed on that evidence. All four access pages still served the existing `Private access · OutSol` release, as expected before the reviewed LaunchPier source deployment. The new public-origin settings are ready to apply with that deployment after source checks pass.

## Runtime configuration after DNS and HTTPS verification

Use these public settings for the reviewed release:

```dotenv
APP_ACCESS_MODE=public
APP_ORIGIN=https://launchpier.net
PUBLIC_APP_URL=https://launchpier.net
APP_ADDITIONAL_ORIGINS=https://www.launchpier.net,https://outsol.online,https://vanity-production-2bbb.up.railway.app
```

`APP_ALLOWED_ORIGINS` remains supported for existing deployments. Its entries and `APP_ADDITIONAL_ORIGINS` share a combined limit of eight aliases and 4096 characters. Only exact configured HTTPS origins are accepted in production: paths, queries, credentials, wildcard hosts, empty entries, and malformed configuration fail closed. Request and forwarded-host headers cannot add an origin. Keep existing provider credentials unchanged. The public release explicitly sets `APP_ACCESS_MODE=public`; existing password/session values can remain stored but are no longer required.

`PUBLIC_APP_URL` controls newly generated public image/metadata URLs. Existing public asset routes and persistent storage stay intact. The primary metadata and extension destination use `https://launchpier.net`. The extension manifest needs no host permissions or remote connections for this change.

Register `https://launchpier.net/api/x/callback` exactly in the X Developer Console before changing `X_CALLBACK_URL` to that value. Until they match, retain the current callback configuration; X account connection must remain unavailable when setup is incomplete. Only X's explicit connection flow continues to its configured callback host. Other pages do not redirect legacy origins to the new domain.

## Browser data stays with its original site address

Wallets, drafts, browser storage, and host-only access/X cookies do not transfer between these addresses. Do not copy local storage across origins, export private keys automatically, or redirect existing users away from their stored data. Users may continue using their original address, or intentionally export a private backup there and import it on the new address.

Recommended notice on the new addresses:

> Your wallets and drafts stay in the browser and site address where you created them. Moving from OutSol or Railway? Open your previous address, save a private backup, then import it here. Existing addresses still work. Keep backups and private keys private.

## References

- [Railway custom domains, required ownership TXT, target ports, root aliases, and certificates](https://docs.railway.com/networking/domains/working-with-domains).
- [Namecheap ALIAS setup and conflicting host records](https://www.namecheap.com/support/knowledgebase/article.aspx/10128/2237/how-to-create-an-alias-record/).
