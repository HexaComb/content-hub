# Architecture and product plan

## Product goal

Give a marketing agency one dependable place to answer: “What changed for this client this month?” Agents contribute arbitrary numbers and inspect the agency's content plan. The system keeps the evidence and boundaries needed to make those answers trustworthy.

## Small initial stack

1. **Astro reporting application (next step):** client selector, monthly overview, metric detail/history and content calendar. Add React islands only for controls that need rich interactivity.
2. **Cloudflare Worker:** application endpoints and stateless MCP. The initial commit implements the MCP backend, not the Astro app.
3. **D1:** tenants, clients, agent permissions, metric definitions, observation revisions and content metadata.
4. **R2, only when needed:** uploaded media and frozen report exports. The initial design stores asset references and does not provision storage or download files.

Do not add Queues, Workflows, Durable Objects, an AI model, or Supabase until a concrete requirement needs them. The stateless MCP implementation does not require a Durable Object.

## Boundaries

- A tenant is an agency workspace. A client belongs to one tenant.
- Every metric and content item carries tenant and client identifiers.
- A verified service credential establishes the tenant. Agents never select or override it in tool arguments.
- Client grants and scopes are enforced before any client-specific query.
- Composite foreign keys prevent cross-tenant/client links, including post-to-metric links.
- Source content and captions are untrusted data. They cannot authorize tool calls, change scopes, or request credential disclosure.
- Public source code does not make client records public. There is no unauthenticated reporting endpoint.

## Data supplied by agents

Agents collect numbers elsewhere, including OpenSEO when appropriate, and submit explicit observations. Provider names are descriptive provenance strings, not integrations. No OpenSEO API key, scraper, webhook, OAuth dependency or credential is needed here.

Keep numeric calculation deterministic. If a later report generator writes a narrative, it must cite the underlying observations, say when data is missing, avoid causal claims, and present a draft for the agency to review before sharing.

## Proposed interface

- **Client overview:** named metric cards, this month/prior month, absolute change, suitable percentage change and freshness badges.
- **Metric detail:** definition, source, units, reporting timezone, period history and correction history.
- **Content plan:** calendar/list with draft, approved, scheduled and published states; caption and assets in an item drawer.
- **Monthly report:** selected metrics, comparable periods, notes, evidence references and a review step. Snapshot approved reports so later source corrections do not silently alter something already shared.
- **Agent activity:** who changed which number, when, source, idempotency key and reason for correction. Never expose raw credentials.

Video embeds and metric overlays are exploratory UI ideas, not requirements in this first pass.

## Delivery sequence

### Foundation implemented in this commit

Worker MCP, D1 schema, client/project create/update, generic metric definitions, observations/corrections, exact monthly comparisons, service authentication and content lifecycle read/write tools. All application data writes go through MCP; credential provisioning remains an operator security boundary. This is a starter and requires deployment validation before real data.

### Next: usable private reporting app

Astro UI, human identity provider and tenant membership management; client setup; metric detail/history; read-only monthly report and content calendar; accessible/mobile UI tests. Add page-level pagination where the prototype currently limits discovery.

### Then: client invitations and publishing coordination

Resend invitations scoped to an Instagram-account or one-off-project target, verified human identity and read-only metric access. Add durable publishing claims and reconciliation before any unattended external consumer is connected. Draft editing, revision/destination-bound approval, scheduling, audits and externally supplied receipts are already in the backend. Keep actual publishing outside Content Hub unless separately requested.

### Then: reporting and scale

Frozen reviewed report snapshots, explicit sharing permission, optional exports, retention/backups, account-level cost monitoring, load tests and careful aggregation policies. Re-evaluate D1 size and write limits before high-cardinality keyword/page histories become large.

## Current documentation used

- [D1 overview](https://developers.cloudflare.com/d1/)
- [Workers framework guidance](https://developers.cloudflare.com/workers/framework-guides/)
- [Astro on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Stateless MCP handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [Cloudflare CLI](https://developers.cloudflare.com/cf/)

Checked 2026-11-10. Installed dependency versions and local build checks are the implementation baseline.
