import { PublicError } from "./auth.ts";
import { compareReadings, monthRange, previousMonth, sha256, type Direction, type Quality } from "./domain.ts";

/** Internal session handle. Never return the handle or cookie hash to a browser. */
export type HumanSession = { id: string; email: string };
type TargetRow = { tenant_id: string; client_id: string; project_id: string; name: string; kind: string; platform_account_ref: string | null; status: string };
const targetDTO = (p: TargetRow) => ({ clientId: p.client_id, projectId: p.project_id, name: p.name, kind: p.kind, platformAccountRef: p.platform_account_ref, status: p.status });

export async function getSession(db: D1Database, request: Request): Promise<HumanSession | null> {
  // Reject duplicate cookies rather than choosing an attacker-controlled ordering.
  const values = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith("__Host-ch_session="));
  if (values.length !== 1) return null;
  const token = values[0].slice("__Host-ch_session=".length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await db.prepare("SELECT email FROM human_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?")
    .bind(hash, new Date().toISOString()).first<{ email: string }>();
  return row ? { id: hash, email: row.email } : null;
}

// Recheck the session in every authorization query. Resource permissions are not
// embedded in a browser cookie and never cached across requests.
const activeGrant = `i.accepted_at IS NOT NULL AND i.revoked_at IS NULL AND i.grant_expires_at>?
  AND p.status!='archived' AND EXISTS(SELECT 1 FROM human_sessions s
    WHERE s.token_hash=? AND s.email=i.recipient_email AND s.email=?
      AND s.revoked_at IS NULL AND s.expires_at>?)`;
const targetJoin = `FROM invitations i JOIN projects p ON p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id`;
const targetColumns = `p.tenant_id,p.client_id,p.id AS project_id,p.name,p.kind,p.platform_account_ref,p.status`;
const accessBindings = (session: HumanSession) => {
  const now = new Date().toISOString();
  return [now, session.id, session.email, now];
};

export async function portalTargets(db: D1Database, session: HumanSession) {
  const rows = (await db.prepare(`SELECT DISTINCT ${targetColumns} ${targetJoin} WHERE ${activeGrant} ORDER BY p.client_id,p.id LIMIT 501`)
    .bind(...accessBindings(session)).all<TargetRow>()).results;
  if (rows.length > 500) throw new PublicError("Too many reporting targets. Contact your administrator.");
  // The public route identifies a target using client/project IDs, so do not
  // silently choose a tenant if those IDs happen to collide across memberships.
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = JSON.stringify([row.client_id, row.project_id]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { targets: rows.filter(row => counts.get(JSON.stringify([row.client_id, row.project_id])) === 1).map(targetDTO) };
}

export async function portalReport(db: D1Database, session: HumanSession, clientId: string, projectId: string, month: string) {
  let range: ReturnType<typeof monthRange>, priorRange: ReturnType<typeof monthRange>, priorMonth: string;
  try { range = monthRange(month); priorMonth = previousMonth(month); priorRange = monthRange(priorMonth); }
  catch { throw new PublicError("Use a valid reporting month in YYYY-MM format."); }
  const targets = (await db.prepare(`SELECT DISTINCT ${targetColumns} ${targetJoin} WHERE ${activeGrant} AND p.client_id=? AND p.id=? LIMIT 2`)
    .bind(...accessBindings(session), clientId, projectId).all<TargetRow>()).results;
  if (targets.length !== 1) throw new PublicError("Reporting target is not available.");
  const target = targets[0];
  // Scope is the union of independently approved grants, intersected with the
  // current target mapping. Newly linked metrics never expand an old grant.
  const definitions = (await db.prepare(`SELECT m.id,m.key,m.label,m.unit,m.direction FROM metrics m
    JOIN project_metrics pm ON pm.tenant_id=m.tenant_id AND pm.client_id=m.client_id AND pm.metric_id=m.id
    WHERE pm.tenant_id=? AND pm.client_id=? AND pm.project_id=? AND EXISTS(
      SELECT 1 ${targetJoin} JOIN json_each(i.metric_ids_json) approved ON approved.value=m.id
      WHERE ${activeGrant} AND i.tenant_id=m.tenant_id AND i.client_id=m.client_id AND i.project_id=pm.project_id)
    ORDER BY m.key LIMIT 201`).bind(target.tenant_id, clientId, projectId, ...accessBindings(session))
    .all<{ id: string; key: string; label: string; unit: string; direction: Direction }>()).results;
  if (definitions.length > 200) throw new PublicError("Too many reporting metrics. Contact your administrator.");
  // Read only allowlisted columns and recheck authorization in the observation
  // query as well. Internal provenance, source URLs and notes are never loaded.
  const readings = (await db.prepare(`SELECT o.metric_id,o.period_start,o.value,o.quality,o.collected_at FROM observations o
    JOIN project_metrics pm ON pm.tenant_id=o.tenant_id AND pm.client_id=o.client_id AND pm.metric_id=o.metric_id
    WHERE o.tenant_id=? AND o.client_id=? AND pm.project_id=?
      AND ((o.period_start=? AND o.period_end=?) OR (o.period_start=? AND o.period_end=?))
      AND o.revision=(SELECT MAX(r.revision) FROM observations r WHERE r.tenant_id=o.tenant_id AND r.client_id=o.client_id AND r.metric_id=o.metric_id AND r.period_start=o.period_start AND r.period_end=o.period_end)
      AND EXISTS(SELECT 1 ${targetJoin} JOIN json_each(i.metric_ids_json) approved ON approved.value=o.metric_id
        WHERE ${activeGrant} AND i.tenant_id=o.tenant_id AND i.client_id=o.client_id AND i.project_id=pm.project_id)`)
    .bind(target.tenant_id, clientId, projectId, range.start, range.end, priorRange.start, priorRange.end, ...accessBindings(session))
    .all<{ metric_id: string; period_start: string; value: number | null; quality: Quality; collected_at: string }>()).results;
  // Re-query the exact surviving metric permissions immediately before building
  // the response. An unrelated surviving grant must not keep revoked metrics.
  const finalAllowed = (await db.prepare(`SELECT DISTINCT pm.metric_id ${targetJoin}
    LEFT JOIN json_each(i.metric_ids_json) approved ON 1=1
    LEFT JOIN project_metrics pm ON pm.tenant_id=i.tenant_id AND pm.client_id=i.client_id
      AND pm.project_id=i.project_id AND pm.metric_id=approved.value
    WHERE ${activeGrant} AND i.tenant_id=? AND i.client_id=? AND i.project_id=?`)
    .bind(...accessBindings(session), target.tenant_id, clientId, projectId).all<{metric_id:string|null}>()).results;
  // A null metric row represents an active grant with no remaining mappings;
  // zero rows means no access. Do not await another query after this snapshot.
  if (!finalAllowed.length) throw new PublicError("Reporting target is not available.");
  const allowedIds = new Set(finalAllowed.flatMap(row => row.metric_id === null ? [] : [row.metric_id]));
  return { target: targetDTO(target), month, previousMonth: priorMonth, metrics: definitions.filter(metric => allowedIds.has(metric.id)).map(metric => {
    const reading = (period: string) => {
      const row = readings.find(r => r.metric_id === metric.id && r.period_start === period);
      return row ? { value: row.value, quality: row.quality, collectedAt: row.collected_at } : null;
    };
    return { ...metric, ...compareReadings(reading(range.start), reading(priorRange.start), metric.direction, metric.unit) };
  }) };
}
