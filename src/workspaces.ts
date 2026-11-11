import { authorize, PublicError, type Principal } from './auth.ts';
import { canonicalJson, sha256 } from './domain.ts';
import { createClientInput, updateClientInput, createProjectInput, updateProjectInput, listProjectsInput, type CreateClientInput, type UpdateClientInput, type CreateProjectInput, type UpdateProjectInput } from './workspaceSchemas.ts';
import type { z } from 'zod';

async function replay(db: D1Database, p: Principal, key: string, hash: string) {
  const row = await db.prepare('SELECT payload_hash,result_json FROM workspace_events WHERE tenant_id=? AND principal_id=? AND idempotency_key=?').bind(p.tenantId,p.id,key).first<{payload_hash:string;result_json:string}>();
  if (!row) return null;
  if (row.payload_hash !== hash) throw new PublicError('Idempotency key was already used for a different request.');
  return { ...JSON.parse(row.result_json), replayed: true };
}
async function commit(db: D1Database, p: Principal, operation: string, input: {clientId:string;idempotencyKey:string}, entityId: string, result: object, build: () => {before:D1PreparedStatement[];after?:D1PreparedStatement[]}) {
  const hash = await sha256(canonicalJson({operation,input}));
  const previous = await replay(db,p,input.idempotencyKey,hash);
  if (previous) return previous;
  const statements = build();
  // The receipt follows the guarded mutation immediately. A stale revision makes
  // result_json NULL, failing NOT NULL and rolling back the entire D1 batch.
  const receipt = db.prepare('INSERT INTO workspace_events(tenant_id,principal_id,idempotency_key,operation,client_id,entity_id,payload_hash,result_json,recorded_at) VALUES(?,?,?,?,?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?)').bind(p.tenantId,p.id,input.idempotencyKey,operation,input.clientId,entityId,hash,JSON.stringify(result),new Date().toISOString());
  try { await db.batch([...statements.before,receipt,...(statements.after ?? [])]); }
  catch (error) {
    const retried = await replay(db,p,input.idempotencyKey,hash);
    if (retried) return retried;
    if (/constraint|unique|foreign key|NOT NULL/i.test(String(error))) throw new PublicError('Write rejected: check expected revision, immutable target identity, IDs, and metric membership.');
    throw error;
  }
  return { ...result, replayed: false };
}

/** clients:write explicitly permits creating a client in this tenant and granting
 * the creating credential access to it. It cannot grant access to existing clients. */
export async function createClient(db: D1Database, p: Principal, raw: CreateClientInput) {
  const input = createClientInput.parse(raw);
  if (!p.scopes.includes('clients:write')) throw new PublicError('This credential lacks the required scope.');
  const result = {clientId:input.clientId,name:input.name,timezone:input.timezone,revision:1};
  return commit(db,p,'create_client',input,input.clientId,result,() => ({
    before:[db.prepare('INSERT INTO clients(tenant_id,id,name,timezone) VALUES(?,?,?,?)').bind(p.tenantId,input.clientId,input.name,input.timezone)],
    after:[db.prepare('INSERT INTO client_grants(tenant_id,principal_id,client_id) VALUES(?,?,?)').bind(p.tenantId,p.id,input.clientId),...(p.oauthOperatorId ? [db.prepare('INSERT INTO oauth_operator_clients(tenant_id,operator_id,client_id) VALUES(?,?,?)').bind(p.tenantId,p.oauthOperatorId,input.clientId)] : [])],
  }));
}
export async function updateClient(db: D1Database, p: Principal, raw: UpdateClientInput) {
  const input = updateClientInput.parse(raw);
  await authorize(db,p,input.clientId,'clients:write');
  const result = {clientId:input.clientId,name:input.name,timezone:input.timezone,revision:input.expectedRevision+1};
  return commit(db,p,'update_client',input,input.clientId,result,() => ({
    before:[db.prepare('UPDATE client_versions SET revision=revision+1 WHERE tenant_id=? AND client_id=? AND revision=?').bind(p.tenantId,input.clientId,input.expectedRevision)],
    after:[db.prepare('UPDATE clients SET name=?,timezone=? WHERE tenant_id=? AND id=?').bind(input.name,input.timezone,p.tenantId,input.clientId)],
  }));
}
async function writeProject(db: D1Database,p: Principal,input: CreateProjectInput | UpdateProjectInput,creating:boolean) {
  await authorize(db,p,input.clientId,'projects:write');
  const now = new Date().toISOString();
  const result = {clientId:input.clientId,projectId:input.projectId,kind:input.kind,platformAccountRef:input.platformAccountRef ?? null,name:input.name,description:input.description,status:input.status,metricIds:input.metricIds,revision:input.expectedRevision+1};
  return commit(db,p,creating?'create_project':'update_project',input,input.projectId,result,() => ({
    before:[creating
      ? db.prepare('INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at,kind,platform_account_ref) VALUES(?,?,?,?,?,?,1,?,?,?,?)').bind(p.tenantId,input.clientId,input.projectId,input.name,input.description,input.status,now,now,input.kind,input.platformAccountRef ?? null)
      : db.prepare('UPDATE projects SET name=?,description=?,status=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND client_id=? AND id=? AND revision=? AND kind=? AND platform_account_ref IS ?').bind(input.name,input.description,input.status,now,p.tenantId,input.clientId,input.projectId,input.expectedRevision,input.kind,input.platformAccountRef ?? null)],
    after:[db.prepare('DELETE FROM project_metrics WHERE tenant_id=? AND client_id=? AND project_id=?').bind(p.tenantId,input.clientId,input.projectId),...input.metricIds.map(metricId=>db.prepare('INSERT INTO project_metrics(tenant_id,client_id,project_id,metric_id) VALUES(?,?,?,?)').bind(p.tenantId,input.clientId,input.projectId,metricId))],
  }));
}
export async function createProject(db: D1Database,p: Principal,input: CreateProjectInput) { return writeProject(db,p,createProjectInput.parse(input),true); }
export async function updateProject(db: D1Database,p: Principal,input: UpdateProjectInput) { return writeProject(db,p,updateProjectInput.parse(input),false); }
export async function listProjects(db: D1Database,p: Principal,raw: z.infer<typeof listProjectsInput>) {
  const input = listProjectsInput.parse(raw);
  await authorize(db,p,input.clientId,'projects:read');
  const {results} = await db.prepare('SELECT id AS projectId,client_id AS clientId,kind,platform_account_ref AS platformAccountRef,name,description,status,revision,created_at AS createdAt,updated_at AS updatedAt,(SELECT json_group_array(metric_id) FROM project_metrics pm WHERE pm.tenant_id=projects.tenant_id AND pm.client_id=projects.client_id AND pm.project_id=projects.id) AS metricIdsJson FROM projects WHERE tenant_id=? AND client_id=? AND id>? ORDER BY id LIMIT ?').bind(p.tenantId,input.clientId,input.afterId ?? '',input.limit+1).all<Record<string,unknown>>();
  const items: Record<string, unknown>[] = results.slice(0,input.limit).map(({metricIdsJson,...row})=>({...row,metricIds:JSON.parse(String(metricIdsJson))}));
  return {items,nextCursor:results.length>input.limit?String(results[input.limit-1]?.projectId):null};
}
