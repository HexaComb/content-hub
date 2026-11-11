# unreel content

A private client reporting app. Clients own projects, projects select the metrics they report, and invited people see only the metrics approved for them. Authorized agents manage data and project designs through MCP.

## Current implementation

- Sidebar Skills guide with agent-neutral setup prompts, real tool/scope documentation and explicit authentication, data-sharing and publication boundaries. See [agent workflows](docs/skills.md).
- Optional project-level SEO and Instagram plugins, separate dashboards and accessible settings/member dialogs. Plugin configuration is available through the UI and MCP; external account connections are not implied.

- Cloudflare Worker with a stateless remote MCP endpoint at `/mcp`.
- Cloudflare D1 schema with tenant and client boundaries.
- Static Astro client portal, deep-linked themed client project pages, month selection and private metric comparisons.
- Target-scoped browser admin invitation review, Clerk-verified recipient identity and Resend transport (disabled until configured).
- Fail-closed super-admin eligibility for the two explicitly named operators only, requiring verified sessions and separate enablement. No public admin signup or promotion.
- Per-project/account MCP design documents with isolated styling, accessible palettes and audited reset. Report data and permissions remain unchanged.
- Arbitrary metric definitions and numeric observations. Instagram and SEO are categories, not hardcoded tables.
- Source attribution, collection timestamps, missing/partial data, idempotent ingestion and append-only corrections.
- Month-over-month comparisons using exact supplied monthly periods.
- MCP data writes for client/project setup, drafts, approval, scheduling, cancellation, publication receipts and metric associations.
- Agent-neutral content discovery with captions, asset references, publication state and linked metrics.
- Scoped service credentials stored only as hashes, with expiry, revocation and explicit client grants.

**This is an early application with rollout limits.** The repository contains no live credentials or seeded client data. A deployment may hold real client records. Email delivery is disabled until verified and enabled, and the current checked-in Clerk configuration uses a development instance. OpenSEO collection and actual publishing remain external. See deployment notes for setup boundaries.

## Understand the app

- **Client:** the business, such as Hexacomb LLC.
- **Project:** work for that client, such as Hexacomb SEO or an Instagram account. Every project must belong to a client.
- **Metric:** a named measurement owned by the client and linked to one or more of its projects.
- **Observation:** a value for an exact period, with source, quality and correction history.
- **Invitation:** one person's read-only access to an exact project and selected metrics. It is not an administrator role.
- **Tenant:** an internal agency isolation boundary. It remains in the database and authorization checks, not as an extra user-facing bucket.

Start in **All Projects**, open a project to preview its page, then use **Invite client / Manage access** to review a recipient's access. Project themes change presentation only. For the complete flow, see [client project pages](docs/client-project-pages.md).

## Repository map

- `web/src/pages/`: entry pages for client home, admin directory, project, standalone client pages, invitation acceptance, OAuth consent and Skills.
- `web/src/components/`: shared shell/navigation and report markup.
- `web/src/scripts/admin.ts`: client/project directory. `dashboard.ts`: shared client report and admin project preview. `project-invitations.ts`: explicit invitation review.
- `web/src/scripts/skills-catalog.ts`: reusable workflow catalog and agent setup prompt. `skills.ts`: guide interactions. `prompt-copy.ts`: shared clipboard handling.
- `src/adminReports.ts` and `src/adminInvitations.ts`: verified administrator reads and invitation actions.
- `src/portal.ts`: recipient reports and project access. `humanAuth.ts`: Clerk identity verification. `auth.ts`: MCP credential/client checks.
- `src/workspaces.ts` and `workspaceSchemas.ts`: client/project operations (legacy internal filenames, not another product object).
- `src/repository.ts`, `domain.ts`, `content.ts`, `themes.ts`: metrics/storage, deterministic comparisons, content workflow and project design.
- `src/index.ts`: Worker routing and MCP tool registration. `oauth*.ts`: delegated agent authorization.
- `migrations/`: ordered, additive database changes. `tests/` and `web/tests/`: backend/security and frontend tests.
- `docs/`: current behavior and operational boundaries. Start with [architecture](docs/architecture.md), [admin access](docs/admin.md), or [contributing](CONTRIBUTING.md).

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

