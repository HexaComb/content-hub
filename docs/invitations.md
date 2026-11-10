# Private client invitations

## Implemented, disabled until configured

The Astro portal, Resend transport, invitation lifecycle and passwordless email verification are implemented. Live mail is disabled by default. No sender, Resend key, recipient or agent credential is included. Local tests use synthetic records and fake mail only.

A recipient receives read-only access to one Instagram account or one-off project and a frozen set of approved metric IDs. The accepted invitation is the grant. Acceptance never creates a service principal or client-wide membership. Browser sessions and MCP bearer credentials are separate.

## Operator workflow through MCP

1. `prepare_invitation` requires `invitations:manage` plus the client's grant. Supply one recipient, one target, explicitly mapped metric IDs and an access expiry no more than one year away. The result previews the exact recipient, target revision, metric set, expiry, email and Resend disclosure, with an approval digest. No message or access grant is created.
2. After explicit approval of those facts and ongoing read-only access, call `send_invitation` with `invitations:send`, the digest and `explicitlyApproved: true`. It revalidates the target and sends a neutral email. This feature request alone never authorizes invitations to real people.
3. `list_invitations` reports status without tokens. `revoke_invitation` cancels a pending invitation or its accepted access. Independently approved grants survive, so review all grants when removing a person's access.

An agent must obtain actual user authorization; the boolean is an attestation, not a human approval system. The API cannot determine whether an external agent honestly obtained it.

## Recipient flow

- The link uses an unguessable 32-byte token in a URL fragment. `/invite` captures it in memory and immediately removes the fragment. There is no browser storage, third-party script, analytics or GET redemption.
- Clicking acceptance sends a verification code only to the stored recipient. A forwarded invitation link alone cannot grant access.
- Submitting the 16-character random code explicitly accepts. D1 performs a conditional transaction: simultaneous redemptions produce one winner. Invitation and code expiry, attempts, revocation, current inviter authority and unchanged target revision are rechecked.
- The session cookie is Secure, HttpOnly, SameSite=Strict and host-only, with a 12-hour lifetime. Invitation lifetime is 48 hours; verification codes last 10 minutes with at most five attempts. Codes and raw tokens are never stored in the database.
- Subsequent login uses email verification. Its generic response is independent of account eligibility and mail latency; identity lookup and mail run in `ctx.waitUntil`. IP and recipient throttles apply. Logout revokes the session.

Resend transports email; it is not the authorization system. The application verifies possession of the exact invitation address. Email normalization trims and lowercases only, without rewriting aliases or dots.

## Reporting boundary

Every report checks the live session and grants in D1. Visible metrics are the intersection of the invitation's frozen IDs and the target's current metric mappings. Adding a new metric never expands an existing grant. Removing a mapping or revoking a grant takes effect on subsequent requests. Reports recheck exact surviving metric IDs immediately before returning data.

The portal returns target identity, metric labels/units, values, quality, collection timestamps and two-period comparisons. It does not expose client-wide lists, internal notes, raw source URLs, dimensions, content drafts, captions, audit records or credentials. Instagram identity is immutable through the application; use a new target rather than repointing existing access.

Before sharing, ensure each approved metric genuinely describes only its intended target. An account-total metric cannot be made project-private merely by linking it to a project. Access includes historical and future observations for the approved metrics until access expiry or revocation.

## Safe Resend setup

In Cloudflare **Workers & Pages → content-hub → Settings → Variables and Secrets**:

- Add **RESEND_API_KEY** as a **secret**. Use a Resend sending-only key restricted to the intended verified domain. Enter it directly in Cloudflare, never chat, Git or frontend configuration.
- Add **RESEND_FROM** as a plain-text variable, using an approved address on the verified domain, such as `Content Hub <reports@example.com>` (example only).
- Keep **APP_ORIGIN** set to the exact HTTPS deployment origin.
- Keep **INVITATIONS_ENABLED=false** until sender/key setup and an explicitly approved test recipient are ready. Set it to `true` only as an intentional operator enablement.

For CLI-based deployments, add corresponding server-only secret/variable declarations and preserve them across releases. Credential creation/configuration, DNS changes and actual invitation recipients need their own authorization. No setup step sends mail automatically.

Delivery is not blindly retried. A logical send is recorded before calling Resend with an idempotency key. Provider acceptance is not inbox delivery or access acceptance. Timeout/crash outcomes remain uncertain; revoke and explicitly approve a replacement instead of resending a lost token. Raw token/code bodies are retained only ephemerally in memory, never in a plaintext outbox.

## Tests and remaining operations

Tests cover tenant/target isolation, frozen scopes, partial revocation during a report, wrong/expired/exhausted codes, missing inviter authority, duplicate acceptance, uncertain delivery, generic login timing, cookie flags, request limits and CSRF. The static frontend has build/type/format checks and a mocked Playwright flow suite; run that suite in a compatible Chromium environment.

Before real client use: approve/provision service credentials, review shareable data, verify sender domain, run an authorized end-to-end delivery check, add upstream abuse controls, define cleanup/retention for expired challenges and rate-limit buckets, and test backup/restore. Public report links, exports, admin UI, delivery webhooks, and automatic publishing are not implemented.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [restricted keys](https://resend.com/docs/api-reference/api-keys/create-api-key).
