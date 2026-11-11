---
name: unreel content administrator dashboard
description: Dark administrator chrome for the private read-only agency metrics workspace.
colors:
  admin-accent: "#8de0cd"
  admin-bg: "#101214"
  admin-surface: "#171a1d"
  admin-raised: "#202428"
  admin-border: "#2b3035"
  admin-text: "#edf1f3"
  admin-muted: "#a0a9b2"
  sidebar-bg: "#141719"
  navigation-current-bg: "#23332f"
  navigation-current-text: "#b4efdf"
  button-bg: "#24292e"
  button-text: "#e0e6ea"
  button-hover-bg: "#30383e"
  status-active-bg: "#213a2f"
  status-active-text: "#9ce3c0"
  status-paused-bg: "#3b3222"
  status-paused-text: "#e8ca8a"
  status-completed-bg: "#253346"
  status-completed-text: "#a8c8ef"
typography:
  headline:
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.9px"
  title:
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.2px"
  body:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontSize: "11px"
    fontWeight: 500
  total:
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-1px"
rounded:
  status: "5px"
  button: "7px"
  navigation: "8px"
  surface: "12px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "16px"
  inset: "20px"
  section: "24px"
  large: "32px"
  desktop-gutter: "40px"
components:
  button:
    backgroundColor: "{colors.button-bg}"
    textColor: "{colors.button-text}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.admin-muted}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  report-action:
    backgroundColor: "transparent"
    textColor: "{colors.admin-accent}"
    padding: "10px 0 10px 8px"
  navigation-current:
    backgroundColor: "{colors.navigation-current-bg}"
    textColor: "{colors.navigation-current-text}"
    rounded: "{rounded.navigation}"
    padding: "12px 14px"
  status-active:
    backgroundColor: "{colors.status-active-bg}"
    textColor: "{colors.status-active-text}"
    rounded: "{rounded.status}"
    padding: "3px 7px"
  directory:
    backgroundColor: "{colors.admin-surface}"
    rounded: "{rounded.surface}"
---

# Design System: unreel content administrator dashboard

## Overview

**Creative North Star: "Sleek, modern dark dashboard"** (user-pinned direction).

The administrator dashboard is a sleek, modern dark shell for unreel content’s private, read-only agency metrics workspace. Charcoal surfaces, restrained mint accents, clear totals and a project-first directory implement the user’s chosen direction. This is a code-led record of the delivered dashboard, not a broader brand identity.

Scope is administrator chrome on /admin only. Individual client/project themes and report visual styles are out of scope and inherited unchanged. Unthemed reports retain the default light palette; custom project themes are authoritative through project-theme.css and data-project-theme. The admin wrapper isolates report content and provides surrounding spacing. Product context comes from README.md; no PRODUCT.md or additional interview decisions are assumed.

**Key Characteristics:**

- Charcoal surfaces with restrained mint navigation and report actions.
- Clear totals, aligned project rows and compact supporting text.
- Responsive navigation and keyboard-accessible table scrolling.

## Colors

Mint is the primary accent for current navigation, report actions, keyboard focus and text selection. The neutral palette separates the charcoal canvas, sidebar and raised surfaces; light text and muted supporting copy establish hierarchy. Green, amber and blue status treatments accompany written state labels.

Token values above reflect `web/src/styles/admin.css`. They do not redefine the default client palette in `web/src/styles/global.css` or custom themes in `project-theme.css`, selected through `data-project-theme`.

## Typography

The dashboard inherits the existing Inter/system sans-serif stack; no new font asset is supplied. Headline and title roles establish page and directory hierarchy. Project names use medium emphasis (13px, weight 550); row metadata and actions remain compact (11–12px). Totals use tabular numerals. At the mobile breakpoint, page headings and totals reduce to 29px.

## Layout

The desktop sidebar is fixed (232px), with a matching workspace offset. The content area is centered with a maximum width of 1500px and padding of 42px 40px 24px; the top bar has a minimum height of 76px. Three equally sized totals share one divided surface above the project directory.

At widths up to 1100px, the sidebar narrows to 204px and content gutters to 24px. Up to 760px, navigation becomes an in-flow header, the workspace offset disappears and content gutters become 20px. Totals stay in three columns; footer content stacks. At 1600px and above, main top padding becomes 52px.

The project table keeps a minimum width of 690px inside a labeled, focusable horizontal scroll region. Columns prioritize project/account, client, workspace, status and report action. Long names wrap within cells rather than widening the page.

## Elevation & Depth

The administrator shell uses tonal layering and single-pixel borders without shadows. Row hover and selected-report backgrounds provide local state emphasis. Report surfaces inherit their existing treatment independently.

## Shapes

Surfaces use gently rounded corners; navigation and notices use smaller curves, buttons smaller still, and status labels are compact rounded rectangles. Avatar and tiny state markers are circular. Icons are authored SVG with a consistent 1.6 stroke width and rounded caps and joins.

## Components

- **Buttons:** bordered refresh action, quiet sign-out/pagination actions and mint report actions. Buttons have a minimum height of 36px; report actions use text padding. Hover lightens button surfaces or reveals the report underline. Disabled controls inherit reduced opacity and a waiting cursor.
- **Navigation:** current location has a mint-tinted surface, text and small marker; ordinary links use muted text and a raised hover surface. Mobile navigation becomes horizontal.
- **Totals:** a single three-part definition list with large tabular values, labels and short context. Values come from API totals, independently of pagination.
- **Directory:** one bordered surface contains the heading, table and pagination footer. Status includes written text and a small dot. Selecting a report marks its action and moves focus to the report region.
- **Notices:** readable tinted surfaces convey loading, empty and denied states. Authentication remains the existing Clerk flow; this document does not define a new form theme.

Administrator links, buttons and focusable regions have a mint focus outline (2px, offset 4px). Button, navigation and row background transitions use 150ms ease-out only when reduced motion is not requested. Selection and scrollbar colors follow the administrator palette. Report inputs, focus styling and report components remain inherited and outside this system.

## Do's and Don'ts

- Do keep administrator colors scoped to the administrator shell.
- Do preserve visible focus, status text and accessible table labels.
- Do use the existing SVG stroke icons and tabular numerals for totals.
- Don’t apply this palette or typography scale to individual client/project themes or report content.
- Don’t imply that dashboard controls can edit business data; this workspace is read-only.
