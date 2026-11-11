# MCP OAuth connection

The Worker supports the official `@cloudflare/workers-oauth-provider` 1.2.4 with authorization and resource roles in the same deployment. Existing business writes still use the stateless MCP server and D1 repositories. Clerk authenticates the person approving a connection; a Clerk session is not an MCP bearer token.

## Disabled until separately configured

`MCP_OAUTH_ENABLED` must be exactly `true`, `OAUTH_KV` and D1 must be bound, canonical `APP_ORIGIN` must be `https://content.unreelviews.com`, and administrator authentication must be configured and enabled. Otherwise OAuth discovery/token/data access fails closed. The static `/authorize` shell can render an explanation while disabled. Legacy service credentials remain a separate path only while OAuth is disabled; enabling OAuth never falls back to them.

No client, key, secret, principal, tenant, operator mapping or grant is created at import/startup, login or consent preview. Application code does not offer public client registration or admin signup. No production OAuth access is implied by deploying these files.

## Infrastructure and controlled bootstrap

1. After reviewing destination and approval, create a dedicated Workers KV namespace and bind it as `OAUTH_KV` using cf/config. Add `global_fetch_strictly_public` to the compatibility flags for safe Client ID Metadata Document fetching. Do not generate an application client secret for CIMD.
2. Back up the selected D1 database and apply migration 0007 using migration bookkeeping. It preserves principal/audit foreign keys and adds `auth_kind`. OAuth principal `token_hash` is a unique, 64-character, non-hex `oauth:` identifier marker, not a credential; static SHA-256 bearer authentication cannot match it and explicitly excludes the OAuth kind.
3. Obtain the intended agency/tenant name and exact verified Clerk issuer and subject. An administrator allowlist match alone is not an OAuth tenant mapping. Create the tenant if approved, then a single explicitly approved `oauth_operators` row with exact verified primary email, permitted scopes, expiry and no revocation. Operator IDs must not contain `:` (the OAuth provider uses that delimiter). No automatic mapping for the other administrator occurs.
4. For existing business clients, explicitly populate `oauth_operator_clients` for this operator. An empty workspace needs no client rows or grants. A connectivity-only grant can discover eligible tools but cannot read client names. Add explicitly approved `clients:read` to request an empty client list.
5. Review exact access and duration immediately before granting persistent access. Enable OAuth only after configuration/migration readiness. Open custom app setup at `https://content.unreelviews.com/mcp` in the supported client UI. The server verifies the actual client's metadata and exact callback; do not guess callback URLs or create credentials on its behalf. If the client lacks CIMD, its actual registration requirements need a separate reviewed change.
6. Sign in as the mapped operator, review the client domain/callback host, agency, scopes, named clients and duration, then explicitly approve. Writes, offline access and individual clients start unchecked. `clients:write` separately authorizes creating new clients and gaining access to those new clients, never all existing clients.

The current Clerk development instance is for testing. Production identity configuration and its activation remain separate decisions. A successful synthetic protocol test is not proof that the real ChatGPT custom app is connected.

## Routes and limits

- Issuer: `https://content.unreelviews.com`.
- Resource: `https://content.unreelviews.com/mcp`.
- Authorization server metadata: `/.well-known/oauth-authorization-server`.
- Resource metadata: `/.well-known/oauth-protected-resource/mcp`.
- Consent: `/authorize`, HTML shell or authenticated JSON GET/POST. `/authorize/` navigation is also supported; API requests normalize internally to `/authorize` without redirects or changing the opaque query.
- Token and RFC 7009 revocation: `/oauth/token` (provider-managed).

Require authorization code with S256 PKCE. Tokens are bound to the canonical resource and client. No implicit flow, public DCR, external-token fallback, token exchange or cross-client exchange is enabled. Token/revocation POST bodies must be URL-encoded and are capped at 16 KiB by counting actual streamed bytes before provider parsing, independently of Content-Length.

Available scopes are `mcp:connect`, `clients:read`, `projects:read`, `projects:write`, `metrics:read`, `metrics:write`, `content:read`, `content:write`, `clients:write`, and `offline_access`. Only requested scopes within the live operator ceiling may be granted. Clients may initially request only `mcp:connect`. OAuth tool discovery advertises the live operator ceiling, with top-level `securitySchemes` and `_meta.securitySchemes`. Missing granted scopes produce an MCP `_meta["mcp/www_authenticate"]` step-up challenge before any business callback, naming required scopes and canonical resource metadata. The client then reauthorizes with the desired exact scopes; initial tokens are never silently expanded. `list_clients` requires `clients:read`, so baseline discovery reveals tool capabilities but no client data. Static-service tool visibility is unchanged. Access tokens last 15 minutes. For bounded operators, an explicitly selected `offline_access` allows refresh for at most seven days, further bounded by operator and delegation expiry. Explicit ongoing operator eligibility and a new ongoing consent instead permit a 30-day sliding inactivity window, as described below. Without it the delegation lasts 15 minutes and the provider issues no refresh token. The displayed grant expiry is an upper bound based on the proposal; deselecting offline access shortens it.

Invitation management/sending, content approval/scheduling and publication receipts are deliberately absent from this first OAuth scope allowlist. No OAuth approval authorizes an email or external publication. `INVITATIONS_ENABLED` remains independently disabled.

## Consent and authorization enforcement

Consent uses the official provider's validated request, escaped metadata, browser-bound cookie and one-use handle. D1 adds an atomic one-use handle hash bound to the exact signed-in issuer/subject/operator and requested scopes. POST checks same origin, current Clerk identity and live operator policy again. No tenant/principal/role is accepted from browser JSON. Consent takes at most ten minutes; approval does not run automatically after sign-in.

