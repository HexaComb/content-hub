# Private client portal

Static Astro UI served on the same origin as the Worker API. From the repository root:

```
ASTRO_TELEMETRY_DISABLED=1 npx astro build --root ./web
npx tsc --noEmit -p web/tsconfig.json
node --test web/tests/format.test.ts
```

Pages: `/` is the authenticated report or email sign-in; `/invite#token=…` explicitly accepts a scoped invitation and verifies the recipient; `/demo` is a clearly labeled, disconnected synthetic design preview. No real credentials or client fixtures are included.

The fragment is captured and removed synchronously in the invitation head before the page loads other resources. It is retained only in memory, never query strings or browser storage. No GET consumes an invitation. Codes are 16 lowercase hex characters. All business values are rendered as text, not HTML. API requests use same-origin cookies with no-store; errors and navigation clear old report content. Data writes and publication controls do not exist in the UI. Reporting is a two-period comparison, not fabricated trend history.

Server integration must protect API routes and set `Cache-Control: private, no-store` for authenticated responses. Configure a strict Content Security Policy with an exact hash for the inline invitation bootstrap (do not disable it); no third-party scripts, fonts, images or analytics are required. Referrer policy is also set in document metadata. Deployment, email delivery and cookie behavior require actual backend integration tests.

## Browser verification

`tests/browser-qa.mjs` starts its own local static server, uses only synthetic data and mocked APIs, and saves screenshots under `tests/artifacts/`. Run with an installed Playwright module and local Chromium:

```
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node web/tests/browser-qa.mjs
```

It covers responsive layouts, target/month changes, fragment clearing, explicit invitation acceptance, duplicate click protection, invalid-code retry, sign-out, repeat email login, email restart, interruption/reload, and browser errors. A backend end-to-end test must separately verify authorization, revocation, email delivery and cookie attributes.
