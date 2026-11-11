# Private client microsites

The agency dashboard remains the management workspace. `/client` is a separate, private presentation with no sidebar or dashboard shell. MCP composes the page from trusted layout and report components. Observations, comparisons, metric grants and authentication are unchanged.

## Composition and real limits

A presentation document contains an independent theme snapshot, page width, ordered section IDs and a flat array of named nodes. Nodes reference children by ID. Supported components are full-width color bands, stacks, equal/asymmetric/two- or three-column grids, text, decorative dividers, giant/standard/inline metrics, comparison blocks and complete metric collections. Colors, system-font families, spacing and alignment use validated values. Mobile layouts collapse grids without changing reading order. Theme columns apply only within automatic metric collections; density, corners and card treatment apply inside metric blocks. The legacy dashboard hero, order, divider and width settings do not override the authored standalone structure.

The choices are composable, not a handful of fixed page presets. A bold restaurant page and a quiet editorial report can have different structure and hierarchy while using the same report. The current component vocabulary is still bounded: it is not unrestricted web design, custom CSS, JavaScript, React, arbitrary HTML, animations, embeds, downloads or network fetching. New component types require reviewed application code. Text is plain editorial copy and must not be treated as evidence or instructions.

Limits are 48 KiB, 80 nodes, six levels, 12 top-level sections and a worst-case 400 data blocks. Every node belongs to the page exactly once; cycles, missing references, reused nodes and nested color bands fail validation. Metric references must currently belong to the exact project when saving, restoring and publishing. The document never supplies metric numbers, units, periods or comparison rules.

Every rendered page retains an uneditable report-data and methodology disclosure containing every metric authorized for that viewer, the exact monthly readings, units, coverage/quality, collection dates and calculated comparisons. The design cannot remove this disclosure. Author copy is not a calculated conclusion.

## Draft, preview, publish and rollback

1. Call `get_project_presentation` for the exact client/project. It returns current revision, draft and published documents, recent history, the full schema, a valid starter and private route paths.
2. Compose a complete document and call `validate_project_presentation` to check it without writing.
3. Call `save_project_presentation_draft` with the current expected revision and a new idempotency key. This does not change the client page.
4. Review the exact draft in `/client?tenant=…&client=…&project=…&preview=REVISION`. The browser must independently authenticate as an enabled administrator. A URL or revision number grants no access. MCP credentials are never placed in browser URLs.
5. After approval, call `publish_project_presentation` with the current expected revision and exact current draft revision, or use the browser's confirmed Publish action while viewing that draft. Publication affects only existing authorized recipients.
6. To roll back, call `restore_project_presentation` with an exact historical revision. It creates a new draft; the old live page stays in place. Preview and publish the new draft explicitly. Nothing deletes or rewrites history.

Browser administrators can inspect recent history, restore an old revision as a draft and publish a reviewed draft. They cannot grant recipient access from this page. The browser preview clearly uses administrator metric access; recipients may have a smaller metric subset. Draft creation and composition are exposed over MCP, not a drag-and-drop browser designer.

Head changes, immutable document snapshots and idempotent audit receipts commit together. Stale revisions or mismatched publication drafts roll back the entire batch. On uncertain delivery, retry the exact request with its original key. A changed action needs the refreshed revision and a new key. History returns the latest 50 metadata entries; exact older revisions remain retrievable by ID.

If no published design exists, the standalone page uses a trusted default with existing project styling and authorized report data. Saving a draft does not replace this default. Invalid stored documents fail to the default. A published design captures its theme: later dashboard theme edits do not silently change it.

## Authentication and isolation

- `/client?client=…&project=…` and `/api/targets/:client/:project/presentation` use existing verified Clerk identity and exact accepted, unexpired, unrevoked invitation grants. No public sharing is added.
- Recipient reads resolve exactly one tenant. Ambiguous client/project identities fail closed. Only published documents are queried; draft/history/admin state is never included.
- Report and presentation reads happen before the report's final exact permission check. Excluded metric references are removed from the recipient design as well as the report. No query follows that final authorization snapshot.
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

Run `npm run check`, including schema, isolation, lifecycle, origin and renderer tests. Use real data only for authorized read-only deployed checks. Local test fixtures must not be seeded into production. Browser checks require an authorized reachable HTTP(S) environment; a successful build is not a visual or authentic recipient-access pass.
