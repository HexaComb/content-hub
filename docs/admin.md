# Administrator reporting

`/admin` is a read-only, application-wide overview, separate from the recipient portal. It lists every client and project across this deployment's tenants, including clients without projects and archived projects. Overview results are paginated in stable tenant/client/project order; use **Load more projects** until no continuation remains. Counts describe the whole application, not only the visible page. Refresh restarts pagination if data changed while browsing.

Every administrator API request first resolves a current Clerk-verified human identity. `requireSuperAdmin` then requires the configured issuer, a verified primary email exactly matching `marco@hexacombllc.com` or `christian@unreelviews.com` (case/outer whitespace normalization only), valid Clerk configuration and `ADMIN_ACCESS_ENABLED=true`. A user-supplied role, email, alias, invitation, MCP token or OAuth operator mapping cannot confer this role. There is no public administrator signup or promotion endpoint. Signing in does not assign access.

- `GET /api/admin/session`: server-resolved administrator role.
- `GET /api/admin/overview?offset=0`: global counts plus up to 100 client/project rows and a `nextOffset` continuation. A client with no projects gets a row with a null project.
- `GET /api/admin/targets/:tenantId/:clientId/:projectId/report?month=YYYY-MM`: read-only exact-month comparisons for metrics currently linked to that project. The ownership tuple is mandatory, avoiding collisions between tenants.

These reads neither require nor create recipient invitations. Normal `/api/targets` and recipient reports retain their issuer/subject-bound, target-specific and frozen metric-grant restrictions, even for an administrator using the client view. No global grants or ordinary client privilege changes are added. Report responses contain only target details, metric definitions and comparison values/quality/collection dates. They do not return credentials, invitation tokens, private notes or internal source payloads.

Empty workspaces explicitly report **No clients or projects yet**, and existing clients without projects report **No projects yet**. This is not an invitation-access error. Business data changes remain available only through separately authorized MCP tools. The overview does not provision credentials, create users, assign roles, change mappings, send invitations or publish content.

Deployment and administrator-gate activation are separate operator actions requiring authorization. Adding this code alone does not enable access. MCP OAuth enablement and persistent connection grants remain separate security decisions.
