# Private client microsites

The agency dashboard remains the management workspace. `/client` serves separate private **SEO** and **Instagram** pages, without a sidebar or dashboard shell:

- `/client?client=…&project=…&plugin=seo`
- `/client?client=…&project=…&plugin=instagram`

Both pages use **one tenant/client/project presentation document, theme, draft, published revision and history**. Updating that design through MCP and publishing it changes both pages together. Page content differs; style is not duplicated by plugin. Observations, comparisons, metric grants and authentication are unchanged.

Only enabled, server-authorized services appear in page navigation and dashboard entry links. A disabled or invalid service fails closed; it never falls back to an aggregate report. Duplicate or unknown plugin selectors are rejected. Navigation preserves the reporting month and exact private preview revision. The main heading identifies the business and selected service, with the canonical project shown separately.

Existing `/client` bookmarks without a plugin remain usable. When services are enabled, they show a styled page chooser, not a mixed report or publication controls for an unseen service preview. With no enabled services, they retain the authorized legacy monthly report and say that no SEO/Instagram pages are enabled. The legacy API remains compatible; no stored design or history is migrated or duplicated.

## Composition and real limits

A presentation document contains a shared project theme snapshot, page width, ordered section IDs and a flat array of named nodes. Nodes reference children by ID. Supported components are full-width color bands, stacks, equal/asymmetric/two- or three-column grids, text, decorative dividers, giant/standard/inline metrics, comparison blocks and complete metric collections. Colors, system-font families, spacing and alignment use validated values. Mobile layouts collapse grids without changing reading order. Theme columns apply only within automatic metric collections; density, corners and card treatment apply inside metric blocks. The legacy dashboard hero, order, divider and width settings do not override the authored standalone structure.

Each node may specify `page: "shared" | "seo" | "instagram"`; an omitted marker means shared. The server removes wrong-page copy and blocks, excluded metric references and empty containers before responding. Shared parents may contain page-specific children. Each service uses the same validated theme and width.

The choices are composable, not a handful of fixed page presets. A bold restaurant page and a quiet editorial report can have different structure and hierarchy while using the same report. The current component vocabulary is still bounded: it is not unrestricted web design, custom CSS, JavaScript, React, arbitrary HTML, animations, embeds, downloads or network fetching. New component types require reviewed application code. Text is plain editorial copy and must not be treated as evidence or instructions.

Limits are 48 KiB, 80 nodes, six levels, 12 top-level sections and a worst-case 400 data blocks. Every node belongs to the page exactly once; cycles, missing references, reused nodes and nested color bands fail validation. Metric references must currently belong to the exact project when saving, restoring and publishing. The document never supplies metric numbers, units, periods or comparison rules.

Every rendered report page retains an uneditable report-data and methodology disclosure containing every monthly metric authorized for that viewer on the selected service, the exact monthly readings, units, coverage/quality, collection dates and calculated comparisons. The design cannot remove this disclosure. Author copy is not a calculated conclusion.

## Instagram metrics and history

The Instagram client page includes a trusted, read-only block for the four canonical KPIs (followers, posts since month start, average likes per post and posts per week) and daily follower history. It uses the same validated typography, colors, spacing and card tokens as the shared authored design. Automatic `metric_collection` cards are suppressed on Instagram to avoid duplicating its KPI summary; explicitly authored `metric` and `comparison` blocks remain available for deliberate monthly evidence. Empty automatic containers are removed.

Canonical KPI reporting windows and source timestamps are displayed explicitly. Daily followers are not fabricated from monthly observations. Missing dates remain missing, graph segments do not bridge gaps, and a daily-values disclosure accompanies recorded history. These source-based KPIs are distinct from the exact monthly observations and comparisons in the fixed report ledger.

The browser reads the existing authorized Instagram endpoint first, drops all workflow fields immediately, then reads the presentation response. Each KPI metric ID and the follower-series metric ID must still appear in that final presentation's metric set. Removed or missing IDs clear values, units, coverage, source timestamps and history points before rendering. Labels never establish permission. Target, selected month, service and exact preview revision must match before any content appears.

Recipient content planning, pending production, ideas, decisions and answer history are not shared. Administrator previews also render this block read-only with no workflow actions. The split creates no new endpoint, grant or scope.

## Draft, preview, publish and rollback

