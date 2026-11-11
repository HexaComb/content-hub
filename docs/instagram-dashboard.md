# Instagram dashboard data contract

The dedicated dashboard displays only four registered metric kinds. A metric must be explicitly mapped into the project's enabled Instagram plugin and, for recipients, included in their current accepted metric grant. Merely naming a metric does not grant access. More than one mapped metric for the same kind is ambiguous and produces an unavailable card; choose one definition rather than guessing or adding them together.

## Recommended canonical definitions

- `instagram.followers`: nonnegative integer, unit `followers`, semantics `snapshot`. Record the observed follower count for an exact client-local calendar day: periodStart is YYYY-MM-DD and periodEnd is the following date, exclusive.
- `instagram.posts`: nonnegative integer, unit `posts`, semantics `period_total`. Count actual posts since the selected calendar month's first day, not a rolling seven-day window.
- `instagram.average_likes_per_post`: nonnegative number, unit `likes/post`, semantics `period_average`. Submit the actual source-supported average and document the eligible posts and denominator in the source observation; never average already averaged daily values in the dashboard.
- `instagram.posts_per_week`: nonnegative number, unit `posts/week`, semantics `period_average`. Submit a source-supported average with its exact coverage and denominator; the dashboard never manufactures it from monthly totals.

Use the client's verified IANA timezone for every definition and period. The dashboard rejects a metric whose definition timezone differs from its project's client timezone. Do not silently assume UTC. Inspect the existing definitions before creating anything, and reuse the correct definitions and current project/plugin mapping.

Explicit aliases use an `instagram` or `ig` namespace and `.`, `_`, `:`, or `-` separators: followers/follower_count, posts/posts_since_month_start, average_likes_per_post/avg_likes_per_post, posts_per_week/posts_per_week_avg. Keep only one metric selected for each kind; multiple selected aliases are ambiguous and do not produce a value. Other kinds such as reach, impressions, growth and engagement remain stored but are not displayed by this endpoint. Labels do not classify data.

## Reporting coverage

All period ends are exclusive. A finished monthly aggregate uses the exact first day of the month through the first day of the next month. During the current month, record a month-to-date observation beginning on day one and ending at the actual covered boundary (no later than tomorrow in the client timezone), with quality `partial`. The existing full-month interval with `partial` quality is also readable for backwards compatibility. Supply the actual collection timestamp and accurate source/coverage metadata through the normal observation tool. Never label incomplete monthly coverage as complete. The dashboard additionally displays current-month aggregates as partial even when an older source marked them complete, retaining the original `sourceQuality` alongside it.

Daily follower snapshots are not summed, interpolated or carried forward. The latest revision of each exact daily interval supplies its single chart point. Missing days are null gaps, never zero. The Followers card uses the latest daily snapshot in the selected month, or an explicitly stored monthly snapshot if no daily snapshot exists. Its date and coverage remain visible; it is not necessarily today's count. The point for an unfinished local-today interval displays partial coverage while preserving the source quality.

Charts provide the last seven calendar dates, a trailing calendar month, 90 calendar dates, and six trailing calendar months. Ranges end just after the client-local current date, or just after the final date of a historical selected month. Month shifts clamp to the last available day of a shorter month. Future selected months are rejected.

Invalid numeric semantics are never displayed as valid data. Negative values for any of the four kinds, fractional or unsafe-integer followers/posts, and nonfinite values are returned as `value:null`, `quality:missing`, `reason:invalid_value`. The original `sourceQuality`, observation collection time and period boundaries remain available. Stored observations are not corrected or deleted by this display guard. Fix a source error through the existing revisioned observation correction workflow.

The reporting response omits source payloads, notes, credentials, URLs and other private provenance for both readers; it supplies explicit numeric coverage, timestamps and quality. Unavailable cards distinguish not configured, ambiguous metrics, timezone mismatch, no observation, missing value and invalid value.

## Production and answer history

Ideas are project-scoped records with a title, idea, explicit reel/post format and platform `instagram`. A new record starts as proposed. A yes decision queues content creation; a no decision declines it. Neither decision publishes externally. Accepted ideas can advance from queued to in_progress to completed. Completion requires an actual supplied HTTPS content link and evidence; the app does not verify or fetch that link.

An answered idea's title, idea and format cannot be silently rewritten. Completed and declined records are terminal; propose a new idea if the plan changes. Each mutation has independent optimistic revisions, idempotency receipts and an immutable audit. Answer history contains the exact yes/no decision and its then-current idea/title snapshot. Existing project-linked Instagram drafts and active production records are included in pending with unknown format where the original content schema lacks one.

Workflow and decisions are available only to verified browser administrators and appropriately scoped MCP clients. Recipient metric invitations do not authorize content/ideas/answer history. No publishing service, external integration, credential, invitation, grant or automatic production action is created.

## Reading the dashboard

Both workspace and standalone client cards use `appendInstagramKpi`: a short name, one-line explanation, recorded value and explicit coverage dates. Exclusive interval ends are displayed as the last included date. A partial-period label stays visible, while collection timestamps and differing source-quality labels are available in “View recording details”. These cards do not invent a previous-period comparison. Followers remain the latest recorded snapshot, not a promise of today's live audience size.

Follower history uses readable calendar labels and reports how many days have observations. “Past month” means the trailing calendar-month range, distinct from the reporting-month selector. Missing days remain gaps. Workflow data and actions retain their original authorization and confirmation boundaries.
