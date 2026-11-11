# Agent skills and reusable workflows

Open **Skills** in the dashboard sidebar, or visit `/skills`. The public guide contains generic instructions only, with no client records, live measurements or credentials. It can be read without signing in. An optional verified session read personalizes navigation; it never grants access.

## Use the guide

1. Review the catalog. Choose **Use this skill** to prepare one workflow, or keep all workflows selected.
2. Review the prompt, then choose **Copy setup prompt**. If clipboard access is unavailable or takes too long, the text is selected for manual copying. A successful copy is announced only after the browser confirms it.
3. Paste into an MCP-capable agent authorized to receive the relevant information. Ask that agent to save instructions in its own supported skill format. Agents without a skill feature can retain reusable workflow instructions instead.
4. Connect separately and approve only the client and scopes needed for the actual task. Copying the prompt does not install software, authenticate, request permission or change data.

The setup prompt asks the receiving agent to inspect its actual tools and schemas, distinguish saved instructions from a working connection, and report unsupported features. No particular agent's installation format or capability is assumed.

## Available workflows

| Group | Workflow | Result |
| --- | --- | --- |
| Setup | Connect and verify access | Verify current tool access and select the exact client/project. |
| Setup | Create or update a client and project | Maintain the client → project relationship with revision checks. |
| Setup | Set up metrics and dashboards | Define stable measurements and explicitly map compatible project plugins. |
| Records | Update SEO readings | Store source-backed periods, collection times, coverage and append-only corrections. |
| Records | Update Instagram readings | Store supported KPIs and genuine daily follower snapshots. |
| Records | Track content ideas and drafts | Record explicit decisions and production evidence without posting externally. |
| Records | Review monthly results | Summarize exact project/plugin metrics with missing and partial data visible. |
| Design | Style the dashboard report | Validate and apply supported project report themes. |
| Design | Design the client-facing pages | Save a shared design as a private draft and review exact SEO/Instagram previews. |
| Design | Publish or restore a reviewed design | Publish the exact approved draft, or restore history as a new draft first. |

The catalog describes application capabilities, not permissions already available to every connection. OAuth discovery can advertise eligible tools whose execution still requires a scope consent step. A credential's operator/client policy remains authoritative.

## Connection and privacy boundaries

- Remote Streamable HTTP MCP endpoint: `https://content.unreelviews.com/mcp`.
- Muse public OAuth client ID: `ZuAE_6drixVcWV1S`. It is not a secret, is for Muse only and needs no client secret. Other agents use their own supported OAuth registration/connection flow.
- Client registration does not verify a particular user's connection. Each person needs an existing authorized operator account and must consent to their own selected clients/scopes. One connection covers all current and future projects of those selected authorized clients; individual tasks still specify exact project IDs. No separate connection is needed per project. A client invitation is not operator access.
- Review Muse's current connector notice that data is used to improve AI at Meta before sharing client information. The generic prompt contains no client data; later use of any agent requires authorization to share the relevant data with it.
- Do not paste passwords, tokens, secret API keys or private source data into setup instructions. Use supported secure authorization flows.
- Saving skills does not require approving every workflow's scope. `mcp:connect` is required for MCP calls; add only needed read scopes initially and task-authorized write/publish scopes later. `offline_access` is optional and must be explicitly consented to.
- External services such as OpenSEO, Google and Meta require separate authorized connectors. This MCP stores reports and records; it does not collect source data or publish social content automatically.

## Design and access are separate

The report theme tools change the dashboard's supported design tokens. A published client presentation retains its own reviewed theme snapshot. Use presentation draft/preview/publish tools to update the shared design for the separate SEO and Instagram client pages. Saving or restoring a draft does not publish it. Publication uses a separate scope and needs approval of the exact design and editorial content for the existing authorized audience.

Client invitation review and sending stay in the administrator's project **Manage access** flow. Ordinary agent OAuth has no invitation-send or administrator scopes. No guide action sends email, changes grants or expands recipient access.

## Source map and maintenance

- `web/src/scripts/skills-catalog.ts`: workflow definitions and the single source for card content and copied prompts.
- `web/src/pages/skills.astro` and `web/src/styles/skills.css`: accessible server-rendered guide and responsive layout.
- `web/src/scripts/skills.ts`: workflow selection and optional navigation identity reads.
- `web/src/scripts/prompt-copy.ts`: shared bounded clipboard handling for Skills and project metrics prompts.
- `web/tests/skills-catalog.test.ts`: real registry/scope coverage and prompt boundaries.
- `web/tests/skills-ui.test.ts`: selection/reset behavior, public availability and stale identity handling.
- `tests/navigationAssets.integration.ts`: production route, assets and CSP checks, including the static guide.

Update the catalog alongside tool/schema changes. Tests reject undocumented tool names or missing declared scopes, but semantic changes still require a content review. See [OAuth](oauth.md), [project plugins](plugins.md) and [private client presentations](presentations.md) for their current implementation limits.
