import { authorize, PublicError, type Principal } from "./auth.ts";
import { canonicalJson, compareReadings, monthRange, previousMonth, sha256, type Direction, type Quality } from "./domain.ts";
import type { MetricInput, ObservationInput } from "./schemas.ts";

export function repository(db: D1Database, principal: Principal) {
  const tenant = principal.tenantId;
  return {
    async listClients() {
      return (await db.prepare("SELECT c.id, c.name, c.timezone, v.revision FROM clients c JOIN client_grants g ON c.tenant_id = g.tenant_id AND c.id = g.client_id JOIN client_versions v ON v.tenant_id=c.tenant_id AND v.client_id=c.id WHERE g.tenant_id = ? AND g.principal_id = ? ORDER BY c.id LIMIT 100")
        .bind(tenant, principal.id).all()).results;
    },
    async listMetrics(clientId: string) {
      await authorize(db, principal, clientId, "metrics:read");
      return (await db.prepare("SELECT id, key, label, category, unit, direction, semantics, timezone, dimensions_json, definition FROM metrics WHERE tenant_id = ? AND client_id = ? ORDER BY key LIMIT 200")
        .bind(tenant, clientId).all()).results;
    },
    async defineMetric(input: MetricInput) {
      await authorize(db, principal, input.clientId, "metrics:write");
      if (Object.keys(input.dimensions).length > 20) throw new PublicError("At most 20 dimensions are supported.");
      const metricId = crypto.randomUUID();
      const result = await db.prepare("INSERT INTO metrics(tenant_id,client_id,id,key,label,category,unit,direction,semantics,timezone,dimensions_json,definition,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,client_id,key) DO NOTHING")
        .bind(tenant, input.clientId, metricId, input.key, input.label, input.category, input.unit, input.direction, input.semantics, input.timezone, canonicalJson(input.dimensions), input.definition, principal.id, new Date().toISOString()).run();
      if (!result.meta.changes) throw new PublicError("That metric key already exists. Read its definition before using it; definitions are immutable.");
      return { id: metricId, ...input };
    },
    async recordObservation(input: ObservationInput) {
      await authorize(db, principal, input.clientId, "metrics:write");
      const metric = await db.prepare("SELECT id FROM metrics WHERE tenant_id=? AND client_id=? AND id=?").bind(tenant, input.clientId, input.metricId).first();
      if (!metric) throw new PublicError("Metric not found in this client.");
      const hash = await sha256(canonicalJson(input));
      const existing = await db.prepare("SELECT id, revision, payload_hash FROM observations WHERE tenant_id=? AND idempotency_key=?").bind(tenant, input.idempotencyKey).first<{ id: string; revision: number; payload_hash: string }>();
      if (existing) {
        if (existing.payload_hash !== hash) throw new PublicError("Idempotency key was already used for different data.");
        return { id: existing.id, revision: existing.revision, replayed: true };
      }
      const current = await db.prepare("SELECT MAX(revision) AS revision FROM observations WHERE tenant_id=? AND client_id=? AND metric_id=? AND period_start=? AND period_end=?")
        .bind(tenant, input.clientId, input.metricId, input.periodStart, input.periodEnd).first<{ revision: number | null }>();
      if ((current?.revision ?? 0) !== input.expectedRevision) {
        // An identical request may have committed between our first lookup and
        // revision read. Recover the idempotent result before returning conflict.
        const saved = await db.prepare("SELECT id, revision, payload_hash FROM observations WHERE tenant_id=? AND idempotency_key=?").bind(tenant, input.idempotencyKey).first<{ id: string; revision: number; payload_hash: string }>();
        if (saved?.payload_hash === hash) return { id: saved.id, revision: saved.revision, replayed: true };
        throw new PublicError("Revision conflict. Read the latest observation before correcting it.");
      }
      const observationId = crypto.randomUUID();
      try {
        await db.prepare("INSERT INTO observations(tenant_id,client_id,id,metric_id,period_start,period_end,revision,value,quality,source_json,collected_at,recorded_at,recorded_by,idempotency_key,payload_hash,correction_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(tenant, input.clientId, observationId, input.metricId, input.periodStart, input.periodEnd, input.expectedRevision + 1, input.value, input.quality, canonicalJson(input.source), input.collectedAt, new Date().toISOString(), principal.id, input.idempotencyKey, hash, input.correctionReason ?? null).run();
      } catch (error) {
        // Concurrent retries may have won after the initial lookup. Check the
        // saved payload before treating the race as a conflict or failure.
        const saved = await db.prepare("SELECT id, revision, payload_hash FROM observations WHERE tenant_id=? AND idempotency_key=?").bind(tenant, input.idempotencyKey).first<{ id: string; revision: number; payload_hash: string }>();
        if (saved?.payload_hash === hash) return { id: saved.id, revision: saved.revision, replayed: true };
        if (String(error).includes("UNIQUE constraint failed")) throw new PublicError("Revision or idempotency conflict. Read current data before retrying.");
        throw error;
      }
      return { id: observationId, revision: input.expectedRevision + 1, replayed: false };
    },
    async getObservation(clientId: string, metricId: string, periodStart: string, periodEnd: string) {
      await authorize(db, principal, clientId, "metrics:read");
      const row = await db.prepare("SELECT id,value,quality,revision,source_json,collected_at,recorded_at,recorded_by,correction_reason FROM observations WHERE tenant_id=? AND client_id=? AND metric_id=? AND period_start=? AND period_end=? ORDER BY revision DESC LIMIT 1")
        .bind(tenant, clientId, metricId, periodStart, periodEnd).first();
      return { observation: row, expectedRevision: row?.revision ?? 0 };
    },
    async compareMonth(clientId: string, month: string) {
      await authorize(db, principal, clientId, "metrics:read");
      const range = monthRange(month), previous = monthRange(previousMonth(month));
      const definitions = await db.prepare("SELECT id,key,label,unit,direction,timezone,semantics FROM metrics WHERE tenant_id=? AND client_id=? ORDER BY key LIMIT 201")
        .bind(tenant, clientId).all<{ id: string; key: string; label: string; unit: string; direction: Direction; timezone: string; semantics: string }>();
      if (definitions.results.length > 200) throw new PublicError("This prototype supports at most 200 metrics per client report.");
      const readings = await db.prepare("SELECT o.id,o.metric_id,o.period_start,o.period_end,o.value,o.quality,o.source_json,o.collected_at,o.recorded_at,o.revision FROM observations o WHERE o.tenant_id=? AND o.client_id=? AND ((o.period_start=? AND o.period_end=?) OR (o.period_start=? AND o.period_end=?)) AND o.revision=(SELECT MAX(r.revision) FROM observations r WHERE r.tenant_id=o.tenant_id AND r.metric_id=o.metric_id AND r.period_start=o.period_start AND r.period_end=o.period_end)")
        .bind(tenant, clientId, range.start, range.end, previous.start, previous.end).all<{ id: string; metric_id: string; period_start: string; period_end: string; value: number | null; quality: Quality; source_json: string; collected_at: string; recorded_at: string; revision: number }>();
      return { month, previousMonth: previousMonth(month), interval: "[start,end) in each metric's reporting timezone", metrics: definitions.results.map(metric => {
        const current = readings.results.find(r => r.metric_id === metric.id && r.period_start === range.start) ?? null;
        const prior = readings.results.find(r => r.metric_id === metric.id && r.period_start === previous.start) ?? null;
        return { ...metric, ...compareReadings(current, prior, metric.direction, metric.unit) };
      }), notice: "Only exact full-month observations are compared. Daily values and distinct reach are never silently summed. Changes are not evidence of causation." };
    },
    async listContent(input: { clientId: string; status?: string; scheduledBefore?: string; afterId?: string; limit: number }) {
      await authorize(db, principal, input.clientId, "content:read");
      const before = input.scheduledBefore ? new Date(input.scheduledBefore).toISOString() : null;
      const rows = await db.prepare("SELECT id,channel,account_ref,title,status,scheduled_at,schedule_timezone,revision FROM content_items WHERE tenant_id=? AND client_id=? AND (? IS NULL OR status=?) AND (? IS NULL OR scheduled_at<=?) AND id>? ORDER BY id LIMIT ?")
        .bind(tenant, input.clientId, input.status ?? null, input.status ?? null, before, before, input.afterId ?? "", input.limit + 1).all();
      const hasMore = rows.results.length > input.limit;
      const items = rows.results.slice(0, input.limit);
      return { items, nextCursor: hasMore ? items.at(-1)?.id : null, publishingEnabled: false };
    },
    async getContent(clientId: string, contentId: string) {
      await authorize(db, principal, clientId, "content:read");
      const item = await db.prepare("SELECT id,channel,account_ref,title,caption,assets_json,status,scheduled_at,schedule_timezone,approved_by,approved_at,published_at,external_post_id,revision,updated_at FROM content_items WHERE tenant_id=? AND client_id=? AND id=?")
        .bind(tenant, clientId, contentId).first();
      if (!item) throw new PublicError("Content not found in this client.");
      const links = await db.prepare("SELECT metric_id FROM content_metrics WHERE tenant_id=? AND client_id=? AND content_id=? ORDER BY metric_id LIMIT 201").bind(tenant, clientId, contentId).all();
      if (links.results.length > 200) throw new PublicError("Content detail supports at most 200 linked metrics in this prototype.");
      return { ...item, metricIds: links.results.map(row => row.metric_id), publishingEnabled: false, notice: "Content retrieval does not grant publishing permission or claim this item. External agents must coordinate before publishing." };
    },
  };
}
