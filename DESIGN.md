# unreel content — In perspective

The product is a dark editorial workspace: clear enough for client reporting, with the restraint and character of a premium creative brand. Ink-black surfaces, warm ivory, mint rules, serif accents and an offset-frame motif connect the interface to the sharing card. No decorative gradients or section counters.

## Foundations

`web/src/styles/tokens.css` defines the shared chrome palette and spacing vocabulary. Project canvases continue to own their `--project-*` variables.

| Role | Value |
| --- | --- |
| Background | `#101214` |
| Surface | `#171a1d` |
| Raised surface | `#202428` |
| Text | `#f1efe9` |
| Supporting text | `#a8afb1` |
| Accent | `#a6e3cd` |
| Border | `#30363a` |
| Control border | `#424a4e` |

Use a 4px base rhythm: 8/12/16 for controls, 24 for compact panels and grids, 32 for section spacing, and 48 for desktop gutters. Desktop content is bounded to 1536px. Gutters step down to 32px, 24px and 16px. Panels generally use 12px corners; controls use 6px. Surfaces are flat, separated by rules rather than glow or heavy shadows.

Use the existing system sans-serif stack for navigation, labels and data. Main headings scale from 36px to 56px. Editorial accents use Georgia italic: the wordmark, sidebar signature, sign-in welcome, report context and guide intro. Small monospaced kickers identify the page’s purpose. Numeric reports use tabular figures. Do not download fonts or depend on an external font service.

## Navigation and hierarchy

`Workspace.astro` provides the shared shell for reports, project directory, Skills and Connected apps. Navigation is grouped into Workspace and Resources. The active destination has a mint surface and a small square marker. The desktop sidebar is 248px, 224px below 1200px, or an 80px collapsed rail. At 900px it becomes a modal drawer using the existing focus containment, Escape, backdrop dismissal, scroll locking and focus return controller.

Each page has one primary heading, a short explanation, and the decorative offset frame. The frame is hidden on small screens and excluded from the accessibility tree. Supporting section titles remain smaller. Primary work appears before optional technical details.

Project pages use simple underlined dashboard tabs. A compact tools row contains the existing settings and prompt actions. Explanations of data sources and dashboard setup sit in an expandable disclosure; missing setup or mapping warnings open it automatically. Client access actions and the separate client-page links retain explicit labels.

The directory includes a search field for already loaded entries. It filters project/client/status text locally and states how many loaded entries match. Pagination remains available; this is not a global server search. On phones, the directory table becomes a stacked project list with status and report actions in each row. Refresh and session changes clear the filter. API totals are independent of loaded or filtered rows.

## Reports

Default reports use 4 KPI columns, 2 below 1100px and 1 below 420px. Cards give the current value, previous-month baseline, absolute change and relative comparison. Text explicitly identifies missing/partial data; colors never establish improvement on their own. The comparison chart and data-quality notes have separate visual weight. Metric source tables keep labeled keyboard-scrollable regions.

Instagram uses the same spacing, typography and mint palette, with grouped history-range controls and an expandable daily table. Missing dates still break lines; no estimates or sample readings are introduced. All workflow confirmation behavior remains in the existing controller.

Saved report themes remain authoritative. Default report CSS is scoped outside `data-project-theme`. The standalone `/client` page uses dark chrome around its authored canvas. Uncustomized client presentations now start with the dark **In perspective** theme; explicitly saved project designs continue to render their own colors, typography, structure and order.

## Access, guides and dialogs

Invitations and OAuth review share dark access cards, large clear titles, mint primary actions and consistent 24/32/48px insets. Consent choices, recipient scopes, expiry and confirmation requirements remain explicit. Clerk appearance uses the same product colors.

Connected apps now uses the common workspace shell. App authorizations appear in a responsive card grid with permission details and the existing explicit disconnect confirmation.

Skills provides a split introduction, unnumbered setup steps, a category jump navigation, an expandable connection guide and evenly spaced workflow cards. Copy controls keep their existing keyboard and fallback behavior.

Dialogs use a sticky header, 32px content padding (16px on narrow phones), mint focus outlines and the existing native dialog/focus behavior. All interactive controls target at least 44px. Reduced-motion preferences remain respected.

## Sharing

`SocialMeta.astro` supplies brand-only OpenGraph and Twitter large-image tags on every page, including the standalone client report. It uses the verified production origin from `cloudflare.config.ts` and a static public PNG at `/images/unreel-content-og.png` (1731 × 909).

The image is a bespoke editorial card: ivory sans/italic lettering and offset mint/ivory frames on ink black. Its exact copy is “unreel content”, “Your work. In perspective.” and “Projects · Performance · Progress.” Metadata uses no private project names, account identities, invitation fragments or query strings. A sharing preview does not grant access to reports.

## Verification boundary

Use `npm run check` for both TypeScript projects, backend/SQL/frontend tests, Astro/Worker builds and Worker integration tests. Check built metadata against the PNG dimensions and verify every generated HTML route includes the shared tags.

Visual browser validation remains outstanding in this environment: cloud browsing cannot reach the local preview and local Chromium previously failed on a blocked singleton socket. Do not describe the design as visually verified or claim live Clerk/provider flows were tested.
