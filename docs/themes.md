# Project and account presentation

An agent can design a project/account's reporting page through MCP without replacing the reporting application. The presentation is a **versioned, declarative design document**, separate from the metrics and reporting rules. Instagram accounts and one-off projects use the same mechanism. This is per target, not a tenant-wide brand setting.

## Agent workflow

1. Read `get_project_theme` with the authorized `clientId` and `projectId`. It returns the current theme, independent revision, capabilities and three editable starting designs.
2. Compose a complete design. Every token is configurable; the starting designs are examples, not fixed templates.
3. Call `validate_project_theme` to check the proposed design without changing anything. It returns a normalized design, **not a browser screenshot or a saved preview**.
4. Call `update_project_theme` with the complete theme, the revision just read, and a unique idempotency key. This makes the appearance visible to already-authorized viewers of that target.
5. Reload the client report or administrator report to see it. Existing open pages pick it up on their next report request.
6. Use `reset_project_theme` with the current revision to restore the default appearance. Reset advances the theme revision and records a receipt; it never deletes history.

After uncertain completion, replay the **same** request and idempotency key. A different design needs a new key. If a competing writer changed the revision, read again and reconcile rather than blindly overwriting. Theme revisions do not affect project, metric or invitation revisions.

## Design vocabulary

- Seven six-digit hex colors: page background, card surface, raised surface, primary text, secondary text, accent and border.
- Heading type: sans, editorial serif, bold display or monospace. Body type: sans or humanist. All are local/system font stacks with fallbacks; exact glyphs vary by device. No font service is contacted.
- Hero: compact, editorial or banner.
- Responsive metric grid: two, three or four columns, reducing on smaller screens.
- Comfortable or airy spacing, standard or wide content width, square/soft/rounded corners.
- Outlined, solid or accent-edged metric cards.
- No divider, simple line, stripes or checker decoration.
- Metrics-first or comparison-first section order. All report sections remain present, and DOM reading order follows the visual order.
- Plain-text brand eyebrow and tagline. These do not replace the canonical project identity, report headings, metric labels, values, units or quality warnings.
- Logo images are deferred in this release: `brand.logo` must be `null`. All embedded and remote image payloads are rejected, including PNG/JPEG/WebP/SVG. A small encoded file can expand into an unbounded image or animation, so image support requires a separate, bounded decoding and validation pipeline. Brand identity currently uses text, colors, typography and decorative CSS patterns.

Previous-period bars also retain a stripe pattern so their distinction is not color-only. All normal theme text and accent colors require at least 4.5:1 contrast against all three surfaces. Improvement/decline and missing/partial-data badges retain fixed, readable color pairs. The number formatter, complete-period comparison rules, current/prior month labeling and source/quality table are not configurable through themes.

## Permissions and isolation

`themes:read` allows reading and validating designs on explicitly granted clients. `themes:write` allows updating/resetting them. These are separate from `projects:write`, `metrics:write` and administrator access. An invitation recipient can see the appearance only with an active grant for that exact project; no extra report metrics or projects are disclosed.

The OAuth metadata and consent UI recognize both new scopes, but this release **does not add them to any existing operator ceiling, token, delegation or client grant**. An operator must deliberately provision the permissions and the person connecting must approve them. Write scopes remain unchecked by default. Existing connections cannot silently gain theme-write authority.

Storage and every query use the composite tenant/client/project identity. The tenant is resolved from the authenticated principal, never a tool argument. Theme writes update only `project_themes` and append-only `theme_events`. Receipts and the guarded mutation share an atomic D1 batch. Theme reads never authorize report access; they run only after the existing target authorization, before the portal's final permission recheck.

The renderer applies a fixed set of CSS variables and enumerated attributes to the report canvas, never the document root. Authentication, navigation, access controls, OAuth consent and administrator listings remain outside the theme boundary. Theme copy uses `textContent`; the renderer does not accept or assign image sources. No code evaluation, arbitrary selectors, remote resource fetch or CSP relaxation is introduced. An invalid stored design falls back to the default appearance, and navigation clears the previous design before loading the next target.

## Deployment and verification

Apply `0008_project_themes.sql` before deploying the code that reads themes. It adds independent theme storage and immutable audit history; it changes no existing project/report data or authorization grants. Keep the migration when rolling code back, so themes can be restored without losing history.

Run `npm run check` for TypeScript, SQL/domain/security tests, the Astro/Worker builds and runtime MCP coverage. New tests cover malicious design fields/URLs, contrast, scope and tenant/client/project isolation, stale revisions, same-key races, reset, immutable history, invalid stored design fallback, and unchanged report values before/after styling.

`web/tests/theme-browser-qa.mjs` is a synthetic local browser suite for client/admin layouts at 1440, 1024, 768, 390 and 320px, reset/switch cleanup, hostile plain text and invalid-theme fallback. It uses the actual production renderer in a separate QA bundle. Its outputs and fixture build directory are ignored by Git; the QA fixture is not a production route. Run it with a supported local Chromium and `PLAYWRIGHT_MODULE` if Playwright is provided outside the project. Live Clerk sign-in is not part of this synthetic suite.

## Deliberate limits

This is not arbitrary website execution. New report widgets, data sources, chart types, export templates, shared page links, embedded/remote brand images, custom font uploads and per-client inheritance require separate implementation. `validate_project_theme` is validation only; there is no persisted draft/publish lifecycle or screenshot-generation service. Theme text is supplied content, not verified analysis or authorization.
