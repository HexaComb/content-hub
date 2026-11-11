# Project plugins

Projects can opt into `seo` and `instagram`. Installation is explicit, never inferred from project names or metrics. Migration 0010 only adds configuration and append-only audit tables; it does not alter current projects, observations, associations, themes, credentials or recipient grants. Existing projects start without plugins. Apply through the normal migration bookkeeping and recovery workflow before deploying this feature.

## Configuration

Each plugin has its own revision, independent of the project and other plugins. An absent plugin uses expectedRevision 0 for installation. Disable rather than delete to preserve history. Every save supplies an explicit, unique metricIds array (maximum 200), containing only metrics currently associated with that exact tenant/client/project. Empty mappings are valid and mean no report metrics, not all metrics. Database triggers recheck membership during mutation. Removed project associations cannot appear in plugin reports, even if their IDs remain in old configuration/audits.

GET `/api/admin/targets/:tenant/:client/:project/plugins` returns `{plugins:[{key,enabled,revision,metricIds,updatedAt}]}`. Missing plugins are omitted.

POST to the same route takes `{key,enabled,metricIds,expectedRevision,idempotencyKey}` and returns `{key,enabled,revision,metricIds,updatedAt,replayed}`. The existing server-verified superadmin gate is required. Writes enforce exact configured Origin, JSON content type, a 32 KiB streamed body limit and 30 changes per verified identity per ten minutes. Identity is derived from the verified session, never request roles. Browser audit attribution hashes the verified issuer/subject and creates no principals or grants. MCP audit attribution uses the authenticated principal ID. Receipts and mutation are atomic. Reusing a key with different input fails; stale revisions fail. Retry an uncertain write only with the identical request/key.

MCP `get_project_plugins` and `set_project_plugin` take the same target fields and use existing `projects:read` and `projects:write` scopes plus client grants and OAuth operator restrictions. No additional OAuth scope or external service access is introduced.

## Reports and recipients

Both existing report routes accept optional `plugin=seo` or `plugin=instagram`. Unknown, absent or disabled plugins fail closed. With a plugin, only its explicit mapping intersected with existing report permissions and metric compatibility is returned. Known SEO namespaces (seo, openseo, search_console, google_search_console, gsc and ga4 organic) are excluded from Instagram; instagram/ig namespaces are excluded from SEO. Both browser/MCP writes reject incompatible selections. Unknown custom keys remain explicitly mappable for backwards compatibility. Old incompatible mappings remain in stored configuration/audits but cannot return values in the wrong plugin; their settings modal explains that the next save will remove those selections, never the observations. Without the parameter reports retain existing behavior.

GET `/api/targets/:client/:project/plugins` returns enabled configurations only. The target must resolve to exactly one authorized tenant. Returned metricIds are intersected with current, accepted, unrevoked and unexpired recipient grants and project associations. Plugin installation never expands a recipient's grant. Recipients cannot write configuration or read content metadata.

## Instagram metadata

Admin-only GET `/api/admin/targets/:tenant/:client/:project/plugins/instagram/content?cursor=...` requires an enabled Instagram plugin and returns `{items:[{id,title,kind,status,scheduledAt,publishedAt}],nextCursor}`. It reads at most 51 rows, returns 50 and uses the last returned ID as the next cursor.

Only stored Instagram-channel content linked to the project through existing content/metric associations, or matching the exact existing Instagram-account project reference, is included. Unlinked content is not guessed into a project. The current schema has no reels/posts type, so kind is null. Captions, assets, private provenance and credentials are not returned. Metadata is project-scoped, not restricted to the plugin's numeric metric mapping; only superadmins can see it. There is no publishing, direct Meta integration, synthetic metrics, scheduling automation or account connection in this feature.


## Browser workflow

The project home is a dashboard chooser with an Add plugin modal and individual SEO/Instagram cards. It does not render an aggregate report below the cards. Each installed plugin has a normal, deep-linkable dashboard at `/project?...&plugin=seo` or `plugin=instagram`; Back/Forward and reload preserve the selected dashboard. Plugin settings are a modal with a reviewed selection of the project's compatible existing metrics. Adding a dashboard from the chooser opens it after a confirmed save. Prefix-based checkbox suggestions are never saved automatically. Empty mappings have a clear empty state. Saving neither changes observations nor grants new recipient access. After an unconfirmed save, refresh the current settings before another write.

Client access/member invitations also open in a labelled native modal. Escape, Close and backdrop dismissal restore focus to the trigger; pending mutations temporarily prevent dismissal. Session changes dispose open dialogs and ignore stale responses. Modal content scrolls on small screens. Delivery still requires the existing explicit review and approval, and uncertain sends are never automatically repeated.

The user-facing model is **client → project → plugins**. The legacy `one_off_project` and `instagram_account` storage/API kinds remain compatible, but are no longer displayed as competing project types. Adding Instagram does not change an existing project's stored kind or account reference.


Mobile navigation closes on history/page restoration and retains the separate desktop collapsed preference. Its visible state does not rely on support for the CSS :modal selector.

The production CSP permits same-origin script files. Astro's small-script inlining is disabled so navigation is not silently blocked by CSP. `tests/navigationAssets.integration.ts` checks the actual built HTML, served navigation asset and Worker security header, complementing synthetic UI tests.

## Monthly agent prompt

Each enabled plugin dashboard has a **Copy current-month prompt** action. The review modal contains a copyable prompt and secure remote Streamable HTTP MCP setup instructions for `https://content.unreelviews.com/mcp`. No credential, token, current metric value or source payload is embedded. The visible privacy note explains that client/project identifiers and selected metric configuration are included and should go only to an authorized agent. Clipboard failure selects the text and explains manual copying. No source connection, observation write or OAuth consent occurs merely by opening/copying the prompt.

The prompt calculates the current month in the client's stored IANA timezone, independent of the report month currently displayed; if timezone is unavailable it explicitly requires verification rather than guessing. It requires refreshing configuration, using only selected compatible metrics and already authorized exact source accounts, respecting each metric's own reporting timezone/semantics, labelling current-month observations partial with actual coverage, preserving prior data, and using revision/idempotency safeguards. Empty selections stop; no fabricated data, broad grants, new mappings, publishing or silent source substitutions are authorized.

The Instagram route now mounts the dedicated four-card dashboard, follower history, and administrative content workflow described in [Instagram data contract](instagram-dashboard.md). Generic monthly comparison panels and unrelated metric kinds are not rendered there. Its initial report month is the current month in the verified client timezone; SEO retains the last completed-month default.
