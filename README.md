# Content Hub

An agency workspace for storing client metrics, comparing reporting periods, and making planned content available to authorized agents through MCP.

## Current implementation

- Cloudflare Worker with a stateless remote MCP endpoint at `/mcp`.
- Cloudflare D1 schema with tenant and client boundaries.
- Static Astro client portal, target/month selection, private metric comparisons and a clearly synthetic `/demo`.
- Target-scoped invitations, passwordless recipient verification and Resend transport (disabled until configured).
- Arbitrary metric definitions and numeric observations. Instagram and SEO are categories, not hardcoded tables.
- Source attribution, collection timestamps, missing/partial data, idempotent ingestion and append-only corrections.
- Month-over-month comparisons using exact supplied monthly periods.
- MCP data writes for client/project setup, drafts, approval, scheduling, cancellation, publication receipts and metric associations.
- Agent-neutral content discovery with captions, asset references, publication state and linked metrics.
- Scoped service credentials stored only as hashes, with expiry, revocation and explicit client grants.

**This is an early application, not a production-ready service.** No real client data, credentials, OpenSEO integration or publishing integration is included. Email delivery is disabled until an operator configures it. Safe publisher coordination and production operations remain future work. See deployment notes for setup boundaries.

## Stack choice

Use **Astro + TypeScript** for the reporting UI, **Cloudflare Workers** for the application and MCP, and **D1** for relational storage. Astro builds the static client portal; same-origin Worker APIs provide authenticated reports. It fits a lightweight reporting interface with small interactive filters. Next.js is unnecessary complexity for this initial shape; revisit if the app becomes heavily interactive.

D1 supplies managed SQLite semantics. A local SQLite file is suitable for development/testing, **not persistent storage inside a deployed Worker**. Supabase is optional later if PostgreSQL-specific features become a requirement.

## Development

Requirements: Node.js 24+, npm, Python 3 (SQL constraint tests).

```sh
npm ci
npm run check
npm run dev
```

`npm run check` runs backend/frontend TypeScript, domain/schema/security tests, Astro/Worker builds and Miniflare runtime integration tests. `npm run dev` uses Vite with the Cloudflare plugin; `npm run dev:web` develops the static UI alone. In restricted build environments, set `ASTRO_TELEMETRY_DISABLED=1`. The new project uses `cloudflare.config.ts`, not a Wrangler configuration. The CLI is beta and pinned through the lockfile.

The database starts empty. `/` is the private portal sign-in, `/invite` accepts invitations, and `/demo` contains synthetic data only. `/health` is public. `/mcp` rejects unauthenticated requests. There are deliberately no default live credentials or auto-created tenants. See [deployment and security](docs/deployment.md) before configuring a real instance.

## MCP tools

| Tool | Purpose | Scope |
| --- | --- | --- |
| `prepare_invitation` / `list_invitations` / `revoke_invitation` | Prepare, inspect or revoke exact target access | `invitations:manage` |
| `send_invitation` | Send only an explicitly approved invitation | `invitations:send` |
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
- [Private client invitations and Resend setup](docs/invitations.md)
- [Deployment, access control and readiness](docs/deployment.md)
- [Synthetic MCP examples](examples/metric-workflow.json)

## Important limits

- The prototype compares exact full-month observations, not an inferred roll-up of daily values.
- Metric definitions are immutable. New meanings or units require new keys.
- Content tools store drafts, approval, schedules and receipts. They never publish, reserve or claim a post on an external platform.
- Service bearer authentication is for controlled agent clients. Human browser login uses separate email-verified sessions. Standards-based MCP OAuth discovery/authorization is not implemented.
- Client/metric discovery has explicit prototype limits (100 clients / 200 metrics). Content listing is paginated.
- No public report sharing, external data fetching, media downloading, deletion tool or SQL execution tool is exposed.