Each approved connection gets a separate OAuth principal and delegation, with only selected client grants. Every request intersects verified token scopes with live principal and operator scopes, checks expiry/revocation, and verifies OAuth client and operator identity. Every business-client access also intersects the live operator-client map. Newly created clients add only their own operator mapping and principal grant in the existing atomic, audited `create_client` transaction.

To stop a connection immediately at application level, set its `oauth_delegations.revoked_at` through an approved operator process; the resource path and refresh callback check it. Revoke the provider grant too using `oauth_grant_id` and operator ID through a reviewed secure operator tool, or use the client's standard disconnect/revocation flow. No arbitrary admin SQL endpoint is exposed. Do not promise that deleting a browser app alone revokes server tokens. To remove one client's access, remove its operator-client map; copied grants do not override that removal. Preserve audit rows.

## Verification

`npm run check` includes D1 and provider workerd tests. Synthetic fixtures use isolated local KV/D1 and an injected trusted identity resolver, never production credentials or Clerk users. The fixture client-creation path exists only in `tests/fixtures/oauth-worker.ts`, which is not a production entrypoint. Tests cover discovery, S256, redirect/resource rejection, consent scope escalation, cookie binding, replay, code exchange, refresh, principal kind isolation, expiry/revocation and client mapping removal/new-client behavior. Existing human-auth tests cover verified primary email, issuer, actors and active Clerk sessions.

After deployment, verify the exact release, disabled/anonymous failure modes and metadata. Only after approved live consent verify initialize, tools/list and a harmless read. Report live connection separately from local protocol tests.

Official reference: https://github.com/cloudflare/workers-oauth-provider/tree/main/docs

## Connection recovery

A 401 on the consent request means human authentication could not be verified. A 403 is a separate authorization rejection: the account may lack a current OAuth workspace mapping, that mapping may have expired, or the requested scopes may exceed its approved ceiling. Signing in again does not renew a mapping or add permissions. Check its exact approved scope and expiry, obtain any required approval for a renewal, and restart the connection. The consent UI distinguishes these cases without exposing raw provider errors.

## Optional ongoing connections

Migration 0013 adds `connection_mode` with a `bounded` default. Applying it and deploying code does not renew, upgrade or extend any operator or delegation. Existing 15-minute and seven-day connections retain their original deadlines. An administrator must obtain explicit approval naming the verified operator, receiving application, selected clients, scopes and ongoing duration before setting that operator's mode to `ongoing` and including `offline_access` in its ceiling. For an ongoing operator, the legacy `expires_at` field is retained for history but no longer sets the operator's outer deadline; `revoked_at`, mode and live scopes remain authoritative. Downgrading to bounded immediately invalidates ongoing delegations.

The app must then initiate a new authorization requesting `offline_access`. Consent labels that permission **Keep connected until I revoke access**, starts it unchecked, explains the 30-day inactivity limit and shows the receiving app and named clients. Old consent forms cannot silently accept this new duration. The proposal stores its displayed deadline; changing operator policy while the form is open cannot lengthen that proposal. Leaving persistence unchecked creates only a 15-minute, non-refreshable connection.

Access tokens remain at most 15 minutes. For newly consented ongoing grants only, each successful refresh authorization extends the provider grant and D1 delegation/principal idle deadline by 30 days. Activity alone does not extend it: the client must perform OAuth refresh and safely replace its stored refresh token. A connection unused for 30 days needs fresh sign-in and consent. Client grants, action scopes, tenant, operator identity and revocation are rechecked at every refresh and MCP request. This feature adds no all-client access, invitations or publication authority.

The official provider rotates refresh tokens. Version 1.2.4 permits the immediately previous token for retry compatibility; this is not strict single-use refresh or automatic theft/reuse detection. Older tokens fall out of that pair after subsequent current-token refreshes. Do not log tokens or expose them to an agent's prompt. Transient D1 refresh failures return a retryable error rather than revoking an otherwise valid grant.

## Disconnect and audit

`/connections` lets a verified person list only their own authorizations and disconnect one explicitly. Ownership uses the exact verified issuer, subject and primary email, even when their operator authorization has expired or been revoked. Lists are cursor-paginated, so old authorizations remain reachable. The page reports workspace authorization, not proof that provider tokens still exist: app-side revocation or provider replacement during reauthorization may retire tokens first.

The same-origin POST `/api/oauth/connections/{id}/revoke` marks D1 delegation/principal access revoked before asking the provider to remove tokens. Every MCP read and write fails closed from that D1 state even if provider cleanup fails. The page offers a separate retry for pending token cleanup. Requests from other users, foreign origins or unverified sessions cannot revoke a connection. No management endpoint creates grants, adds clients, changes scopes or extends access.

Append-only `oauth_connection_events` record consent, refresh authorization, self-service revocation and failed issuance without tokens. `refresh_accepted` records authorization of a refresh, not proof that its token response reached the client. `oauth_operator_policy_events` capture changes to mode, scopes, expiry and revocation. Provider-internal replacement/revocation does not currently emit a corresponding D1 event, so do not treat this audit as a complete provider-token ledger. Existing audit and business data are preserved.

## Ongoing rollout verification

Run all synthetic protocol and UI checks before publishing. Retain a D1 recovery bookmark, apply the additive migration with bookkeeping, deploy the exact checked commit, and verify bounded modes and unchanged live expiry/scopes afterward. Activation for a real operator is a separate approved action. After the user consents in Muse, verify a genuine refresh exchange and a harmless tool read after the first access token has expired. Muse platform metadata advertises refresh support, but a successful initial connection alone does not prove that a custom/mobile connector handles rotation correctly. Do not issue or read live credentials for this test without authorization.
