# Clerk authentication

## Architecture

The frontend remains a static Astro build. It uses bundled `@clerk/clerk-js` and `@clerk/ui`; the standalone Cloudflare Worker uses `@clerk/backend`. The Astro server-side adapter is not installed because this app does not run Astro SSR.

Clerk proves human identity. D1 separately decides which target and metric set that identity can read. Service-to-service MCP credentials remain separate and never become browser credentials.

Browser requests obtain a fresh Clerk session token and send it as a Bearer header. The Worker validates the token as a session token for the exact configured issuer and authorized frontend origin, rejects pending/machine sessions, checks the current Clerk session and user, and requires a verified primary email. Browser email fields, headers, metadata and role claims are not trusted.

Accepted client invitations bind to the Clerk issuer and stable user ID. A mutable email is only used to match a pending invitation at acceptance, not to rediscover grants. Admin eligibility is checked separately against the exact two approved verified primary-email addresses on each request.

## Configuration, disabled by default

Set server-side configuration in Cloudflare Workers & Pages → content-hub → Settings → Variables and Secrets:

- `CLERK_SECRET_KEY`: **secret**, from the deliberately selected Clerk application/instance. Never commit or expose it to browser assets.
- `CLERK_PUBLISHABLE_KEY`: plain-text public configuration for that same instance.
- `CLERK_ISSUER`: exact HTTPS Clerk Frontend API origin for that instance. It must match the publishable key's decoded instance host.
- `APP_ORIGIN`: exact HTTPS Content Hub frontend origin.
- `CLERK_AUTH_ENABLED`: initially `false`; enable only after deliberate setup and authorized tests.
- `ADMIN_ACCESS_ENABLED`: initially `false`, separately enabling only the two explicit verified operator identities.

The public `/api/auth/config` endpoint returns only the publishable key and frontend origin after validation. It never returns the secret. No key, user, session, app, or credential is created by build scripts. Do not run accountless CLI initialization against this existing project or silently switch Clerk applications.

For production, use an owned custom domain with DNS control and complete Clerk's production DNS/certificate setup. The default workers.dev URL is a deployment preview, not a substitute for that configuration. Development keys and issuers must not be silently mixed with production settings.

## Signup and authorization

Set Clerk **Invite-only** mode (`restricted` in its API), not open public signup. Disable unused enterprise/social enrollment paths and require verified email. These are deliberate account/security settings, not changes made by this code.

Do not use a Clerk domain allowlist to grant administrator status. Only `christian@unreelviews.com` and `marco@hexacombllc.com` are eligible in Content Hub, after verified identity and the admin gate. There is no public admin signup, promotion API, first-user administrator rule, or role inherited from accepting an invitation.

A Clerk account or Clerk invitation alone never grants Content Hub reporting access. A client must also accept the independently approved D1 invitation for the exact target/metric scope. If the recipient does not yet have a Clerk account, an operator must provision/invite them through the selected Clerk instance as a separate authorized onboarding step. This repository does not automatically create Clerk users or provider invitations.

## Safe cutover

Production contains no human accounts or real client data at the time of implementation, so this is a clean cutover rather than an account import. Migration 0006 adds stable identity bindings. Existing invitation rows without those bindings do not become authorized by matching email. Review/reinvite any such legacy records explicitly.

The old `/api/login/begin`, `/api/login/verify` and `/api/logout` routes are unavailable. Old `__Host-ch_session` cookies do not authenticate Clerk requests. There is no fallback to legacy authentication after a Clerk error. Historical tables may remain for migration safety but are not an authentication path.

Clerk sign-in is kept on the page when possible. Invitation tokens remain in memory only after their fragment is removed; a redirect or reload may require reopening the invitation. Tokens are never put into sign-in return URLs or browser storage. Viewing a link does not accept it; acceptance requires an authenticated, matching verified identity and an explicit POST.

## Email and CSP

Resend sends Content Hub invitation emails using the configured `RESEND_FROM`. Clerk handles authentication/verification email separately. The Resend key does not change Clerk's sender. The chosen setup uses Clerk’s default sender for verification/sign-in and Resend for branded Content Hub invitations. No email webhook or automatic provider invitation is included here.

CSP permits the exact configured Clerk instance origin plus Clerk's documented narrow `*.protect.clerk.com` abuse-protection namespace, `img.clerk.com`, and `challenges.cloudflare.com`. It does not allow arbitrary HTTPS origins. Clerk's documented protection connections can use nonstandard ports; `worker-src` permits same-origin and blob workers. UI is bundled locally. The invitation bootstrap retains its exact script hash rather than enabling unsafe inline scripts.

## Verification

Local tests use synthetic identities and mocked Clerk/mail adapters, never actual provider accounts or credentials. Verify wrong issuer/authorized party, pending/revoked sessions, unverified email, changed identity, old cookies, cross-target grants, replayed acceptance, exact admin allowlist and disabled gates. Live sign-in, production domain configuration and delivery require explicit operator setup and approved test identities.

Official references:
- https://clerk.com/docs/js-frontend/getting-started/quickstart
- https://clerk.com/docs/reference/backend/authenticate-request
- https://clerk.com/docs/guides/development/making-requests
- https://clerk.com/docs/guides/secure/restricting-access
- https://clerk.com/docs/guides/development/deployment/production
- https://clerk.com/docs/guides/secure/best-practices/csp-headers
