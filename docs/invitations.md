# Private client invitations

## Implemented, disabled until configured

The Astro portal, Resend transport, invitation lifecycle and Clerk-verified acceptance are implemented. Live mail is disabled by default. No sender, Resend key, recipient or agent credential is included. Local tests use synthetic records and fake mail only.

A recipient receives read-only access to one Instagram account or one-off project and a frozen set of approved metric IDs. The accepted invitation is the grant, bound to Clerk issuer and user ID. Acceptance never creates a service principal or client-wide membership. Browser sessions and MCP bearer credentials are separate.

## Operator workflow through MCP

1. `prepare_invitation` requires `invitations:manage` plus the client's grant. Supply one recipient, one target, explicitly mapped metric IDs and an access expiry no more than one year away. The result previews the exact recipient, target revision, metric set, expiry, email and Resend disclosure, with an approval digest. No message or access grant is created.
2. After explicit approval of those facts and ongoing read-only access, call `send_invitation` with `invitations:send`, the digest and `explicitlyApproved: true`. It revalidates the target and sends a neutral email. This feature request alone never authorizes invitations to real people.
3. `list_invitations` reports status without tokens. `revoke_invitation` cancels a pending invitation or its accepted access. Independently approved grants survive, so review all grants when removing a person's access.

An agent must obtain actual user authorization; the boolean is an attestation, not a human approval system. The API cannot determine whether an external agent honestly obtained it.

## Recipient flow

- The link uses an unguessable 32-byte token in a URL fragment. `/invite` captures it in memory and immediately removes the fragment. There is no browser token storage, analytics or GET redemption.
- The recipient signs in with Clerk. The Worker verifies the current session, exact configured issuer/origin and verified primary email. A forwarded invitation alone cannot grant access.
- Authenticated preview and explicit acceptance require that verified email to match the stored recipient. D1 conditionally binds the invitation to the verified issuer and stable user ID; concurrent acceptance has one winner. Expiry, revocation, inviter authority, target revision and metric mappings are rechecked.
- No custom email code or Content Hub session cookie is issued. Clerk handles browser login/signout; legacy passwordless routes and cookies cannot authenticate the new flow.
- Invitation lifetime is 48 hours. Approved access expiry is independent. Read permission follows the bound stable identity and the current D1 grant, not a mutable email address.

Clerk onboarding is separate from Content Hub permissions. A recipient without a Clerk account needs an authorized provider invitation/provisioning step in the invite-only instance; this application never automatically creates provider users or invitations. See [Clerk setup](clerk.md).

## Reporting boundary

Every report starts with current Clerk session verification and checks its bound grants in D1. Visible metrics are the intersection of the invitation's frozen IDs and the target's current metric mappings. Adding a new metric never expands an existing grant. Removing a mapping or revoking a grant takes effect on subsequent requests. Reports recheck exact surviving metric IDs immediately before returning data.

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

Tests cover tenant/target isolation, frozen scopes, partial revocation during a report, verified recipient/identity matching, missing inviter authority, duplicate acceptance, uncertain delivery, disabled authentication, admin allowlisting, request limits and CSRF. Clerk verification is mocked locally. The static frontend has build/type/format checks and a browser test harness; live provider UI needs an approved configured test instance.

Before real client use: approve/provision service credentials, review shareable data, verify sender domain, run an authorized end-to-end delivery check, add upstream abuse controls, define cleanup/retention for invitation and rate-limit records, and test backup/restore. Public report links, exports, admin UI, delivery webhooks, and automatic publishing are not implemented.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [restricted keys](https://resend.com/docs/api-reference/api-keys/create-api-key).

## Super-admin boundary

Only `christian@unreelviews.com` and `marco@hexacombllc.com` are eligible for super-admin authorization. Eligibility alone is not authentication: a matching email typed in a form never grants access. The server requires a live, Clerk-verified session and the separately controlled `ADMIN_ACCESS_ENABLED=true` gate. That gate defaults to false.

There is no public admin registration, invitation-to-admin conversion, promotion, role-edit, domain-wide wildcard, or arbitrary admin-list endpoint. Names, email-domain matches and caller-supplied role claims confer no privilege. Current authorization is calculated server-side on each request; expired/revoked sessions fail closed. Invited clients keep exact target/metric viewer access and never become administrators by accepting an invitation.

This establishes the admin authorization boundary, not an administrative CRUD interface. All business-data writes remain through separately authorized MCP service principals. No real admin session, service credential or recipient access is bootstrapped by code or migration. Enabling Clerk/admin authentication and provisioning service credentials remain deliberate operator actions.
