# Content exposed through MCP

## Agent-neutral contract

Any authorized agent can inspect content records through `list_content` and `get_content`. Access is governed by tenant, client grant and `content:read`, not by the name or publishing capability of a particular bot. Muse could be a future consumer, but no Muse integration exists or is required.

A content record carries the client, channel/account reference, title, caption, asset references, status, schedule instant and timezone, approval metadata, revision, external publication identifier and related metric IDs. Keep reusable content metadata here; provider credentials stay outside records.

Asset references should identify durable objects/URLs, content type and alt text. Never store long-lived signing secrets or temporary signed download URLs in public source, logs or report exports. When private media delivery is implemented, authorize access before minting short-lived URLs. Rendering external embeds requires an allowlist and privacy review.

## Lifecycle

Planned states: `draft → approved → scheduled → publishing → published`, with `failed` and `cancelled` branches. Scheduling requires approval metadata. Published records require a provider receipt and publication time. The SQL schema models these states; the initial MCP only reads them. Editing, approval and scheduling tools are not implemented yet.

Approval must refer to a specific content revision and destination. Changes to caption, assets, destination or meaningful timing invalidate approval. Explicit timezones are required; store execution instants in UTC and keep the original timezone for display. Resolve ambiguous/nonexistent daylight-saving times when scheduling rather than guessing.

## Coordination before enabling publication

Simply reading a scheduled item must not cause publication or reserve it. Before automated consumers publish, implement:

1. A durable per-item claim with expected revision, owner, random fencing token and bounded lease expiry.
2. Atomic state changes and a unique publish-attempt/idempotency key bound to approved revision, channel and account.
3. A check of approval, schedule, lease and destination immediately before any external action.
4. A publication receipt containing provider post ID, timestamp and external URL.
5. Reconciliation after timeout/uncertain results. Do not blindly publish again just because the lease expired. Check the provider result before retrying.
6. Versioned events recording claims, approvals, cancellations and receipts. Never overwrite an approved post's history.

Content Hub does not currently perform these steps or publish anything. Do not attach an unattended publisher until this coordination and its tests exist. Publisher authorization belongs to the external agent's own account and permission policy; read access to Content Hub is not permission to post.

## Metrics linked to content

The `content_metrics` table links content to generic metric definitions while enforcing the same tenant and client. A post's views/saves can therefore use the same observation model as account-level metrics. This does not imply a video overlay or automatic platform sync.
