# Scoped client invitations with Resend

## Status and intended experience

**Design only, not implemented.** This document does not create credentials, send email, grant access, or install migrations. The current backend has service principals, tenant/client grants, metrics, typed projects and project-to-metric links, plus client/project and content-workflow writes through MCP. The workspace model includes immutable project kind `instagram_account | one_off_project` and a required `platformAccountRef` for Instagram accounts. That typed project is the exact access target; a separate accounts table is not required. Human login, browser sessions, invitations, Resend transport and recipient grants remain unimplemented. Existing service credentials and client grants must not be reused as browser invitations.

An authorized agency operator selects a recipient and either an Instagram account or a one-off project, previews exactly what will be shared, then explicitly approves the invitation and its read-only access. The recipient follows an email invitation, signs in with a verified matching email, and accepts access to that resource's metrics. Being invited to one resource never grants access to the whole client, its other accounts, or other projects.

Resend is the email transport. It is not the identity provider or the authorization system. Public source code is compatible with private records: all real data, recipient identities, invitations, sessions, secrets and access checks remain server-side.

## Resource and identity model

Reuse the typed project model and add the human-access tables in a separately reviewed future migration. This is a logical schema, not executable SQL:

- Existing `projects` is the resource table: `(tenant_id, client_id, id)` identifies either an Instagram account (`kind = instagram_account`) or a one-off project (`kind = one_off_project`). Kind is immutable. Instagram targets require `platformAccountRef`; treat this as an external account reference, never a credential. Use a stable provider account ID where available and keep a display handle separately because handles change. Project ID, not a mutable handle or `content_items.account_ref`, is the authorization identifier. Resolve legacy references explicitly; never infer ownership from a matching handle.
- Existing `project_metrics` links each typed target to its metrics using same-tenant/client composite foreign keys. Keep explicit approved mappings for Instagram accounts as well as one-off projects; never infer permission from client membership or the metric category.
- `human_users`: stable internal ID plus unique `(identity_issuer, identity_subject)`. Store verified email and verification time from the chosen trusted identity provider. A client-submitted email or display name is never proof of identity. Account linking needs its own verified flow.
- `invitations`: opaque ID, tenant/client, one typed project ID, normalized recipient email, fixed role `metrics_viewer`, token hash, expiry, creator, approval actor/time, immutable approved payload hash, accepted user/time, revoked actor/time, and creation time. Composite foreign keys enforce the same tenant/client. Token hash is unique. The raw token is never stored in this table.
- `resource_grants`: ID, human user, tenant/client, one typed project ID, fixed role `metrics_viewer`, originating invitation, approved scope snapshot, creation time, optional expiry and revocation actor/time. Composite foreign keys and typed target checks match invitations. Prevent duplicate active grants for the same user/resource. Invitation acceptance must never insert a `client_grants` row.
- `invitation_deliveries`: invitation ID, send operation ID, provider message ID if known, delivery state, attempts and timestamps. Sending and access state are separate: provider acceptance is not delivery, verification or membership.
- `access_audit`: actor, invitation/grant ID, tenant/client/resource, action, timestamp and approved payload hash. Record approval, send outcome, acceptance, expiry, revocation and denied access without raw tokens, session cookies or credentials. Restrict audit access and retention.

Use a composite foreign key to the existing typed `projects` target rather than an unchecked polymorphic `resource_id`. Read its immutable kind from the database; never trust a caller-supplied resource kind. Every lookup and relationship must bind tenant and client as well as resource ID. New human identities must not automatically receive organization membership or agency privileges.

### Metrics must be safe to share

A grant permits only metric definitions and observations explicitly linked to its selected resource. It does not permit the enclosing client-wide metric list, other project names, internal descriptions, drafts, captions, assets, source credentials, raw ingestion payloads or administrative audit records. Build an allowlisted reporting DTO, including only approved labels, units, periods, values, quality and safe provenance fields.

Existing metrics are client-scoped. Before enabling invitations, review and explicitly map each shareable metric to an account or project. A metric that mixes several accounts cannot become safe by linking it to just one account: create independently scoped definitions/observations or withhold it. Do not expose historical observations whose underlying scope differs from the resource. Unknown or unmapped metrics fail closed. If a metric legitimately belongs to two resources, granting either resource reveals that metric; the operator must review this before sharing.

