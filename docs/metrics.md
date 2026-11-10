# Arbitrary metrics, precise reporting

## Metric definitions

Each client can define any numeric measure. Examples are optional conventions, not a schema restriction: Instagram followers, reach or saves; search clicks, impressions, ranking position or a user-defined score.

A definition has a stable key, label, category, unit, direction (`higher`, `lower`, `neutral`), semantics (`period_total`, `period_average`, `snapshot`, `custom`), source reporting timezone, dimensions and a plain-language definition. Use separate keys/definitions for materially different providers, accounts, query filters, devices or measurement methods. Units and meaning do not change in place.

Use `percent` for values on a 0–100 scale. For currency, put the currency in the unit (for example `USD`). A percentage is not interchangeable with a ratio. Custom negative numbers are allowed. Values use IEEE-754 numbers, bounded to ±Number.MAX_SAFE_INTEGER; non-finite numbers are rejected. This is an analytics store, not an exact-decimal financial ledger.

## Observations

Every value has an exact half-open reporting interval `[periodStart, periodEnd)` in the metric's reporting timezone, collection timestamp, provider/reference/note, coverage quality and recorded actor/time. A missing value is `null`, never an invented zero. A partial month stays marked partial even if its number looks favorable.

For a snapshot metric, the definition must say which point the interval's value represents, such as month-end follower count. The current API assumes agents supply the authoritative observation for that interval; it does not infer a month-end value from arbitrary samples.

Corrections append a new revision. `expectedRevision = 0` creates a first value; a later correction supplies the current revision plus a reason. A stale writer receives a conflict. A retry with the same idempotency key and exactly the same input returns the saved result; reusing a key with different data is rejected. Concurrent inserts are protected by database uniqueness.

## Month comparisons

The initial report uses exact month-to-next-month boundaries. It reads the latest stored revision for each interval and compares only complete values.

- Absolute change: `current - previous`.
- Relative percentage: `100 * (current - previous) / abs(previous)` when the baseline is not zero. The absolute denominator makes signed custom metrics explicit; interpret these carefully.
- Zero baseline: show absolute change and a `zero_baseline` reason, never infinity or a fabricated percentage.
- Percent-valued measures: also show percentage-point change. For example 4% to 6% is +2 percentage points and +50% relative.
- Lower-is-better measures such as ranking position reverse the improvement interpretation.
- Missing/partial data: `not_comparable`, with no improvement badge.
- Neutral metrics: changed/unchanged, without judging success.

Daily observations are not automatically summed. Distinct reach is not additive; follower counts are snapshots; click-through rate needs numerator/denominator weighting; average search position is not a simple average of daily averages. A later aggregation engine needs metric-specific policies and sufficient source data. Until then, agents submit source-provided monthly totals/averages/snapshots explicitly.

Comparisons describe changes, not proof that the agency caused them. Reports must retain provider/filter/timezone differences, source freshness and whether definitions are genuinely comparable.
