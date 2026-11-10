import test from "node:test";
import assert from "node:assert/strict";
import { repository } from "../src/repository.ts";
import { canonicalJson, sha256 } from "../src/domain.ts";
import type { ObservationInput } from "../src/schemas.ts";

test("retry recovers a commit between idempotency lookup and revision read", async () => {
  const input: ObservationInput = { clientId: "client", metricId: "metric", periodStart: "2026-10-01", periodEnd: "2026-11-01", value: 1, quality: "complete", source: { provider: "synthetic" }, collectedAt: "2026-11-02T10:00:00Z", idempotencyKey: "concurrent-key", expectedRevision: 0 };
  const hash = await sha256(canonicalJson(input));
  let lookups = 0;
  // Deliberately interleave the other request's commit before MAX(revision).
  // A partial interface test double is isolated to this unit test.
  const db = { prepare(sql: string) { return { bind() { return { async first() {
    if (sql.includes("client_grants")) return { "1": 1 };
    if (sql.startsWith("SELECT id FROM metrics")) return { id: "metric" };
    if (sql.includes("MAX(revision)")) return { revision: 1 };
    if (sql.includes("idempotency_key")) return ++lookups === 1 ? null : { id: "saved", revision: 1, payload_hash: hash };
    throw new Error(`Unexpected query: ${sql}`);
  } }; } }; } } as unknown as D1Database;
  const result = await repository(db, { tenantId: "tenant", id: "agent", scopes: ["metrics:write"] }).recordObservation(input);
  assert.deepEqual(result, { id: "saved", revision: 1, replayed: true });
});
