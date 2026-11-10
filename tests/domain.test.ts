import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, compareReadings, monthRange, previousMonth } from "../src/domain.ts";
import { metricInput, observationInput } from "../src/schemas.ts";

const complete = (value: number) => ({ value, quality: "complete" as const });
test("December rollover and January prior month", () => {
  assert.deepEqual(monthRange("2026-12"), { start: "2026-12-01", end: "2027-01-01" });
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.throws(() => monthRange("2026-13"));
});
test("lower ranking position is improvement", () => {
  const result = compareReadings(complete(4), complete(8), "lower", "position");
  assert.equal(result.change, "improved"); assert.equal(result.relativePercent, -50);
});
test("zero baseline never produces infinity or fabricated percent", () => {
  const result = compareReadings(complete(12), complete(0), "higher", "count");
  assert.equal(result.relativePercent, null); assert.equal(result.reason, "zero_baseline");
});
test("tiny nonzero baselines do not overflow relative change", () => {
  const result = compareReadings(complete(1), complete(Number.MIN_VALUE), "higher", "score");
  assert.equal(result.relativePercent, null); assert.equal(result.reason, "relative_change_out_of_range");
});
test("extreme finite values cannot silently overflow an improvement report", () => {
  const result = compareReadings(complete(1e308), complete(-1e308), "higher", "score");
  assert.equal(result.change, "not_comparable"); assert.equal(result.reason, "numeric_change_out_of_range");
});
test("missing and incomplete periods are not comparable", () => {
  for (const current of [null, { value: null, quality: "missing" as const }, { value: 50, quality: "partial" as const }]) {
    const result = compareReadings(current, complete(10), "higher", "count");
    assert.equal(result.change, "not_comparable"); assert.equal(result.delta, null);
  }
});
test("percentage points are distinct from relative percent", () => {
  const result = compareReadings(complete(6), complete(4), "higher", "percent");
  assert.equal(result.percentagePoints, 2); assert.equal(result.relativePercent, 50);
});
test("neutral and signed custom metrics are supported", () => {
  assert.equal(compareReadings(complete(3), complete(-3), "neutral", "score").relativePercent, 200);
  assert.equal(compareReadings(complete(3), complete(-3), "neutral", "score").change, "changed");
});
test("canonical JSON ignores property ordering", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 1 } }), canonicalJson({ a: { c: 1, d: 2 }, b: 1 }));
});
const observation = { clientId: "demo", metricId: "custom", periodStart: "2026-10-01", periodEnd: "2026-11-01", value: 15.5, quality: "complete", source: { provider: "manual" }, collectedAt: "2026-11-02T10:00:00Z", idempotencyKey: "example-001", expectedRevision: 0 };
test("arbitrary observations validate without platform-specific keys", () => assert.equal(observationInput.parse(observation).value, 15.5));
test("reject invalid dates, infinity, invalid coverage and silent corrections", () => {
  for (const replacement of [{ periodStart: "2026-02-30" }, { value: Infinity }, { value: null }, { expectedRevision: 1 }, { periodEnd: "2026-09-01" }])
    assert.equal(observationInput.safeParse({ ...observation, ...replacement }).success, false);
});
test("metrics have explicit definition, units and valid source timezone", () => {
  const value = { clientId: "demo", key: "custom.number", label: "Any number", category: "custom", unit: "score", direction: "neutral", semantics: "custom", timezone: "America/Los_Angeles", definition: "A user-defined score." };
  assert.equal(metricInput.safeParse(value).success, true);
  assert.equal(metricInput.safeParse({ ...value, timezone: "invented/place" }).success, false);
});
