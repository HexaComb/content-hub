# unreel content

Private client portal.

Static Astro UI served on the same origin as the Worker API. From the repository root:

```
ASTRO_TELEMETRY_DISABLED=1 npx astro build --root ./web
npx tsc --noEmit -p web/tsconfig.json
node --test web/tests/*.test.ts
```

Pages: `/` is the authenticated report or Clerk sign-in; `/invite#token=…` previews and explicitly accepts a scoped invitation after matching verified Clerk authentication. No sample-data route, real credentials, or client fixtures are included.

## Clerk integration

The static app fetches runtime public configuration from `GET /api/auth/config` (`provider`, `publishableKey`, `frontendApiUrl`). It validates an HTTPS FAPI origin matching the public key before initialization. No real public key is built into the site. Missing configuration produces an explicit unavailable state, not a claim that email was delivered.

Core 3 `Clerk` and the supported separate `ui` export are dynamically imported from the installed `@clerk/clerk-js` and `@clerk/ui` packages and bundled locally. `clerk.load({ui})` initializes the client. Sign-in uses the mounted Clerk component, no custom OTP code, with sign-in-or-up and automatic account transfer disabled and no sign-up promotion. Identity creation never grants project access; server authorization remains authoritative. Clerk instance sign-up policy must also be configured appropriately by its administrator.

Each API request obtains a current `clerk.session.getToken()` and sends it as a Bearer header only to local `/api/` paths. Application code does not persist tokens. Clerk manages its own authentication state. Sign-out calls Clerk directly. Session changes clear prior reports and reload authorized targets.

Invitation fragment capture and removal run synchronously in the document head, before loading Clerk. The invitation stays only in application memory, never query strings or browser storage. After sign-in, authenticated `POST /api/invitations/begin {token}` returns the recipient-matched target, metric IDs, role and access expiry for review. An explicit click then sends `POST /api/invitations/accept {token}`. No GET accepts an invitation. Redirects use fixed token-free same-origin paths; when authentication redirects/reloads, the user is instructed to reopen the original email link after sign-in. Invalid/mismatched/expired/revoked invitations do not expose a scope or acceptance button. No business data writes or publication controls exist.

Server integration must authenticate every protected route, set no-store on private responses, and configure Clerk CSP using exact approved FAPI origins and documented required services. The inline invitation bootstrap requires an exact script hash. Clerk UI uses inline styles. Application content is rendered through text nodes. The UI has no analytics and disables Clerk SDK telemetry; identity-provider network services are now required for real sign-in.

References verified for this implementation:
- https://clerk.com/docs/js-frontend/getting-started/quickstart
- https://clerk.com/docs/guides/development/making-requests
- Installed package exported types for `ui`, `mountSignIn`, `withSignUp`, `transferable`, `forceRedirectUrl`, `addListener`, `signOut`, and `getToken`.

## Verification

Unit tests cover exact runtime issuer validation, fresh per-request Bearer tokens, local-route restrictions, absence of legacy OTP/storage code, and numeric report formatting. `tests/browser-qa.mjs` starts a local static server, uses synthetic data and mocked unconfigured-auth responses, and writes screenshots under `tests/artifacts/`:

```
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node web/tests/browser-qa.mjs
```

The browser suite covers empty portal layouts, unavailable authentication, fragment clearing, retry, and interrupted invitation reload. It does not validate a live Clerk application. Browser execution was previously blocked by the environment's socket restrictions and has not been retried for this migration. Real sign-in, provider redirects, CSP compatibility, signed-out/repeated flows and authenticated invitation acceptance require an authorized configured Clerk test environment before production deployment.