Membership grants cover the approved resource's reporting history and future approved metrics, not a frozen PDF. Explain that ongoing scope in the confirmation. Linking a new metric to an already-shared resource expands the data recipients can see and requires an explicit data-sharing review. Reparenting resources, changing their ownership, or changing an Instagram target’s platform account reference must revoke or reapprove grants, not silently carry access to a different account or client. Bind the platform reference and target revision in invitation approval so stale pending invitations fail closed after such a change.

## Approval and redemption flow

1. **Prepare:** An authenticated operator with explicit invitation-management authority selects one recipient, tenant/client and account/project. Server-side checks prove the operator can share that exact resource. A general service `metrics:write` scope must not imply permission to invite people.
2. **Review and approve:** Display the exact recipient email, resource identity/name, reporting coverage, read-only role, optional access end date, invitation expiry and email preview. State that Resend will receive the address and invitation email, including its redemption link. Require explicit approval of sending and the resulting scoped access before either occurs. Bind approval to an immutable payload hash; a recipient, scope, role, expiry or message change invalidates it. The present feature request is not permission to send actual invitations or grant any named person access.
3. **Issue:** After approval, generate at least 32 cryptographically random bytes, encode as base64url and store only SHA-256 of the token. Proposed default invitation lifetime: 48 hours, configurable by operator policy. Include an opaque invitation ID and token in an HTTPS redemption link. Never put account IDs, email addresses or metric values in the link. A forwarded invitation alone cannot grant access.
4. **Send:** Use server-side Resend with the approved recipient and minimal transactional message. No metrics, private account handles or confidential project names in the subject; use neutral wording unless the exact disclosure was approved. Escape all template variables and generate links from the configured app origin, never from request Host headers. Persist the logical send operation before calling the provider; distinguish accepted, failed and uncertain results.
5. **Open safely:** GET renders a generic landing page and never consumes the token, creates membership or auto-signs in. Email scanners must not redeem invitations. Disable third-party analytics and click tracking on the invitation flow; use `Referrer-Policy: no-referrer`, no-store responses, token-redacted server/access logs and a clean URL after a secure server-side exchange into a short-lived protected redemption session. Do not put the token in localStorage.
6. **Verify identity:** Require the selected human login system. Validate issuer, audience, signature, nonce/state and verified email claim as applicable. The verified email must match the invitation under a documented consistent normalization policy; do not strip plus aliases or dots. If the provider cannot attest to the specific email, independently verify that address before proceeding. A different signed-in email must switch accounts or request a newly approved invitation. Do not silently retarget invitations.
7. **Accept:** Show the target and role only to the matching verified identity. A CSRF-protected POST explicitly accepts. Atomically validate token hash, expiry, non-revocation, non-consumption, approved payload, resource availability and unchanged Instagram platform account reference, and current inviter authority, then consume the invitation and create its read-only grant. Choose and test a D1-supported transactional/atomic pattern before implementation. A read-then-write sequence without concurrency protection is insufficient. Two simultaneous requests must yield one grant; retries from the same identity may return an already-accepted receipt, never a new or broader grant.
8. **Read:** Each reporting request authenticates the human session and checks the current resource grant on the server. Apply the same predicate to discovery, metric details, comparisons, exports and any future API. Do not rely on hidden navigation or a resource ID in the URL. Never send a privileged service bearer token to the browser.

Use Secure, HttpOnly, appropriately SameSite cookies, bounded session lifetimes, login/session rotation, CSRF protection and rate limiting on login, send and redemption. Unauthorized resource IDs should return a non-enumerating response. Admin invitation lists are not publicly searchable.

### Delivery retries and token storage

Resend's send API supports an idempotency key, but its documented retention is only 24 hours. Maintain durable application receipts beyond that period; do not blindly resend after an uncertain result or assume a timeout means no email was sent. A send operation's key and payload must remain stable on retry.

Only the token hash belongs in application records. The raw token is briefly in server memory and necessarily in the email sent through Resend. Do not persist plaintext email bodies or tokens in a durable outbox, logs, error traces or audit records. In the first implementation, send synchronously after persisting the invitation and operation receipt. If a crash loses the raw token, do not try to reconstruct it from its hash. Reconcile the original operation where possible; otherwise an explicitly approved replacement revokes the old invitation and creates a fresh token. A future durable email queue would require a separately reviewed encrypted, short-lived payload design and key management.

## Revocation and least privilege

