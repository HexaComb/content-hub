---
name: unreel content workspace
description: Shared dark client and administrator workspace, preserving custom
  project designs.
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
  control-border: "#394148"
  control-hover-border: "#56616b"
  secondary-text: "#c5cdd4"
  report-label: "#b8c2cb"
  chart-previous: "#58656e"
  neutral-status-bg: "#292f35"
  neutral-status-text: "#c7cfd6"
  declined-bg: "#3d2b23"
  declined-text: "#f1bd99"
  notice-bg: "#202b27"
  notice-text: "#d1dfd8"
  notice-border: "#45524e"
  row-bg: "#1d2125"
  row-hover-bg: "#1d2327"
  row-selected-bg: "#1c2c28"
  project-name: "#e1e7ec"
  icon-muted: "#95a4af"
  navigation-note: "#d1d8de"
  breadcrumb-text: "#d8dfe4"
  breadcrumb-divider: "#74808b"
  avatar-border: "#355147"
  scrollbar-thumb: "#505a63"
  backdrop: rgb(0 0 0 / .65)
typography:
  headline:
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.9px
  title:
    fontSize: 16px
    fontWeight: 600
    letterSpacing: -0.2px
  body:
    fontFamily: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif
    fontSize: 14px
    lineHeight: 1.5
  label:
    fontSize: 11px
    fontWeight: 500
  total:
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -1px
  compact-label:
    fontSize: 10px
  supporting:
    fontSize: 12px
  control:
    fontSize: 13px
  section-title:
    fontSize: 15px
    fontWeight: 600
  target-title:
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  context-title:
    fontSize: 22px
    lineHeight: 1.3
    letterSpacing: -0.5px
  mobile-metric:
    fontSize: 28px
  mobile-headline:
    fontSize: 29px
  metric:
    fontSize: 34px
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: -1px
rounded:
  status: 5px
  button: 7px
  navigation: 8px
  surface: 12px
  brand: 10px
spacing:
  compact: 8px
  small: 12px
  medium: 16px
  inset: 20px
  section: 24px
  large: 32px
  desktop-gutter: 40px
components:
  button:
    backgroundColor: "{colors.button-bg}"
    textColor: "{colors.button-text}"
    rounded: "{rounded.button}"
    padding: 8px 12px
    height: 44px
  button-quiet:
    backgroundColor: transparent
    textColor: "{colors.admin-muted}"
    rounded: "{rounded.button}"
    padding: 8px 12px
    height: 44px
  report-action:
    backgroundColor: transparent
    textColor: "{colors.admin-accent}"
    padding: 10px 0 10px 8px
  navigation-current:
    backgroundColor: "{colors.navigation-current-bg}"
    textColor: "{colors.navigation-current-text}"
    rounded: "{rounded.navigation}"
    padding: 12px
  status-active:
    backgroundColor: "{colors.status-active-bg}"
    textColor: "{colors.status-active-text}"
    rounded: "{rounded.status}"
    padding: 3px 7px
  directory:
    backgroundColor: "{colors.admin-surface}"
    rounded: "{rounded.surface}"
  report-input:
    backgroundColor: "{colors.admin-raised}"
    textColor: "{colors.admin-text}"
    rounded: "{rounded.button}"
    padding: 8px 10px
    height: 44px
  navigation-toggle:
    backgroundColor: transparent
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.navigation}"
    padding: 12px
    height: 44px
    width: 44px
---

# Design System: unreel content workspace

## Overview

**Creative North Star: "Sleek, modern dark dashboard"** (user-pinned direction).

The client and administrator dashboards share a sleek, modern dark shell for unreel content’s private, read-only metrics workspace. Charcoal surfaces, restrained mint accents, clear totals and readable reports extend the user’s chosen direction. This is a code-led record of the delivered application, not a broader brand identity.

The shared shell covers / and /admin; default reports and invitation/connection pages are also dark. Custom project designs remain authoritative inside data-project-theme. Product context comes from README.md; no PRODUCT.md or additional interview decisions are assumed.

The genuine unreelviews logo is copied byte-for-byte from the sibling project’s ../unreelviews/components/unreel_views.jpg into web/public/images/unreelviews-logo.jpg. Brand.astro shares it across the shell and access pages; Shell.astro uses the same JPEG as the favicon. CSS crops the displayed image without changing the source bytes.

