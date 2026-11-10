import test from "node:test";
import assert from "node:assert/strict";
import { createContentInput, scheduleContentInput } from "../src/contentSchemas.ts";
test("content inputs bound assets and enforce UTC and timezone", () => {
  const base = { clientId: "c", idempotencyKey: "key-123456", channel: "instagram", accountRef: "account", title: "Post", caption: "", assets: [] };
  assert.equal(createContentInput.safeParse(base).success, true);
  assert.equal(createContentInput.safeParse({ ...base, assets: [{ url: "javascript:alert(1)", mediaType: "image" }] }).success, false);
  assert.equal(createContentInput.safeParse({ ...base, caption: "x".repeat(20001) }).success, false);
  const schedule = { clientId: "c", contentId: "p", expectedRevision: 1, idempotencyKey: "key-123456", scheduledAt: "2099-01-01T00:00:00Z", timezone: "America/New_York" };
  assert.equal(scheduleContentInput.parse(schedule).scheduledAt, "2099-01-01T00:00:00.000Z");
  for (const scheduledAt of ["2099-02-30T00:00:00Z", "2099-01-01T00:00:00", "2099-01-01T00:00:00+03:00"]) {
    assert.equal(scheduleContentInput.safeParse({ ...schedule, scheduledAt }).success, false);
  }
  assert.equal(scheduleContentInput.safeParse({ ...schedule, timezone: "fake/timezone" }).success, false);
});
