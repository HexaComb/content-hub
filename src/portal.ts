import { readPublishedPresentation } from './presentations.ts';
import { filterPresentation, type PresentationPlugin } from './presentationSchema.ts';
import { metricAllowedForPlugin } from './pluginMetrics.ts';
import { readProjectPlugins, selectPlugin } from './plugins.ts';
import { readProjectTheme } from './themes.ts';
import { PublicError } from "./auth.ts";
import { compareReadings, monthRange, previousMonth, type Direction, type Quality } from "./domain.ts";

import type { HumanIdentity } from "./humanAuth.ts";
type TargetRow = { tenant_id: string; client_id: string; client_name:string; timezone:string; project_id: string; name: string; kind: string; platform_account_ref: string | null; status: string };
const targetDTO = (p: TargetRow) => ({ clientId: p.client_id, clientName:p.client_name, timezone:p.timezone, projectId: p.project_id, name: p.name, kind: p.kind, platformAccountRef: p.platform_account_ref, status: p.status });

// The caller must resolve and verify the identity on every request. Resource
// permissions remain server-side and bind the stable issuer/subject pair, never
// a mutable email address. Legacy grants with NULL identity fields fail closed.
const activeGrant = `i.accepted_at IS NOT NULL AND i.revoked_at IS NULL AND i.grant_expires_at>?
  AND p.status!='archived' AND i.accepted_identity_issuer=? AND i.accepted_identity_subject=?`;
const targetJoin = `FROM invitations i JOIN projects p ON p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id`;
const targetColumns = `p.tenant_id,p.client_id,c.name AS client_name,c.timezone,p.id AS project_id,p.name,p.kind,p.platform_account_ref,p.status`;
const accessBindings = (identity: HumanIdentity) => {
  const now = new Date().toISOString();
  return [now, identity.issuer, identity.subject];
};

