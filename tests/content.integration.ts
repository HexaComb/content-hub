import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { contentRepository } from "../src/content.ts";

test("atomic content workflows, approvals, receipts and isolation", async t => {
  const mf = new Miniflare({ workers: [{ config: {
    name: "content-tests", compatibilityDate: "2026-11-10",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: "export default {fetch(){return new Response('ok')}}" } } },
    env: { DB: { type: "d1", name: "content-tests" } },
  } }] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations")).filter(f => f.endsWith(".sql")).sort()) {
    const sql = await readFile("migrations/" + file, "utf8");
    for (const statement of sql.split("\n").filter(l => !l.trimStart().startsWith("--")).join("\n").split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO tenants VALUES ('t','Test')").run();
  await db.prepare("INSERT INTO clients(tenant_id,id,name,timezone) VALUES ('t','c','Test','UTC')").run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES ('t','p','Test',?,'2099-01-01','[]')").bind("a".repeat(64)).run();
  await db.prepare("INSERT INTO client_grants VALUES ('t','p','c')").run();
  const principal = { tenantId: "t", id: "p", scopes: ["content:write", "content:approve", "content:schedule", "content:receipt"] };
  const repo = contentRepository(db as unknown as D1Database, principal);
  const fields = { clientId: "c", channel: "instagram", accountRef: "acct", title: "Post", caption: "Untrusted text", assets: [] };
  const initial = { ...fields, idempotencyKey: "create-key" };
  const created = await repo.createContent(initial);
  assert.equal(created.revision, 1);
  assert.equal((await repo.createContent(initial)).id, created.id);
  await assert.rejects(repo.createContent({ ...initial, title: "different" }));
  const v = (revision: number, key: string) => ({ clientId: "c", contentId: created.id, expectedRevision: revision, idempotencyKey: key });
  await assert.rejects(repo.scheduleContent({ ...v(1, "no-approval"), scheduledAt: "2099-01-01T00:00:00Z", timezone: "UTC" }));
  await assert.rejects(repo.approveContent({ ...v(1, "wrong-account"), channel: "instagram", accountRef: "wrong" }));
  await repo.approveContent({ ...v(1, "approve-key"), channel: "instagram", accountRef: "acct" });
  await repo.scheduleContent({ ...v(2, "schedule-key"), scheduledAt: "2099-01-01T00:00:00Z", timezone: "UTC" });
  await repo.updateContent({ ...fields, ...v(3, "edit-content"), caption: "Edited" });
  const row = await db.prepare("SELECT * FROM content_items WHERE id=?").bind(created.id).first();
  assert.equal(row?.status, "draft"); assert.equal(row?.approved_revision, null); assert.equal(row?.scheduled_at, null);
  const approvalAudit = await db.prepare("SELECT details_json FROM content_audit WHERE content_id=? AND revision=2").bind(created.id).first<{details_json:string}>();
  const approvalSnapshot = JSON.parse(approvalAudit!.details_json).snapshot;
  assert.equal(approvalSnapshot.caption, "Untrusted text");
  assert.equal(approvalSnapshot.status, "approved");
  assert.equal(approvalSnapshot.approvedAccountRef, "acct");
  await assert.rejects(repo.recordPublicationReceipt({ ...v(4, "unapproved-receipt"), channel: "instagram", accountRef: "acct", publishedAt: "2026-01-01T00:00:00Z", externalPostId: "external1" }));
  const edits = await Promise.allSettled([
    repo.updateContent({ ...fields, ...v(4, "concurrent-edit-a") }),
    repo.updateContent({ ...fields, ...v(4, "concurrent-edit-b") }),
  ]);
  assert.equal(edits.filter(r => r.status === "fulfilled").length, 1);
  await repo.approveContent({ ...v(5, "approve-again"), channel: "instagram", accountRef: "acct" });
  const receipt = { ...v(6, "receipt-key"), channel: "instagram", accountRef: "acct", publishedAt: "2026-01-01T00:00:00Z", externalPostId: "external1" };
  await repo.recordPublicationReceipt(receipt);
  assert.equal((await repo.recordPublicationReceipt(receipt)).replayed, true);
  await assert.rejects(repo.recordPublicationReceipt({ ...receipt, ...v(7, "overwrite-receipt"), externalPostId: "external2" }));
  await assert.rejects(repo.cancelContent({ ...v(7, "cancel-published"), reason: "No" }));
  await assert.rejects(repo.linkContentMetric({ ...v(7, "invalid-metric"), metricId: "missing" }));
  assert.equal((await db.prepare("SELECT revision FROM content_items WHERE id=?").bind(created.id).first())?.revision, 7);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM content_audit").first())?.n, 7);
  await assert.rejects(contentRepository(db as unknown as D1Database, { ...principal, scopes: [] }).createContent({ ...initial, idempotencyKey: "scope-denied" }));
  await assert.rejects(repo.createContent({ ...initial, clientId: "other", idempotencyKey: "grant-denied" }));
  const next = { ...initial, idempotencyKey: "concurrent-create" };
  const retries = await Promise.all([repo.createContent(next), repo.createContent(next)]);
  assert.equal(retries[0].id, retries[1].id);
  for (let n = 0; n <= 200; n++) {
    await db.prepare("INSERT INTO metrics(tenant_id,client_id,id,key,label,category,unit,direction,semantics,timezone,dimensions_json,definition,created_by,created_at) VALUES('t','c',?,?,?,'test','count','neutral','custom','UTC','{}','Synthetic','p','2026-01-01T00:00:00Z')").bind(`m${n}`,`m${n}`,`Metric ${n}`).run();
    if (n < 200) await db.prepare("INSERT INTO content_metrics VALUES('t','c',?,?)").bind(created.id,`m${n}`).run();
  }
  await assert.rejects(repo.linkContentMetric({ ...v(7, "over-cap-link"), metricId: "m200" }));
  assert.equal((await db.prepare("SELECT revision FROM content_items WHERE id=?").bind(created.id).first())?.revision, 7);
  await repo.linkContentMetric({ ...v(7, "existing-cap-link"), metricId: "m0" });
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM content_metrics WHERE content_id=?").bind(created.id).first())?.n, 200);
});