1. Call `get_project_presentation` for the exact client/project. It returns current revision, draft and published documents, recent history, the full schema, a valid starter, `sharedDesign: true` and enabled-service `pagePaths`.
2. Compose a complete document and call `validate_project_presentation` to check it without writing.
3. Call `save_project_presentation_draft` with the current expected revision and a new idempotency key. This does not change the client page.
4. Review the exact shared draft in both enabled-service pages, using `/client?tenant=…&client=…&project=…&plugin=seo&preview=REVISION` and the corresponding `plugin=instagram` path. The browser must independently authenticate as an enabled administrator. A URL or revision number grants no access. MCP credentials are never placed in browser URLs.
5. After approval, call `publish_project_presentation` with the current expected revision and exact current draft revision, or use the browser's confirmed Publish action while viewing that draft. Publication updates **both SEO and Instagram pages** for existing authorized recipients. It does not change their metric access.
6. To roll back, call `restore_project_presentation` with an exact historical revision. It creates a new draft; the old live page stays in place. Preview and publish the new draft explicitly. Nothing deletes or rewrites history.

Browser administrators can inspect the shared recent history, restore an old revision as a shared draft and publish a reviewed exact draft. The page shows the shared revision and explicitly confirms that publication changes both services. `presentation-state`, publish and restore remain project-level operations without a plugin parameter. They cannot grant recipient access from this page. The browser preview clearly uses administrator metric access; recipients may have a smaller metric subset. Draft creation and composition are exposed over MCP, not a drag-and-drop browser designer.

Head changes, immutable document snapshots and idempotent audit receipts commit together. Stale revisions or mismatched publication drafts roll back the entire batch. On uncertain delivery, retry the exact request with its original key. A changed action needs the refreshed revision and a new key. History returns the latest 50 metadata entries; exact older revisions remain retrievable by ID.

If no published design exists, the standalone page uses a trusted default with existing project styling and authorized report data. Saving a draft does not replace this default. Invalid stored documents fail to the default. A published design captures its theme: later dashboard theme edits do not silently change it.

## Authentication and isolation

- `/client?client=…&project=…&plugin=seo|instagram` and `/api/targets/:client/:project/presentation?plugin=seo|instagram` use existing verified Clerk identity and exact accepted, unexpired, unrevoked invitation grants. No public sharing is added.
- Recipient reads resolve exactly one tenant. Ambiguous client/project identities fail closed. Only published documents are queried; draft/history/admin state is never included.
- Report and presentation reads happen before the report's final exact permission check. The selected plugin, its enabled status, metric mappings and the recipient grant are intersected. Excluded metric values, IDs, references and wrong-page copy are removed from the recipient design and report. The response identifies its selected `presentation.plugin` and currently enabled `presentation.pages`. No query follows that final authorization snapshot.
- `/client?tenant=…` uses separate administrator APIs. Being signed in, possessing a URL or holding an OAuth token does not confer administrator status. Server authorization, not query parameters, decides access.
- Browser writes require verified enabled administrator identity, exact same-origin JSON requests, bounded bodies and rate limits. They create audit attribution only, never principals, bearer tokens or client grants.
- Stored keys and all query predicates include tenant/client/project. Append-only snapshots and receipts have composite foreign keys.
- Private responses and pages use `no-store`. The frontend clears data on session changes, sign-out and navigation, ignores stale replies and reloads restored browser history.

New MCP permissions are explicit and separate: `presentations:read`, `presentations:write`, `presentations:publish`. Tool registration, OAuth consent and data-layer authorization all enforce them. Deploying the code does not add scopes to any existing operator ceiling, connection or service credential. Those approvals must be handled separately by an authorized operator. Publication permission is intentionally distinct from draft editing.

## Media

Logos and images are intentionally disabled in this release. `theme.brand.logo` must be null. A small compressed file can decode to an enormous image, so file-size or magic-byte checks are not sufficient. No client asset, uploaded design-reference screenshot or private image belongs in the public repository.

Future image support needs maintained server-side decoding/transcoding with input byte, dimension, total-pixel, frame, CPU and memory limits. Reject animation and multipage content, strip metadata, re-encode safe raster output, associate assets with exact tenant/client/project and serve them through authorized APIs. Do not accept arbitrary URLs, raw SVG or browser-decoded data URIs as a shortcut. Until then use typography and plain-text branding.

## Release and verification

Apply additive migration `0011_client_presentations.sql` with migration bookkeeping after verifying a D1 recovery bookmark. It adds only presentation tables and append-only audit triggers. It does not alter clients, projects, plugins, observations, invitations, operator ceilings or grants.

Run `npm run check`, including schema, isolation, lifecycle, origin and renderer tests. Frontend coverage includes exact service routes, shared style propagation, independent metrics/copy, enabled-service entry links, legacy page choice, canonical Instagram authorization races, page-switch/session races, unchanged uncertain-write handling and shared-publication language. Use real data only for authorized read-only deployed checks. Local test fixtures must not be seeded into production. Browser checks require an authorized reachable HTTP(S) environment; a successful build is not a visual or authentic recipient-access pass.
