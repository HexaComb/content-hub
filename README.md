# Content Hub

An agency workspace for storing client metrics, comparing reporting periods, and making planned content available to authorized agents through MCP.

## Current foundation

- Cloudflare Worker with a stateless remote MCP endpoint at `/mcp`.
- Cloudflare D1 schema with tenant and client boundaries.
- Arbitrary metric definitions and numeric observations. Instagram and SEO are categories, not hardcoded tables.
- Source attribution, collection timestamps, missing/partial data, idempotent ingestion and append-only corrections.
- Month-over-month comparisons using exact supplied monthly periods.
- MCP data writes for client/project setup, drafts, approval, scheduling, cancellation, publication receipts and metric associations.
- Agent-neutral content discovery with captions, asset references, publication state and linked metrics.
- Scoped service credentials stored only as hashes, with expiry, revocation and explicit client grants.

**This is an early backend foundation, not a finished product.** No real client data, credentials, OpenSEO integration or publishing integration is included. The reporting UI, client invitations and safe publisher coordination are next implementation steps. An empty D1 deployment target is explicitly configured; see deployment notes for setup boundaries.

## Stack choice

Use **Astro + TypeScript** for the reporting UI, **Cloudflare Workers** for the application and MCP, and **D1** for relational storage. Astro is the recommended next layer, not installed in this backend-only first commit. It fits mostly server-rendered client reports with small interactive chart/filter components. Next.js is unnecessary complexity for this initial shape; revisit if the app becomes heavily interactive.

D1 supplies managed SQLite semantics. A local SQLite file is suitable for development/testing, **not persistent storage inside a deployed Worker**. Supabase is optional later if PostgreSQL-specific features become a requirement.

## Development

Requirements: Node.js 24+, npm, Python 3 (SQL constraint tests).

```sh
npm ci
npm run check
npm run dev
```

`npm run check` runs TypeScript, domain/schema tests and a local Worker build. `npm run dev` uses the Cloudflare CLI (`cf`). The new project uses `cloudflare.config.ts`, not a Wrangler configuration. The CLI is beta and pinned through the lockfile.

The database starts empty. `/health` is public. `/mcp` rejects unauthenticated requests. There are deliberately no default live credentials or auto-created tenants. See [deployment and security](docs/deployment.md) before configuring a real instance.

## MCP tools

| Tool | Purpose | Scope |
| --- | --- | --- |
| `create_client` / `update_client` | Create or revise a client with an audit receipt | `clients:write` |
| `create_project` / `update_project` | Create or revise an Instagram-account/one-off-project target | `projects:write` |
| `list_projects` | Read project targets and metric associations | `projects:read` |
| `create_content` / `update_content` | Draft/edit content, invalidating previous approval | `content:write` |
| `link_content_metric` | Associate content with a metric | `content:write` |
| `approve_content` | Record explicit approval of a revision and destination | `content:approve` |
| `schedule_content` / `cancel_content` | Set or cancel a stored schedule | `content:schedule` |
| `record_publication_receipt` | Record evidence of an already completed external post | `content:receipt` |
| `list_clients` | Discover clients explicitly granted to the credential | Authenticated |
| `list_metrics` | Read definitions and units | `metrics:read` |
| `define_metric` | Add a named numeric metric with stable meaning | `metrics:write` |
| `get_observation` | Read current value/revision for an exact interval | `metrics:read` |
| `record_observation` | Add or correct a dated number with provenance | `metrics:write` |
| `compare_month` | Compare supplied monthly observations | `metrics:read` |
| `list_content` | Inspect planned/published content | `content:read` |
| `get_content` | Retrieve caption, assets and schedule details | `content:read` |

An agent can obtain numbers from OpenSEO or another source, then call `record_observation`. **Content Hub does not connect to OpenSEO.** Likewise, any authorized agent can retrieve scheduled content. A consumer such as Muse would be external; no specific bot is required or integrated.

## Design documents

- [Architecture and product plan](docs/architecture.md)
- [Metric semantics and reporting](docs/metrics.md)
- [Content lifecycle and safe agent coordination](docs/content.md)
- [Resend invitation design](docs/invitations.md)
- [Deployment, access control and readiness](docs/deployment.md)
- [Synthetic MCP examples](examples/metric-workflow.json)

## Important limits

- The prototype compares exact full-month observations, not an inferred roll-up of daily values.
- Metric definitions are immutable. New meanings or units require new keys.
- Content tools store drafts, approval, schedules and receipts. They never publish, reserve or claim a post on an external platform.
- Service bearer authentication is for controlled agent clients. Browser login and standards-based OAuth discovery/authorization are not implemented.
- Client/metric discovery has explicit prototype limits (100 clients / 200 metrics). Content listing is paginated.
- No public report sharing, external data fetching, media downloading, deletion tool or SQL execution tool is exposed.