A new installation starts with an empty database. `/` is the private portal sign-in, `/invite` accepts invitations. `/health` is public. `/mcp` rejects unauthenticated requests. There are deliberately no default live credentials or auto-created tenants. See [deployment and security](docs/deployment.md) before configuring a real instance.

## MCP tools

| Tool | Purpose | Scope |
| --- | --- | --- |
| `prepare_invitation` / `list_invitations` / `revoke_invitation` | Prepare, inspect or revoke exact target access | `invitations:manage` |
| `send_invitation` | Send only an explicitly approved invitation | `invitations:send` |
| `create_client` / `update_client` | Create or revise a client with an audit receipt | `clients:write` |
| `create_project` / `update_project` | Create or revise an Instagram-account/one-off-project target | `projects:write` |
| `get_project_presentation` / `validate_project_presentation` | Read and validate private standalone client-page designs | `presentations:read` |
| `save_project_presentation_draft` / `restore_project_presentation` | Save or restore a private design draft | `presentations:write` |
| `publish_project_presentation` | Publish the exact current draft to existing authorized recipients | `presentations:publish` |
| `get_project_theme` / `validate_project_theme` | Read a target design or validate a proposed design without saving | `themes:read` |
| `update_project_theme` / `reset_project_theme` | Apply or reset a target design independently of report data | `themes:write` |
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
| `get_instagram_dashboard` | Read four selected Instagram KPI kinds and daily follower history | `metrics:read` |
| `get_instagram_workflow` | Read project ideas, pending/completed content and decisions | `content:read` |
| `upsert_instagram_item` | Create or revision-update an idea/production record | `content:write` |
| `record_instagram_decision` | Record an explicitly authorized Yes/No, without publishing | `content:write` |
| `compare_month` | Compare supplied monthly observations | `metrics:read` |
| `list_content` | Inspect planned/published content | `content:read` |
| `get_content` | Retrieve caption, assets and schedule details | `content:read` |

An agent can obtain numbers from OpenSEO or another source, then call `record_observation`. **unreel content does not connect to OpenSEO.** Likewise, any authorized agent can retrieve scheduled content. A consumer such as Muse would be external; no specific bot is required or integrated.

## Design documents

- [Project plugins and dashboard configuration](docs/plugins.md)

- [Client project pages and browser invitation administration](docs/client-project-pages.md)

- [Private standalone client microsites](docs/presentations.md)
- [Instagram dashboard and idea workflow](docs/instagram-dashboard.md)
- [Project/account presentation through MCP](docs/themes.md)
- [Architecture and product plan](docs/architecture.md)
- [Metric semantics and reporting](docs/metrics.md)
- [Content lifecycle and safe agent coordination](docs/content.md)
- [Private client invitations and Resend setup](docs/invitations.md)
- [Clerk authentication setup and cutover](docs/clerk.md)
- [Deployment, access control and readiness](docs/deployment.md)
- [Synthetic MCP examples](examples/metric-workflow.json)

## Important limits

- The prototype compares exact full-month observations, not an inferred roll-up of daily values.
- Metric definitions are immutable. New meanings or units require new keys.
- Content tools store drafts, approval, schedules and receipts. They never publish, reserve or claim a post on an external platform.
- Service bearer authentication is for controlled agent clients. Human browser login uses Clerk session verification, separate from MCP credentials. MCP OAuth discovery/authorization is implemented with explicit operator provisioning, selected client/scope consent, PKCE and revocable delegation.
- Client/metric discovery has explicit prototype limits (100 clients / 200 metrics). Content listing is paginated.
- No public report sharing, external data fetching, media downloading, deletion tool or SQL execution tool is exposed.

## Branding and deployment identifiers

The product name is **unreel content**. The GitHub repository, Worker/service name, routes, D1 binding, and existing sender address retain their current `content-hub` identifiers so deployment and integrations keep working. Renaming those external resources is a separate coordinated change.
