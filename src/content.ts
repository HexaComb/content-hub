import { authorize, PublicError, type Principal } from "./auth.ts";
import { canonicalJson, sha256 } from "./domain.ts";
import { createContentInput, updateContentInput, approveContentInput, scheduleContentInput, cancelContentInput, recordPublicationReceiptInput, linkContentMetricInput } from "./contentSchemas.ts";

type Versioned = { clientId: string; contentId: string; expectedRevision: number; idempotencyKey: string };
type Saved = { content_id: string; revision: number; payload_hash: string };
const boundApproval = "approved_revision=revision AND approved_channel=channel AND approved_account_ref=account_ref";
export function contentRepository(db: D1Database, principal: Principal) {
  const tenant = principal.tenantId;
  const saved = (key: string) => db.prepare("SELECT content_id,revision,payload_hash FROM content_audit WHERE tenant_id=? AND idempotency_key=?").bind(tenant, key).first<Saved>();
  const result = (row: Saved, replayed: boolean) => ({ id: row.content_id, revision: row.revision, replayed, publishingEnabled: false });
  async function mutate(input: { clientId: string; idempotencyKey: string }, action: string, scope: string,
    build: (op: string, now: string) => D1PreparedStatement[], details: Record<string, unknown> = {}) {
    await authorize(db, principal, input.clientId, scope);
    // Actor-bound keys prevent another authorized actor replaying somebody else's mutation.
    const hash = await sha256(canonicalJson({ action, actor: principal.id, input }));
    const previous = await saved(input.idempotencyKey);
    if (previous) {
      if (previous.payload_hash !== hash) throw new PublicError("Idempotency key already used for different data or actor.");
      return result(previous, true);
    }
    const op = crypto.randomUUID(), now = new Date().toISOString();
    // The scalar subquery yields NULL on a stale/invalid transition. NOT NULL then
    // aborts the entire D1 batch, including any link change. No unaudited mutation.
    const audit = db.prepare(`INSERT INTO content_audit(tenant_id,client_id,operation_id,content_id,action,actor_id,revision,idempotency_key,payload_hash,recorded_at,details_json)
      VALUES(?,?,?,(SELECT id FROM content_items WHERE tenant_id=? AND client_id=? AND last_operation_id=?),?,?,(SELECT revision FROM content_items WHERE tenant_id=? AND client_id=? AND last_operation_id=?),?,?,?,
        json_object('details',json(?),'snapshot',json((SELECT json_object('id',id,'channel',channel,'accountRef',account_ref,'title',title,'caption',caption,'assets',json(assets_json),'status',status,'revision',revision,'scheduledAt',scheduled_at,'scheduleTimezone',schedule_timezone,'approvedBy',approved_by,'approvedAt',approved_at,'approvedRevision',approved_revision,'approvedChannel',approved_channel,'approvedAccountRef',approved_account_ref,'publishedAt',published_at,'externalPostId',external_post_id) FROM content_items WHERE tenant_id=? AND client_id=? AND last_operation_id=?))))`)
      .bind(tenant, input.clientId, op, tenant, input.clientId, op, action, principal.id, tenant, input.clientId, op, input.idempotencyKey, hash, now, canonicalJson(details), tenant, input.clientId, op);
    try { await db.batch([...build(op, now), audit]); }
    catch (error) {
      const concurrent = await saved(input.idempotencyKey);
      if (concurrent?.payload_hash === hash) return result(concurrent, true);
      if (/constraint|SQLITE_CONSTRAINT/i.test(String(error))) throw new PublicError("Revision, state, reference or idempotency conflict. Read current content before retrying.");
      throw error;
    }
    const committed = await saved(input.idempotencyKey);
    if (!committed) throw new Error("Missing committed content audit.");
    return result(committed, false);
  }
  function change(input: Versioned, op: string, now: string, set: string, values: (string | number | null)[], condition: string, conditionValues: (string | number | null)[] = []) {
    return db.prepare(`UPDATE content_items SET ${set},revision=revision+1,updated_at=?,last_operation_id=? WHERE tenant_id=? AND client_id=? AND id=? AND revision=? AND (${condition})`)
      .bind(...values, now, op, tenant, input.clientId, input.contentId, input.expectedRevision, ...conditionValues);
  }
  return {
    createContent(raw: unknown) {
      const i = createContentInput.parse(raw), contentId = crypto.randomUUID();
      return mutate(i, "create_content", "content:write", (op, now) => [
        db.prepare("INSERT INTO content_items(tenant_id,client_id,id,channel,account_ref,title,caption,assets_json,status,revision,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,?,?,?,'draft',1,?,?,?)")
          .bind(tenant, i.clientId, contentId, i.channel, i.accountRef, i.title, i.caption, canonicalJson(i.assets), now, now, op),
      ]);
    },
    updateContent(raw: unknown) {
      const i = updateContentInput.parse(raw);
      return mutate(i, "update_content", "content:write", (op, now) => [
        change(i, op, now, "channel=?,account_ref=?,title=?,caption=?,assets_json=?,status='draft',approved_by=NULL,approved_at=NULL,approved_revision=NULL,approved_channel=NULL,approved_account_ref=NULL,scheduled_at=NULL,schedule_timezone=NULL",
          [i.channel, i.accountRef, i.title, i.caption, canonicalJson(i.assets)], "status IN ('draft','approved','scheduled')"),
      ]);
    },
    approveContent(raw: unknown) {
      const i = approveContentInput.parse(raw);
      return mutate(i, "approve_content", "content:approve", (op, now) => [
        change(i, op, now, "status='approved',approved_by=?,approved_at=?,approved_revision=revision+1,approved_channel=channel,approved_account_ref=account_ref",
          [principal.id, now], "status='draft' AND channel=? AND account_ref=?", [i.channel, i.accountRef]),
      ]);
    },
    scheduleContent(raw: unknown) {
      const i = scheduleContentInput.parse(raw);
      return mutate(i, "schedule_content", "content:schedule", (op, now) => {
        if (i.scheduledAt <= now) throw new PublicError("Scheduled time must be in the future.");
        return [change(i, op, now, "status='scheduled',scheduled_at=?,schedule_timezone=?,approved_revision=revision+1", [i.scheduledAt, i.timezone], "status IN ('approved','scheduled') AND " + boundApproval)];
      });
    },
    cancelContent(raw: unknown) {
      const i = cancelContentInput.parse(raw);
      return mutate(i, "cancel_content", "content:schedule", (op, now) => [
        change(i, op, now, "status='cancelled',approved_revision=NULL", [], "status IN ('draft','approved','scheduled')"),
      ], { reason: i.reason });
    },
    recordPublicationReceipt(raw: unknown) {
      const i = recordPublicationReceiptInput.parse(raw);
      return mutate(i, "record_publication_receipt", "content:receipt", (op, now) => {
        if (i.publishedAt > now) throw new PublicError("Publication receipt cannot be in the future.");
        return [change(i, op, now, "status='published',published_at=?,external_post_id=?,approved_revision=revision+1",
          [i.publishedAt, i.externalPostId], "status IN ('approved','scheduled') AND " + boundApproval + " AND channel=? AND account_ref=?", [i.channel, i.accountRef])];
      });
    },
    linkContentMetric(raw: unknown) {
      const i = linkContentMetricInput.parse(raw);
      return mutate(i, "link_content_metric", "content:write", (op, now) => [
        change(i, op, now, "approved_revision=CASE WHEN approved_revision=revision THEN revision+1 ELSE approved_revision END", [], "status NOT IN ('publishing','failed') AND (EXISTS(SELECT 1 FROM content_metrics cm WHERE cm.tenant_id=content_items.tenant_id AND cm.client_id=content_items.client_id AND cm.content_id=content_items.id AND cm.metric_id=?) OR (SELECT COUNT(*) FROM content_metrics cm WHERE cm.tenant_id=content_items.tenant_id AND cm.client_id=content_items.client_id AND cm.content_id=content_items.id)<200)", [i.metricId]),
        db.prepare("INSERT INTO content_metrics(tenant_id,client_id,content_id,metric_id) SELECT tenant_id,client_id,id,? FROM content_items WHERE tenant_id=? AND client_id=? AND id=? AND last_operation_id=? ON CONFLICT DO NOTHING")
          .bind(i.metricId, tenant, i.clientId, i.contentId, op),
      ]);
    },
  };
}