## Colors

Mint marks navigation, report actions, keyboard focus and text selection. Neutral charcoal surfaces establish depth; light and muted text establish hierarchy. Written status labels accompany green, amber, blue and neutral treatments; report declines use warm orange.

The frontmatter records the shared admin.css, workspace.css, report.css and access.css values. The --admin-* token names are an inherited implementation detail shared by both roles.

**The Project Boundary Rule.** Default report styles apply only to :is(#dashboard,#report):not([data-project-theme]). Saved project colors, typography, layout and ordering remain authoritative through project-theme.css. Switching back to an unthemed target restores the dark default.

## Typography

The application retains its existing Inter/system sans-serif stack; no new font asset was introduced. Page headings and totals establish hierarchy, while controls and report metadata remain compact. The observed size steps are 10, 11, 12, 13, 14, 15, 16, 18, 22, 28, 29, 32, 34 and 36px. The smallest step is for compact labels and status; supporting report copy uses 11–12px. Mobile headings and totals use 29px; mobile metric values use 28px. Numeric totals, metric values and chart labels use tabular numerals.

## Layout

Workspace.astro owns both role-specific shells. Desktop navigation is fixed at 232px; the compact desktop breakpoint (1100px) reduces it to 216px. Collapsing it leaves an 80px icon rail and expands the content area. Only this preference persists in local storage.

At 900px and below, navigation.ts presents the sidebar as a native modal dialog, bounded to min(320px, 90vw), with no workspace offset. The top bar has a 68px minimum height, versus 76px on desktop. Main content is centered with a 1500px maximum width; desktop padding is 42px 40px 24px. Gutters reduce to 24px at 1100px and 20px at 760px. Wide desktop top padding becomes 52px at 1600px.

Default report metrics use four columns, two at 1200px and one at 380px. The comparison/context area becomes one column at 1200px; selectors and comparison charts stack at 760px. Administrator totals retain three columns. Tables scroll inside labeled, focusable regions; the directory has a 690px minimum width. Long names wrap without widening the page.

## Elevation & Depth

The shared shell and default reports use tonal layering and single-pixel borders without shadows. Hover and selected-row backgrounds provide local emphasis. The mobile drawer dims the background with a translucent black backdrop. Custom projects retain their own surface treatment.

## Shapes

Directory and welcome surfaces use 12px corners; navigation and notices use 8px; controls use 7px; compact status labels use 5px. The brand crop and default target avatar use 10px corners deliberately. SVG navigation icons use a consistent 1.6 stroke with rounded caps and joins.

## Components

- **Brand:** shared authentic image with role-specific subtitle; mobile uses the image alone. Collapsed navigation retains accessible link names and native title hints.
- **Navigation:** current links use mint-tinted surfaces. Desktop collapse preserves destination access. Mobile opening moves focus inside the dialog; Tab and Shift-Tab remain contained. Close, Escape and backdrop dismissal restore opener focus. Breakpoint changes restore nonmodal navigation and release background scrolling.
- **Buttons and fields:** shared shell buttons, navigation controls and default month controls target 44px. Report actions retain text padding. Hover lightens surfaces or reveals the report underline. Disabled controls inherit reduced opacity and a waiting cursor.
- **Reports:** default dark selectors, metric cards, comparison bars and provenance tables share report.css. Custom designs bypass those defaults. Loading, unavailable data and partial readings retain explicit text.
- **Directory:** a single bordered surface contains heading, table and pagination. API totals are independent of pagination. Selecting a report marks the action and focuses its region.
- **Access pages:** invitation and consent pages use the shared logo and dark palette. Clerk appearance uses supported background, foreground, primary, muted and input variables; live authentication/provider redirects remain unverified.

**The Visible State Rule.** Shared links, buttons and focusable regions use mint focus outlines (2px, offset 4px); status is always written. Tables retain keyboard scrolling. Button and row background transitions use 150ms ease-out only when reduced motion is not requested. No navigation transition is currently authored. Custom projects retain their own focus colors.

## Do's and Don'ts

- Do share shell behavior across client and administrator views.
- Do preserve visible focus, explicit status text, accessible table labels and tabular numeric values.
- Do reuse the authentic logo and authored SVG navigation icons.
- Don’t override a saved project design with default report styling.
- Don’t imply that read-only dashboard controls edit business data.
