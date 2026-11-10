import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { sha256 } from "../src/domain.ts";

test("Worker MCP, D1 ingestion and client isolation", async t => {
  const mf = new Miniflare({
    workers: [{ config: {
      name: "content-hub-test", compatibilityDate: "2026-11-10", compatibilityFlags: ["nodejs_compat"],
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: await readFile(".cloudflare/output/v0/workers/default/bundle/index.js", "utf8") } } },
      env: { DB: { type: "d1", name: "test-db" } },
    } }],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const sql = await readFile("migrations/0001_initial.sql", "utf8");
  for (const statement of sql.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n").split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  const tokenA = "testA_" + crypto.randomUUID().replaceAll("-", "");
  const tokenB = "testB_" + crypto.randomUUID().replaceAll("-", "");
  for (const [tenant, token] of [["a", tokenA], ["b", tokenB]]) {
    await db.prepare("INSERT INTO tenants VALUES (?,?)").bind(tenant, "Synthetic agency").run();
    await db.prepare("INSERT INTO clients VALUES (?,?,?,?)").bind(tenant, "client", "Synthetic client", "UTC").run();
    await db.prepare("INSERT INTO principals VALUES (?,?,?,?,?,?,?)").bind(tenant, "agent", "Synthetic agent", await sha256(token), "2099-01-01T00:00:00Z", null, '["metrics:read","metrics:write","content:read"]').run();
    await db.prepare("INSERT INTO client_grants VALUES (?,?,?)").bind(tenant, "agent", "client").run();
  }
  const call = async (name: string, args: Record<string, unknown>, token = tokenA) => {
    const response = await mf.dispatchFetch("https://example.test/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const packet = JSON.parse(raw.startsWith("event:") ? raw.split("\n").find(line => line.startsWith("data: "))!.slice(6) : raw);
    assert.equal(packet.error, undefined, raw);
    return packet.result;
  };
  const decode = (result: { content: { text: string }[]; isError?: boolean }) => { assert.notEqual(result.isError, true, result.content[0].text); return JSON.parse(result.content[0].text); };

  await t.test("rejects missing credential and hostile browser origin", async () => {
    assert.equal((await mf.dispatchFetch("https://example.test/mcp")).status, 401);
    assert.equal((await mf.dispatchFetch("https://example.test/mcp", { headers: { Origin: "https://evil.example", Authorization: `Bearer ${tokenA}` } })).status, 403);
  });
  const definition = { clientId: "client", key: "anything", label: "A custom score", category: "custom", unit: "score", direction: "higher", semantics: "custom", timezone: "UTC", dimensions: {}, definition: "Synthetic arbitrary monthly score" };
  const metric = decode(await call("define_metric", definition));
  const observation = { clientId: "client", metricId: metric.id, periodStart: "2026-10-01", periodEnd: "2026-11-01", value: 50, quality: "complete", source: { provider: "test" }, collectedAt: "2026-11-02T10:00:00Z", idempotencyKey: "test-observation-oct", expectedRevision: 0 };
  await t.test("records and retries without double writing", async () => {
    const first = decode(await call("record_observation", observation));
    const retry = decode(await call("record_observation", observation));
    assert.equal(first.id, retry.id); assert.equal(retry.replayed, true);
    assert.equal((await call("record_observation", { ...observation, value: 90 })).isError, true);
  });
  await t.test("denies a different tenant's metric even with same client ID", async () => {
    assert.equal((await call("record_observation", observation, tokenB)).isError, true);
    assert.deepEqual(decode(await call("list_metrics", { clientId: "client" }, tokenB)), []);
  });
  await t.test("corrections preserve history and reject stale writers", async () => {
    assert.equal((await call("record_observation", { ...observation, idempotencyKey: "test-stale-key" })).isError, true);
    const result = decode(await call("record_observation", { ...observation, idempotencyKey: "test-correction-key", expectedRevision: 1, value: 60, correctionReason: "Source corrected" }));
    assert.equal(result.revision, 2);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM observations").first<{ n: number }>())?.n, 2);
  });
  await t.test("month report uses latest revision and source data", async () => {
    decode(await call("record_observation", { ...observation, periodStart: "2026-09-01", periodEnd: "2026-10-01", idempotencyKey: "test-september-key", value: 30 }));
    const result = decode(await call("compare_month", { clientId: "client", month: "2026-10" }));
    assert.equal(result.metrics[0].delta, 30); assert.equal(result.metrics[0].relativePercent, 100);
    assert.equal(result.metrics[0].current.revision, 2);
  });
  await t.test("concurrent same-payload retry creates one revision", async () => {
    const next = { ...observation, periodStart: "2026-11-01", periodEnd: "2026-12-01", idempotencyKey: "concurrent-key" };
    const results = await Promise.all([call("record_observation", next), call("record_observation", next)]);
    assert.equal(decode(results[0]).id, decode(results[1]).id);
  });
  await t.test("content retrieval is tenant-aware and does not publish", async () => {
    await db.prepare("INSERT INTO content_items(tenant_id,client_id,id,channel,account_ref,title,caption,assets_json,status,scheduled_at,schedule_timezone,approved_by,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("a", "client", "demo-post", "instagram", "demo-account", "Synthetic post", "A test caption", "[]", "scheduled", "2026-11-15T10:00:00Z", "UTC", "test-operator", "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z").run();
    const content = decode(await call("get_content", { clientId: "client", contentId: "demo-post" }));
    assert.equal(content.caption, "A test caption"); assert.equal(content.publishingEnabled, false);
    assert.equal((await call("get_content", { clientId: "client", contentId: "demo-post" }, tokenB)).isError, true);
    const list = decode(await call("list_content", { clientId: "client", status: "scheduled", limit: 1 }));
    assert.equal(list.items.length, 1); assert.equal(list.nextCursor, null);
    assert.equal((await db.prepare("SELECT status FROM content_items WHERE id='demo-post'").first<{ status: string }>())?.status, "scheduled");
  });
  await t.test("explicit client grants are required inside a tenant", async () => {
    await db.prepare("INSERT INTO clients VALUES ('a','ungranted','Synthetic ungranted client','UTC')").run();
    assert.equal((await call("list_metrics", { clientId: "ungranted" })).isError, true);
    assert.equal((await call("define_metric", { ...definition, clientId: "ungranted" })).isError, true);
  });
  await t.test("expired and revoked credentials are rejected", async () => {
    await db.prepare("UPDATE principals SET revoked_at=? WHERE tenant_id=?").bind(new Date().toISOString(), "b").run();
    assert.equal((await mf.dispatchFetch("https://example.test/mcp", { headers: { Authorization: `Bearer ${tokenB}` } })).status, 401);
    await db.prepare("UPDATE principals SET expires_at=? WHERE tenant_id=?").bind("2020-01-01T00:00:00Z", "a").run();
    assert.equal((await mf.dispatchFetch("https://example.test/mcp", { headers: { Authorization: `Bearer ${tokenA}` } })).status, 401);
  });
});