export async function portalTargets(db: D1Database, identity: HumanIdentity) {
  const rows = (await db.prepare(`SELECT DISTINCT ${targetColumns} ${targetJoin} WHERE ${activeGrant} ORDER BY p.client_id,p.id LIMIT 501`)
    .bind(...accessBindings(identity)).all<TargetRow>()).results;
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

export async function portalReport(db: D1Database, identity: HumanIdentity, clientId: string, projectId: string, month: string, pluginKey?:string, includePresentation=false) {
  let range: ReturnType<typeof monthRange>, priorRange: ReturnType<typeof monthRange>, priorMonth: string;
  try { range = monthRange(month); priorMonth = previousMonth(month); priorRange = monthRange(priorMonth); }
  catch { throw new PublicError("Use a valid reporting month in YYYY-MM format."); }
  const targets = (await db.prepare(`SELECT DISTINCT ${targetColumns} ${targetJoin} WHERE ${activeGrant} AND p.client_id=? AND p.id=? LIMIT 2`)
    .bind(...accessBindings(identity), clientId, projectId).all<TargetRow>()).results;
  if (targets.length !== 1) throw new PublicError("Reporting target is not available.");
  const target = targets[0];
  // Scope is the union of independently approved grants, intersected with the
  // current target mapping. Newly linked metrics never expand an old grant.
  const definitions = (await db.prepare(`SELECT m.id,m.key,m.label,m.unit,m.direction FROM metrics m
    JOIN project_metrics pm ON pm.tenant_id=m.tenant_id AND pm.client_id=m.client_id AND pm.metric_id=m.id
    WHERE pm.tenant_id=? AND pm.client_id=? AND pm.project_id=? AND EXISTS(
      SELECT 1 ${targetJoin} JOIN json_each(i.metric_ids_json) approved ON approved.value=m.id
      WHERE ${activeGrant} AND i.tenant_id=m.tenant_id AND i.client_id=m.client_id AND i.project_id=pm.project_id)
    ORDER BY m.key LIMIT 201`).bind(target.tenant_id, clientId, projectId, ...accessBindings(identity))
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
    .bind(target.tenant_id, clientId, projectId, range.start, range.end, priorRange.start, priorRange.end, ...accessBindings(identity))
    .all<{ metric_id: string; period_start: string; value: number | null; quality: Quality; collected_at: string }>()).results;
  const plugin=pluginKey===undefined?null:selectPlugin(await readProjectPlugins(db,target.tenant_id,clientId,projectId),pluginKey);
  const appearance = await readProjectTheme(db,target.tenant_id,clientId,projectId);
  const presentation=includePresentation?await readPublishedPresentation(db,target.tenant_id,{clientId,projectId}):undefined;
  // Re-query the exact surviving metric permissions immediately before building
  // the response. An unrelated surviving grant must not keep revoked metrics.
  const finalAllowed = (await db.prepare(`SELECT DISTINCT pm.metric_id,pp.key AS plugin_key,pp.enabled AS plugin_enabled,pp.metric_ids_json AS plugin_metric_ids ${targetJoin}
    LEFT JOIN json_each(i.metric_ids_json) approved ON 1=1
    LEFT JOIN project_metrics pm ON pm.tenant_id=i.tenant_id AND pm.client_id=i.client_id
      AND pm.project_id=i.project_id AND pm.metric_id=approved.value
    LEFT JOIN project_plugins pp ON pp.tenant_id=i.tenant_id AND pp.client_id=i.client_id AND pp.project_id=i.project_id
    WHERE ${activeGrant} AND i.tenant_id=? AND i.client_id=? AND i.project_id=?`)
    .bind(...accessBindings(identity), target.tenant_id, clientId, projectId).all<{metric_id:string|null;plugin_key:PresentationPlugin|null;plugin_enabled:number|null;plugin_metric_ids:string|null}>()).results;
  // A null metric row represents an active grant with no remaining mappings;
  // zero rows means no access. Do not await another query after this snapshot.
  if (!finalAllowed.length) throw new PublicError("Reporting target is not available.");
  const allowedIds = new Set(finalAllowed.flatMap(row => row.metric_id === null ? [] : [row.metric_id]));
  const currentPlugin=plugin?finalAllowed.find(row=>row.plugin_key===plugin.key&&row.plugin_enabled===1):null;
  if(plugin&&!currentPlugin)throw new PublicError('This project plugin is not enabled.');
  const currentPluginIds=new Set<string>(currentPlugin?JSON.parse(currentPlugin.plugin_metric_ids!):[]);
  const visibleDefinitions=definitions.filter(metric=>allowedIds.has(metric.id)&&(!plugin||(currentPluginIds.has(metric.id)&&metricAllowedForPlugin(plugin.key,metric))));
  const visibleIds=new Set(visibleDefinitions.map(metric=>metric.id));
  const pages=[...new Set(finalAllowed.filter(row=>row.plugin_enabled===1&&row.plugin_key!==null).map(row=>row.plugin_key!))];
  return { ...(presentation?{presentation:{...presentation,plugin:plugin?.key??null,pages,document:presentation.document?filterPresentation(presentation.document,visibleIds,plugin?.key):null}}:{}), target: targetDTO(target), appearance, month, previousMonth: priorMonth, metrics: visibleDefinitions.map(metric => {
    const reading = (period: string) => {
      const row = readings.find(r => r.metric_id === metric.id && r.period_start === period);
      return row ? { value: row.value, quality: row.quality, collectedAt: row.collected_at } : null;
    };
    return { ...metric, ...compareReadings(reading(range.start), reading(priorRange.start), metric.direction, metric.unit) };
  }) };
}

/** Return plugin metadata only after resolving one exact authorized tenant. */
export async function portalPlugins(db:D1Database,identity:HumanIdentity,clientId:string,projectId:string){
 const targets=(await db.prepare(`SELECT DISTINCT ${targetColumns} ${targetJoin} WHERE ${activeGrant} AND p.client_id=? AND p.id=? LIMIT 2`).bind(...accessBindings(identity),clientId,projectId).all<TargetRow>()).results;
 if(targets.length!==1)throw new PublicError('Reporting target is not available.');
 const tenant=targets[0].tenant_id;
 const plugins=await readProjectPlugins(db,tenant,clientId,projectId);
 const allowed=(await db.prepare(`SELECT DISTINCT pm.metric_id,m.key ${targetJoin} LEFT JOIN json_each(i.metric_ids_json) approved ON 1=1 LEFT JOIN project_metrics pm ON pm.tenant_id=i.tenant_id AND pm.client_id=i.client_id AND pm.project_id=i.project_id AND pm.metric_id=approved.value LEFT JOIN metrics m ON m.tenant_id=pm.tenant_id AND m.client_id=pm.client_id AND m.id=pm.metric_id WHERE ${activeGrant} AND i.tenant_id=? AND i.client_id=? AND i.project_id=?`).bind(...accessBindings(identity),tenant,clientId,projectId).all<{metric_id:string|null;key:string|null}>()).results;
 if(!allowed.length)throw new PublicError('Reporting target is not available.');
 const metrics=new Map(allowed.filter(r=>r.metric_id!==null&&r.key!==null).map(r=>[r.metric_id!,{key:r.key!}]));
 return {plugins:plugins.filter(p=>p.enabled).map(p=>({...p,metricIds:p.metricIds.filter(id=>metrics.has(id)&&metricAllowedForPlugin(p.key,metrics.get(id)!))}))};
}
