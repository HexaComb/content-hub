# Client project pages and access

## Product model

The normal UI has two business objects: **clients** and their **projects** (including Instagram accounts). Each project already has a required composite foreign key to its client. The internal tenant boundary remains for agency isolation; it is not another bucket users need to manage. This release removes the workspace column/count from the administrator directory without flattening tenant security or changing existing data.

All Projects provides real links to `/project?tenant=…&client=…&project=…`. The whole row is pointer-clickable, while the project name and Preview page link support keyboard navigation, new tabs and browser history. The project page uses the same report renderer and saved project theme as the recipient view. Administrator preview is labeled as the full project report; clients see only the metrics explicitly approved for their identity.

Recipient links omit the tenant selector: `/project?client=…&project=…`. They never gain administrator access from a URL parameter. Both report APIs resolve the actual client name on the server. Existing recipient grants still bind a verified issuer/subject pair and snapshot the approved metric IDs; linking new metrics does not expand old invitations. Ambiguous duplicate client/project IDs across tenants fail closed in recipient lookup.

## Browser invitation administration

Only the two existing server-verified super administrators can use the project access panel and its endpoints:

- `GET /api/admin/targets/:tenant/:client/:project/invitations` reads mapped metrics, exact-project status and delivery readiness.
- `POST …/prepare` takes recipient email, selected metric IDs and access expiry. It saves a review snapshot but sends no message and grants no access.
- `POST …/send` requires that snapshot's digest plus explicit approval. The UI shows recipient, client/project, role, metric IDs/labels, expiry and email-provider disclosure before enabling Send.
- `POST …/revoke` revokes only an invitation in the exact route's project, after an explicit UI confirmation.

Writes require JSON, the configured same origin, the current verified admin identity, a bounded body and a rate limit. No signup or role-promotion endpoint exists. Archived projects cannot be invited. The disabled delivery gate is not bypassed by browser administrator access.

Migration `0009_admin_invitation_actors.sql` adds inert audit attribution for browser operators. These principal records have no scopes, no client grants and an `admin:` non-hex marker that cannot match a SHA-256 bearer-token hash. They are not credentials or OAuth delegations. Pending invitations revalidate the issuing actor and the current admin gate/allowlist before acceptance. Existing service invitations preserve their original authority checks.

Recipient acceptance still requires the intended verified email and a single-use token, then binds access to the stable identity. Successful acceptance returns the exact project path. Report reads continue to recheck grants server-side, including after fetching observations.

## Deployment and readiness

Apply migration 0009 after the existing migrations, with D1 recovery available. It does not alter clients, projects, metrics, observations, themes, existing invitations or grants. Do not drop or recreate any business table.

`INVITATIONS_ENABLED=false` stays checked in until the sender/domain is verified and mail setup is deliberately enabled. A secret binding does not prove API-key validity or domain verification. This feature can be exercised with a fake mail transport in local tests; no real recipient or live email is needed. Provider acceptance is not evidence of delivery. Uncertain sends must not be retried blindly; inspect/revoke and explicitly approve a replacement if appropriate.

Clerk test-instance configuration remains a rollout limitation independent of this feature. Do not claim production authentication readiness from a passing local test.
