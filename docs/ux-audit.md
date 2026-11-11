# Workspace UX/UI audit and remediation

Date: 2026-11-10. Scope: client and administrator dashboards, shared navigation, invitation and connection entry pages. Custom project designs are preserved. This is a code and browser review, not a WCAG certification or a production authentication assessment.

## Implementation integrity verdict

The original delivery failed the requested application-wide scope: `/admin` had the new design while `/` retained the old light shell. Both views now use `Workspace.astro`, `navigation.ts`, and the same default report styles. Saved designs remain behind the `data-project-theme` boundary. The unreelviews logo is the existing asset from the local unreelviews project, copied unchanged into `web/public/images/unreelviews-logo.jpg`.

## Audit health

Scores are qualitative 0–4 implementation assessments, with verification limits below.

| Dimension | Before | After | Evidence and remaining limit |
| --- | ---: | ---: | --- |
| Accessibility | 2 | 3 | Labeled controls, visible focus, modal Tab/Shift-Tab handling, Escape and focus return; no screen-reader or live Clerk audit. |
| Performance | 3 | 3 | Shared static components and a small navigation module; no new dependency. Clerk remains dynamically loaded and still produces a large-chunk build warning. No field performance measurements. |
| Theming | 1 | 3 | Both default dashboards and entry pages are dark; custom project CSS and theme data remain untouched. Some static color literals remain alongside shared tokens. |
| Responsive behavior | 2 | 3 | Desktop collapse, mobile/tablet drawer, 44px navigation/month controls, bounded table scrolling; tested in Chromium at 320–1440px, not on physical devices. |
| Implementation integrity | 2 | 4 | One navigation implementation, authentic brand asset, preserved auth guards and scoped report defaults. |
| Total | 10/20 | 16/20 | Good within the verified scope; remaining limitations are explicit. |

## Findings and fixes

### P1 — Client view omitted from the dark redesign

**Location:** `web/src/components/Dashboard.astro`, original `web/src/styles/global.css`.

Users changing roles saw two unrelated interfaces. The client dashboard, selectors, metric cards, comparisons and provenance table now use the dark default in `report.css`. The default applies only to reports without `data-project-theme`. Custom palettes, typography, hero treatments and ordering remain authoritative, including after switching targets.

### P2 — Sidebar occupied mobile space and had no desktop control

**Location:** original `Dashboard.astro` sidebar and `admin.astro` sidebar.

Navigation stayed above the content on mobile and consumed a fixed desktop column with no collapse option. Both views now share a 232px sidebar, an 80px collapsed rail, and a modal drawer at 900px and below. Only the collapsed preference is persisted; it contains no identity, tokens or report data. The drawer locks background scrolling, contains keyboard focus, closes via its button, Escape or backdrop, and returns focus to the opener. Resizing restores nonmodal desktop navigation without leaving the page inert.

### P2 — Duplicated shell caused visual and behavioral drift

**Location:** `web/src/components/Dashboard.astro`, `web/src/pages/admin.astro`.

The navigation, header and account controls had separate implementations. `Workspace.astro` now owns these surfaces. Role-specific links remain server-authorized through the existing client scripts; rendering navigation never grants access.

### P2 — Compact controls were difficult touch targets

**Location:** original `.month-input button`, `.text-button`, navigation links.

Month arrows were 29×28px. Shared navigation and default report month controls now target 44×44px. This is a usability target, not a claim that the old dimensions alone violated WCAG 2.2 AA. Custom project controls are not overridden by the default stylesheet.

### P2 — Placeholder branding and inconsistent entry pages

**Location:** dashboard monogram, `invite.astro`, `authorize.astro`, Clerk appearance options.

The application used a text monogram rather than the supplied identity. A shared `Brand.astro` displays the genuine unreelviews logo; the favicon uses the same source. Invitation and connection pages adopt the dark palette. Clerk uses the installed SDK's supported appearance variables with explicit primary-button foreground and input colors. Live authentication remains unverified.

### P2 — Small report metadata and unnecessary technical copy

**Location:** default metric/provenance styles, client welcome and access pages.

Default report metadata was frequently 9px. Labels and supporting report copy now use 11–12px; provenance retains collection/source information and quality states. Sign-in copy focuses on the user's invitation and access, removing unnecessary Clerk/developer-account instructions from entry pages. Consent permissions and security explanations remain intact.

## Verification

- `npm run check`: TypeScript, domain/schema/security tests, web tests, Astro/Worker builds and runtime integration tests.
- `client-browser-qa.mjs`: real client rendering logic with synthetic authentication/API data; desktop collapse/persistence; mobile modal focus, Tab/Shift-Tab, Escape, touch opening/backdrop and resize; month navigation; default/theme switching; retry, empty metrics, no assigned targets, signed-out and denied states; shared administrator navigation.
- `admin-browser-qa.mjs`: totals, directory pagination, report selection, month controls and theme isolation.
- `theme-browser-qa.mjs`: 30 client/admin × theme × viewport variants, partial readings, theme reset, invalid-theme fallback and hostile text handling.
- `browser-qa.mjs`: actual unconfigured-authentication states and invitation fragment/retry behavior.
- Core default text/status pairs checked against their computed backgrounds at ≥4.5:1. Desktop, collapsed, mobile, drawer, custom-theme and empty-state screenshots inspected. Touch events are Chromium emulation, not physical-device evidence. Fixture data is synthetic and is not shipped to the application.

The design detector flagged the pre-existing hidden `theme-logo` element (intentional deferred theme support, not a visible broken image) and documentation scale advisories. Updated design documentation records the extended system; the placeholder theme element and custom designs are deliberately retained.

## What remains outside this audit

Live Clerk sign-in/provider redirects, real account access, physical mobile devices, screen-reader testing, field performance and cross-browser coverage still require their respective environments. Existing authorization, tenant boundaries and business-data behavior are preserved. A visual pass does not change the application's documented operational readiness.
