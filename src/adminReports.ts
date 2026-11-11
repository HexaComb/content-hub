import { metricAllowedForPlugin } from './pluginMetrics.ts';
import { readProjectPlugins, selectPlugin } from './plugins.ts';
import { readProjectTheme } from './themes.ts';
import { PublicError } from './auth.ts';
import { requireSuperAdmin } from './admin.ts';
import type { HumanIdentity } from './humanAuth.ts';
import type { InvitationEnv } from './mail.ts';
import { compareReadings, monthRange, previousMonth, type Direction, type Quality } from './domain.ts';
import { id } from './schemas.ts';

type OverviewRow = { tenant_id:string; tenant_name:string; client_id:string; client_name:string; timezone:string; project_id:string|null; project_name:string|null; kind:string|null; platform_account_ref:string|null; status:string|null };
const targetDTO = (p:OverviewRow) => ({tenantId:p.tenant_id,clientId:p.client_id,clientName:p.client_name,timezone:p.timezone,projectId:p.project_id!,name:p.project_name!,kind:p.kind!,platformAccountRef:p.platform_account_ref,status:p.status!});
const columns = `c.tenant_id,t.name AS tenant_name,c.id AS client_id,c.name AS client_name,c.timezone,p.id AS project_id,p.name AS project_name,p.kind,p.platform_account_ref,p.status`;
const joins = `FROM clients c JOIN tenants t ON t.id=c.tenant_id LEFT JOIN projects p ON p.tenant_id=c.tenant_id AND p.client_id=c.id`;

/** Application-wide reads are deliberately separate from recipient grants and MCP scopes.
 * Only pass the identity verified by getHumanIdentity on this request. Never accept a
 * caller-provided AdminSession/role, email, tenant membership or OAuth principal here. */
export async function adminOverview(db:D1Database,identity:HumanIdentity|null,env:InvitationEnv,offset=0) {
 const session=requireSuperAdmin(identity,env);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1_000_000)throw new PublicError('Invalid overview page.');
 const counts=await db.prepare(`SELECT (SELECT COUNT(*) FROM clients) AS clients,(SELECT COUNT(*) FROM projects) AS projects,(SELECT COUNT(*) FROM tenants) AS workspaces`).first<{clients:number;projects:number;workspaces:number}>();
 const rows=(await db.prepare(`SELECT ${columns} ${joins} ORDER BY c.tenant_id,c.id,p.id LIMIT 101 OFFSET ?`).bind(offset).all<OverviewRow>()).results;
 return {session,counts:counts??{clients:0,projects:0,workspaces:0},entries:rows.slice(0,100).map(row=>({tenantId:row.tenant_id,workspaceName:row.tenant_name,clientId:row.client_id,clientName:row.client_name,timezone:row.timezone,project:row.project_id===null?null:targetDTO(row)})),nextOffset:rows.length>100?offset+100:null};
}
export async function adminReport(db:D1Database,identity:HumanIdentity|null,env:InvitationEnv,tenantId:string,clientId:string,projectId:string,month:string,pluginKey?:string) {
 requireSuperAdmin(identity,env);
 [tenantId,clientId,projectId].forEach(value=>id.parse(value));
 let range:ReturnType<typeof monthRange>,priorRange:ReturnType<typeof monthRange>,priorMonth:string;
 try{range=monthRange(month);priorMonth=previousMonth(month);priorRange=monthRange(priorMonth);}catch{throw new PublicError('Use a valid reporting month in YYYY-MM format.');}
 const target=await db.prepare(`SELECT ${columns} ${joins} WHERE c.tenant_id=? AND c.id=? AND p.id=?`).bind(tenantId,clientId,projectId).first<OverviewRow>();
 if(!target)throw new PublicError('Reporting target is not available.');
 const definitions=(await db.prepare(`SELECT m.id,m.key,m.label,m.unit,m.direction,m.semantics,m.timezone FROM metrics m JOIN project_metrics pm ON pm.tenant_id=m.tenant_id AND pm.client_id=m.client_id AND pm.metric_id=m.id WHERE pm.tenant_id=? AND pm.client_id=? AND pm.project_id=? ORDER BY m.key LIMIT 201`).bind(tenantId,clientId,projectId).all<{id:string;key:string;label:string;unit:string;direction:Direction;semantics:string;timezone:string}>()).results;
 if(definitions.length>200)throw new PublicError('Too many reporting metrics for one report.');
 // Explicit report columns only: no invitation tokens, credentials, private notes,
 // source payloads, operator mappings or unrelated client observations are loaded.
 const readings=(await db.prepare(`SELECT o.metric_id,o.period_start,o.value,o.quality,o.collected_at FROM observations o JOIN project_metrics pm ON pm.tenant_id=o.tenant_id AND pm.client_id=o.client_id AND pm.metric_id=o.metric_id WHERE o.tenant_id=? AND o.client_id=? AND pm.project_id=? AND ((o.period_start=? AND o.period_end=?) OR (o.period_start=? AND o.period_end=?)) AND o.revision=(SELECT MAX(r.revision) FROM observations r WHERE r.tenant_id=o.tenant_id AND r.client_id=o.client_id AND r.metric_id=o.metric_id AND r.period_start=o.period_start AND r.period_end=o.period_end)`).bind(tenantId,clientId,projectId,range.start,range.end,priorRange.start,priorRange.end).all<{metric_id:string;period_start:string;value:number|null;quality:Quality;collected_at:string}>()).results;
 const plugin=pluginKey===undefined?null:selectPlugin(await readProjectPlugins(db,tenantId,clientId,projectId),pluginKey);
 const appearance=await readProjectTheme(db,tenantId,clientId,projectId);
 return {target:targetDTO(target),appearance,month,previousMonth:priorMonth,metrics:definitions.filter(metric=>!plugin||(plugin.metricIds.includes(metric.id)&&metricAllowedForPlugin(plugin.key,metric))).map(metric=>{
  const reading=(period:string)=>{const row=readings.find(r=>r.metric_id===metric.id&&r.period_start===period);return row?{value:row.value,quality:row.quality,collectedAt:row.collected_at}:null;};
  return {...metric,...compareReadings(reading(range.start),reading(priorRange.start),metric.direction,metric.unit)};
 })};
}
/** Called after the existing API method guard and server identity verification. */
export async function handleAdminReadRequest(request:Request,env:InvitationEnv,identity:HumanIdentity|null):Promise<Response|null> {
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/admin/'))return null;
 requireSuperAdmin(identity,env);
 if(request.method!=='GET')return Response.json({error:'Method not allowed.'},{status:405});
 if(url.pathname==='/api/admin/overview') {
  const page=url.searchParams.get('offset')??'0';
  if(!/^(0|[1-9]\d*)$/.test(page))throw new PublicError('Invalid overview page.');
  return Response.json(await adminOverview(env.DB,identity,env,Number(page)));
 }
 const match=url.pathname.match(/^\/api\/admin\/targets\/([^/]+)\/([^/]+)\/([^/]+)\/report$/);
 if(match)return Response.json(await adminReport(env.DB,identity,env,...match.slice(1).map(v=>decodeURIComponent(v)) as [string,string,string],url.searchParams.get('month')??new Date().toISOString().slice(0,7),url.searchParams.get('plugin')??undefined));
 return null;
}