- Cancelling a pending invitation marks it revoked immediately. Resending creates a new token and invalidates the previous invitation; it does not extend or broaden approval silently.
- Revoking an accepted invitation must revoke its resulting grant as well. The UI must distinguish pending invite cancellation from access removal and show all active grants for that person/resource. Independent grants remain visible so an operator can remove all intended access.
- Revocation is enforced on the next request, not just at the next login. Do not embed long-lived resource permissions in session tokens. Invalidate authorization caches immediately or avoid them initially. Private responses use no shared CDN cache.
- Grant expiry is distinct from invitation expiry: an accepted invite expiring does not terminate ongoing access unless the approved grant has its own end date. One-off projects may use an explicitly approved access end date; project completion alone must not invent a retention policy.
- Recipient role `metrics_viewer` cannot invite others, change data, configure integrations, manage clients or invoke content publishing. Agency invitation-management authority is a separate privilege.
- No anonymous report links, public bucket exports or unrestricted shared dashboards. Downloads must recheck authorization; already-downloaded copies cannot be revoked, so make export availability an explicit product decision before enabling it.

## Setup required before any live invitation

1. Verified sending domain in Resend and an approved From address on that domain. Domain/DNS changes require their own authorized setup. Keep development/test delivery separate from live recipients.
2. A Resend API key limited to `sending_access` and the intended domain. Supply it through secure server-secret setup only, never chat, source control, browser code or a public build variable. Creating/configuring persistent credentials requires explicit approval at setup time. No key is created by this document.
3. Canonical HTTPS application URL, allowed authentication callback URLs, deployment isolation, private D1 binding and secret storage. A working backend alone is not a deployed reporting portal.
4. A chosen human authentication provider/library and verified-email flow. Select and implement this before invitations ship; Resend does not replace it. Keep human sessions separate from existing MCP service authentication.
5. Explicit recipient and resource confirmation, authorization of email transmission and scoped access, reporting-data review, expiry policy and sender identity. Use synthetic records for tests.
6. Reviewed migrations, scoped report endpoints/UI, administrative approval/revocation UI, delivery handling and security tests. Existing project support does not supply these pieces automatically.

## Implementation sequence and acceptance checks

1. Finish typed Instagram account/one-off project identity and explicit metric mappings with tenant/client constraints; review legacy data before sharing it.
2. Add human authentication/session handling and deny-by-default resource authorization. Keep invitation functionality disabled until this layer is tested.
3. Add approved invitations, atomic acceptance, grants and revocation; test locally using fake mail transport.
4. Add Resend transport and neutral templates behind a disabled-by-default feature flag; configure secrets only after authorized setup.
5. Add client-facing reports scoped to exactly the chosen resource, then test staging with approved test recipients before live use.

Required checks:

- A viewer of Instagram account A cannot list or fetch account B, sibling projects or unrelated client records, including guessed IDs and direct export URLs.
- A one-off project viewer sees only explicitly linked safe metrics, not the enclosing account/client totals. Tenant/client mismatches fail at both authorization and relation validation.
- Wrong or unverified email, expired/revoked/reused tokens, tampered scope, removed inviter authority and archived/removed target fail closed.
- Email scanner GETs do not accept invitations; double acceptance and replay do not create duplicate grants.
- Send failure/timeout/crash does not create access, duplicate delivery automatically or leak tokens. Delivery notifications never create membership.
- Scope edits after approval require new approval; newly linked metrics receive sharing review. A stale browser view cannot bypass revocation.
- No secrets or real records in Git, test fixtures, build output, public Pages/assets, response caches, analytics or logs. Verify browser bundles contain neither the Resend key nor service credentials.
- UI tests cover resend, cancel, wrong account, login interruption, expired link and access removal. Provider webhook support, if added, must verify signatures and handle duplicate/out-of-order events.

## Verified Resend references

Official documentation checked 2026-11-10:

- [Send Email](https://resend.com/docs/api-reference/emails/send-email): transactional send endpoint accepts sender, recipient and email content; supports an idempotency key with a documented 24-hour lifetime. Provider response is not evidence of recipient identity or access acceptance.
- [Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key): documents restricted `sending_access` keys and domain restriction. Use this for minimum-privilege server setup, not a full-access key.

These references verify transport capabilities only. No live Resend integration, domain verification, sending test, credential provisioning or recipient invitation has been performed for this design.
