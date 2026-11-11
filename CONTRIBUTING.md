# Working on unreel content

## Start here

Read the [product model and repository map](README.md#understand-the-app), then the document for the area being changed. Use the existing structure before adding another abstraction or service.

The normal workflow is **client → project → report/access**. Do not add a new user-facing data bucket when an existing client or project relationship covers the requirement. Internal tenant identifiers are still required for isolation.

## Make changes in the right place

1. Put deterministic comparison and validation rules in backend domain/schema modules, not in UI code.
2. Keep browser identity verification, administrator authorization and recipient grants separate. A role in a request body or URL never authorizes access.
3. Keep every database query tenant/client/project scoped where applicable. A new project requires an existing client; a linked metric must belong to that same client.
4. Keep project designs declarative and separate from observations and access. Use the existing MCP theme tools and revision/audit flow; do not add executable theme code or hardcoded client-specific branches.
5. Share report rendering between admin preview and recipient pages. Clearly label when the admin sees more metrics than a recipient.
6. Keep invitation preparation, review, send and acceptance distinct. No automatic email, grant, retry after an uncertain send, public admin signup or privilege promotion.
7. Use plain labels in the UI. Prefer Client, Project, Report and Client access. Explain operational setup only when it prevents an action.

## Validate before publishing

From the repository root, using the pinned Node version:

```sh
npm ci
npm run check
```

The aggregate check runs both TypeScript projects, backend and SQL tests, frontend tests, both builds and Worker/D1 runtime tests. For browser behavior, use the synthetic suites under `web/tests/`, especially `project-browser-qa.mjs`. They must never send live email or create real grants. Report browser checks as not run when the environment cannot launch or reach a browser.

Cover unauthorized identities, cross-client/project IDs, session changes, repeated clicks, interrupted sends, stale replies, expired/revoked invitations, Back/Forward and small screens. Use real application data only for authorized read-only verification; never insert sample business records into production.

## Database and deployment

Migrations are ordered and additive. Inspect the existing schema/data and retain a D1 recovery bookmark before a live change. Preserve current clients, projects, observations, grants and audits. Apply migrations with bookkeeping; never silently recreate the database.

The configured production path is `main` → Cloudflare Builds → existing `content-hub` Worker and domains. `npm run check` does not deploy. Verify the exact commit and CI outcome after an authorized release. A successful build does not prove that email delivery, authentication configuration or a recipient's access is ready.

Update the related document when behavior changes. Keep actual behavior separate from future plans and current rollout limitations.
