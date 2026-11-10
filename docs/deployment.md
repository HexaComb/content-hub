# Deployment and security readiness

## Not deployed

This repository contains a local buildable backend. It has not created a Cloudflare database, Worker deployment, identity provider, API token, user login or production agent credential. Deployment is a separate step that needs the intended Cloudflare account/environment and approval for resources and access.

The new Cloudflare CLI uses `cloudflare.config.ts`. It is beta, so versions are lockfile-pinned. `npm run build` only produces a local bundle. There is deliberately no automatic deploy or remote migration in the check script.

## First deployment checklist

1. Select the intended Cloudflare account and an isolated development environment. Confirm plan, costs, region/data policy and deployment destination.
2. Create a D1 database deliberately and bind its verified ID. Do not let an accidental generic deployment choose a production database.
3. Apply `migrations/0001_initial.sql` to the intended empty database, then verify schema/foreign keys. Later migrations require normal backup and rollback planning.
4. Create the agency tenant and client records through an operator-controlled process. Client timezone and source reporting timezone may differ; retain both.
5. Decide on authentication. The prototype validates high-entropy service bearer credentials by SHA-256 hash and enforces expiry, revocation, scopes and individual client grants. It deliberately has no credential-issuance endpoint. Provision any real credential only through an approved secure process, never chat, source control, example files or logs.
6. For general-purpose user-facing MCP clients, implement standards-compliant OAuth and protected-resource metadata before rollout. Static bearer headers are suitable only for controlled clients that explicitly support them. Browser sign-in is also pending.
7. Bind the rate limiter with an account-appropriate namespace. Its platform limits are not a globally exact quota; add upstream abuse protection and account budgets before public rollout.
8. Run migrations, unit/schema/runtime tests and tenant-isolation tests in the deployment environment. Verify `/health`, unauthenticated rejection, authorized ingestion, idempotent retries and read-only content access on the exact deployed revision.
9. Check D1 recovery/backup retention and perform a restore drill before real client data. Set retention for source data and logs. Backups and sharing settings are not configured by this repository.

## Access model

Credentials are scoped to one tenant and a list of clients. Supported scopes are `metrics:read`, `metrics:write`, `content:read`. A publisher does not need to write metrics; a metrics-only collector does not need content access. Tool visibility is based on scope and every operation also checks authorization in the data layer.

Bearer tokens must be random, high entropy, individually issued, short lived where practical, revocable and rotated. The application stores hashes, not raw tokens. Do not send one agent another agent's token. No URL query parameter authentication is accepted. Logs do not include tokens, captions, source URLs or metric values.

The service rejects unexpected browser origins, validates and bounds inputs, caps request bodies at 64 KiB and avoids raw SQL tools or arbitrary URL fetches. D1 does not supply PostgreSQL-style row-level security, so tenant-aware code and composite keys are mandatory. Direct database operators remain privileged; application boundaries do not restrict them.

## Cost direction, verified November 10, 2026

Start with Workers + D1; no always-on database server is required. The current D1 Free tier includes 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. Exceeding free limits can reject operations, so this is not an uptime guarantee. Paid D1 includes 25 billion reads/month, 50 million writes/month and 5 GB, then charges $0.001 per million reads, $1 per million writes and $0.75 per GB-month. Index updates count toward writes.

Workers execution is priced separately. Check the current account's plan and CPU/request usage before estimating a total. No paid subscription or cloud resource has been selected here. A modest agency's summary metrics should be inexpensive, but high-cardinality SEO keyword/page histories, audit revisions, media and frequent dashboard scans can change the cost materially. Index tenant/client/date lookups and observe actual row counts rather than promising a fixed bill.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [MCP security](https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/).

## Still needed before production

- Human login, onboarding and secure operator/credential management.
- Fully paginated discovery and an audit/history interface.
- Content editing, revision-bound approvals and safe publisher claims/receipts.
- Production deployment tests, abuse/load tests, backup/restore and operational alarms.
- Reviewed report snapshots and explicitly authorized sharing/export.
- Security review of client data and any third-party media/embed handling.
